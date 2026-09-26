"use server";
import { DEMO_PERSONAS, DEMO_TOTP_SECRET, ensureProfile, getRuntime, recordSignIn, recordSignOut, systemContext, verifyStepUpCode } from "@sagolik/core";
import { RATE_LIMITS, safeRedirectPath } from "@sagolik/security";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/forms";
import { formString, runAction } from "@/lib/server/action";
import { contextFor, rateLimit } from "@/lib/server/context";
import { DEMO_COOKIE, STEP_UP_COOKIE, buildActor, encodeSession, getActor, markStepUp, newDemoSession, requestMeta, sessionCookieOptions, supabaseForRequest } from "@/lib/server/session";

const safeNext = safeRedirectPath;

async function throttle(bucket: string) {
  const meta = await requestMeta();
  const policy = bucket === "stepup" ? RATE_LIMITS.stepUp : bucket === "demo" ? RATE_LIMITS.demoSignIn : RATE_LIMITS.auth;
  const rl = await rateLimit(`${bucket}:${meta.ipAddress ?? "unknown"}`, policy);
  if (!rl.allowed) return { ok: false as const, error: "Too many attempts. Please wait a few minutes and try again.", code: "rate_limited" };
  return null;
}

// ----------------------------------------------------------------------------- demo personas

export async function demoSignIn(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const rt = await getRuntime();
  if (!rt.env.demoMode) return { ok: false, error: "Demo sign-in is disabled in this environment.", code: "forbidden" };
  // No secret to guess here, and demo visitors switch personas often: its own, looser bucket.
  const limited = await throttle("demo");
  if (limited) return limited;
  const persona = DEMO_PERSONAS.find((p) => p.key === formString(fd, "persona"));
  if (!persona) return { ok: false, error: "Choose one of the demo people.", code: "bad_request" };
  const session = newDemoSession(persona.userId);
  (await cookies()).set(DEMO_COOKIE, encodeSession(session), sessionCookieOptions());
  const actor = await buildActor(persona.userId, session.sid, null);
  if (actor) await recordSignIn(await contextFor(actor), "demo_persona");
  redirect(safeNext(formString(fd, "next"), persona.home));
}

// ----------------------------------------------------------------------------- Supabase Auth

const Credentials = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address."), password: z.string().min(8, "Passwords are at least 8 characters.") });

export async function passwordSignIn(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const limited = await throttle("auth");
  if (limited) return limited;
  const sb = await supabaseForRequest();
  if (!sb) return { ok: false, error: "Email sign-in isn't configured in this environment.", code: "bad_request" };
  const parsed = Credentials.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message, code: "bad_request" };
  const { data, error } = await sb.auth.signInWithPassword(parsed.data);
  // Same message for unknown email and wrong password (no account enumeration).
  if (error || !data.user) return { ok: false, error: "That email and password don't match.", code: "unauthenticated" };
  const rt = await getRuntime();
  await ensureProfile(systemContext(rt, "auth"), { id: data.user.id, email: data.user.email!, fullName: (data.user.user_metadata?.full_name as string | undefined) ?? null });
  const actor = await getActor();
  if (actor) await recordSignIn(await contextFor(actor), "password");
  redirect(safeNext(formString(fd, "next"), "/app"));
}

export async function magicLinkSignIn(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const limited = await throttle("auth");
  if (limited) return limited;
  const sb = await supabaseForRequest();
  if (!sb) return { ok: false, error: "Email sign-in isn't configured in this environment.", code: "bad_request" };
  const email = z.string().trim().toLowerCase().email().safeParse(fd.get("email"));
  if (!email.success) return { ok: false, error: "Enter a valid email address.", code: "bad_request" };
  const rt = await getRuntime();
  const next = safeNext(formString(fd, "next"), "/app");
  await sb.auth.signInWithOtp({ email: email.data, options: { emailRedirectTo: `${rt.env.APP_URL}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: true } });
  // Always the same response, whether or not the address has an account.
  return { ok: true, message: "If that address can sign in, a secure link is on its way. It expires in one hour." };
}

export async function signUp(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const limited = await throttle("auth");
  if (limited) return limited;
  const sb = await supabaseForRequest();
  if (!sb) return { ok: false, error: "Account creation isn't configured in this environment.", code: "bad_request" };
  const parsed = Credentials.extend({ fullName: z.string().trim().min(2, "Enter your full name.").max(120) }).safeParse({ email: fd.get("email"), password: fd.get("password"), fullName: fd.get("fullName") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message, code: "bad_request" };
  const rt = await getRuntime();
  const { data, error } = await sb.auth.signUp({ email: parsed.data.email, password: parsed.data.password, options: { data: { full_name: parsed.data.fullName }, emailRedirectTo: `${rt.env.APP_URL}/auth/callback` } });
  if (error) return { ok: false, error: "We couldn't create that account. Try a different email, or sign in.", code: "bad_request" };
  if (data.user) await ensureProfile(systemContext(rt, "auth"), { id: data.user.id, email: parsed.data.email, fullName: parsed.data.fullName });
  return { ok: true, message: "Check your email to confirm your address, then sign in." };
}

export async function ssoSignIn(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const sb = await supabaseForRequest();
  if (!sb) return { ok: false, error: "Enterprise SSO isn't configured in this environment.", code: "bad_request" };
  const domain = z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/).safeParse(fd.get("domain"));
  if (!domain.success) return { ok: false, error: "Enter your company's email domain, e.g. example.com.", code: "bad_request" };
  const rt = await getRuntime();
  const { data, error } = await sb.auth.signInWithSSO({ domain: domain.data, options: { redirectTo: `${rt.env.APP_URL}/auth/callback` } });
  if (error || !data?.url) return { ok: false, error: "Single sign-on isn't set up for that domain yet. Ask your administrator.", code: "not_found" };
  redirect(data.url);
}

export async function oauthSignIn(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const sb = await supabaseForRequest();
  const provider = z.enum(["google", "azure"]).safeParse(fd.get("provider"));
  if (!sb || !provider.success) return { ok: false, error: "That sign-in option isn't available.", code: "bad_request" };
  const rt = await getRuntime();
  const { data, error } = await sb.auth.signInWithOAuth({ provider: provider.data, options: { redirectTo: `${rt.env.APP_URL}/auth/callback`, scopes: provider.data === "azure" ? "email" : undefined } });
  if (error || !data.url) return { ok: false, error: "That sign-in option isn't available right now.", code: "provider_error" };
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const actor = await getActor();
  if (actor) await recordSignOut(await contextFor(actor)).catch(() => undefined);
  const sb = await supabaseForRequest();
  if (sb) await sb.auth.signOut();
  const store = await cookies();
  store.delete(DEMO_COOKIE);
  store.delete(STEP_UP_COOKIE);
  redirect("/sign-in?signed_out=1");
}

export async function signOutOtherSessions(): Promise<ActionState> {
  return runAction(async () => {
    const sb = await supabaseForRequest();
    if (sb) await sb.auth.signOut({ scope: "others" });
    return { message: "Other sessions have been signed out." };
  });
}

// ----------------------------------------------------------------------------- step-up

export async function stepUp(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const limited = await throttle("stepup");
  if (limited) return limited;
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  const code = formString(fd, "code") ?? "";
  const next = safeNext(formString(fd, "next"), "/app");
  const rt = await getRuntime();
  const ctx = await contextFor(actor);

  if (rt.mode === "supabase" && /^\d{6}$/.test(code)) {
    const sb = (await supabaseForRequest())!;
    const factors = await sb.auth.mfa.listFactors();
    const totp = factors.data?.totp?.find((f) => f.status === "verified");
    if (!totp) return { ok: false, error: "Set up an authenticator app in Settings → Security first.", code: "bad_request" };
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
    if (error) return { ok: false, error: "That code didn't work. Check your authenticator app and try again.", code: "bad_request" };
    redirect(next);
  }

  const result = await runAction(async () => {
    await verifyStepUpCode(ctx, code, { totpSecret: rt.env.demoMode ? DEMO_TOTP_SECRET : null });
  });
  if (!result.ok) return result;
  await markStepUp(actor.userId);
  redirect(next);
}

// ----------------------------------------------------------------------------- MFA enrolment (Supabase Auth TOTP)

export async function mfaEnrollAction(): Promise<ActionState> {
  const sb = await supabaseForRequest();
  if (!sb) return { ok: false, error: "Authenticator apps are configured through Supabase Auth, which isn't set up here.", code: "bad_request" };
  const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) return { ok: false, error: "We couldn't start authenticator setup. Please try again.", code: "provider_error" };
  return { ok: true, data: { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret } };
}

export async function mfaVerifyEnrollmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const sb = await supabaseForRequest();
  if (!sb) return { ok: false, error: "Not available.", code: "bad_request" };
  const factorId = formString(fd, "factorId") ?? "";
  const code = formString(fd, "code") ?? "";
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { ok: false, error: "That code didn't work. Check the time on your phone and try again.", code: "bad_request" };
  const actor = await getActor();
  if (actor) await markStepUp(actor.userId);
  return { ok: true, message: "Your authenticator app is set up. You'll use it to confirm sensitive actions." };
}
