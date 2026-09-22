import "server-only";
/**
 * Sessions.
 *
 * - Supabase configured: Supabase Auth (email/password, magic link, OAuth,
 *   MFA/TOTP). The user is verified server-side with `auth.getUser()` on every
 *   request; step-up freshness comes from the AAL2 `amr` claim.
 * - Demo mode: a signed, HttpOnly cookie for one of the fictional personas.
 *   Clearly labelled; refused in production by config validation.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Actor } from "@sagolik/auth";
import { LOCAL_SESSION_SECRET } from "@sagolik/config";
import { getRuntime } from "@sagolik/core";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

export const DEMO_COOKIE = "sc_session";
/** Step-up marker (both modes): signed {uid, at}, short-lived, bound to the user. */
export const STEP_UP_COOKIE = "sc_stepup";
const STEP_UP_COOKIE_TTL_SEC = 5 * 60;
const SESSION_TTL_SEC = 8 * 60 * 60;

interface DemoSession {
  uid: string;
  sid: string;
  iat: number;
  exp: number;
  stepUpAt: number | null;
}

function secret(): string {
  return process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32 ? process.env.SESSION_SECRET : LOCAL_SESSION_SECRET;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encodeSession(s: DemoSession): string {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(value: string | undefined): DemoSession | null {
  if (!value) return null;
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as DemoSession;
    if (typeof s.uid !== "string" || typeof s.exp !== "number" || s.exp * 1000 < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAge = SESSION_TTL_SEC) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge };
}

export function newDemoSession(uid: string): DemoSession {
  const now = Math.floor(Date.now() / 1000);
  return { uid, sid: crypto.randomUUID(), iat: now, exp: now + SESSION_TTL_SEC, stepUpAt: null };
}

/** Supabase client bound to the request cookies (anon key + user JWT → RLS applies). */
export async function supabaseForRequest(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const store = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) store.set(c.name, c.value, c.options);
        } catch {
          // Called from a Server Component: cookies are refreshed by the next action/route instead.
        }
      },
    },
  });
}

export async function requestMeta() {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return {
    ipAddress: (fwd ? fwd.split(",")[0]!.trim() : h.get("x-real-ip")) ?? null,
    userAgent: h.get("user-agent"),
    requestId: h.get("x-request-id") ?? crypto.randomUUID(),
  };
}

async function stepUpFromCookie(userId: string): Promise<number | null> {
  const raw = (await cookies()).get(STEP_UP_COOKIE)?.value;
  if (!raw) return null;
  const [payload, mac] = raw.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(`stepup:${payload}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid: string; at: number };
    return v.uid === userId ? v.at : null;
  } catch {
    return null;
  }
}

export async function buildActor(userId: string, sessionId: string, stepUpAt: number | null): Promise<Actor | null> {
  const rt = await getRuntime();
  const profile = await rt.serviceDb.profiles.get(userId);
  if (!profile) return null;
  const memberships = await rt.serviceDb.organization_members.find({ userId });
  const meta = await requestMeta();
  const cookieStepUp = await stepUpFromCookie(userId);
  return {
    userId,
    email: profile.email,
    displayName: profile.fullName,
    isPlatformAdmin: profile.isPlatformAdmin,
    memberships: memberships.map((m) => ({ organizationId: m.organizationId, role: m.role })),
    stepUpAt: Math.max(stepUpAt ?? 0, cookieStepUp ?? 0) || null,
    sessionId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  };
}

/** The verified person behind this request, or null. Never trusts request bodies. */
export async function getActor(): Promise<Actor | null> {
  const rt = await getRuntime();
  if (rt.mode === "supabase") {
    const sb = await supabaseForRequest();
    if (!sb) return null;
    const { data } = await sb.auth.getUser();
    if (!data.user) return null;
    const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    const methods = (aal.data?.currentAuthenticationMethods ?? []).filter((m): m is Exclude<typeof m, string> => typeof m !== "string");
    const mfaAt = aal.data?.currentLevel === "aal2" ? Math.max(0, ...methods.filter((m) => m.method === "totp" || m.method === "webauthn").map((m) => m.timestamp * 1000)) : 0;
    return buildActor(data.user.id, data.user.id, mfaAt || null);
  }
  const store = await cookies();
  const s = decodeSession(store.get(DEMO_COOKIE)?.value);
  if (!s) return null;
  return buildActor(s.uid, s.sid, s.stepUpAt);
}

export async function requireActor(next?: string): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect(`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return actor;
}

/** Record a successful step-up (sandbox authenticator or recovery code) for this user. */
export async function markStepUp(userId: string) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, at: Date.now() })).toString("base64url");
  (await cookies()).set(STEP_UP_COOKIE, `${payload}.${sign(`stepup:${payload}`)}`, sessionCookieOptions(STEP_UP_COOKIE_TTL_SEC));
}
