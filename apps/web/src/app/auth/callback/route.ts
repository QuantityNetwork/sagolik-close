/**
 * Supabase Auth callback (magic link, OAuth, SSO, email confirmation):
 * exchange the one-time code for a session, create the profile on first
 * sign-in, link pending invitations, audit the login.
 */
import { safeRedirectPath } from "@sagolik/security";
import { ensureProfile, getRuntime, recordSignIn, systemContext } from "@sagolik/core";
import { NextResponse } from "next/server";
import { contextFor } from "@/lib/server/context";
import { getActor, supabaseForRequest } from "@/lib/server/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Redirect to the public origin: behind a proxy, request.url carries the internal address.
  const base = (await getRuntime()).env.APP_URL;
  const code = url.searchParams.get("code");
  const next = safeRedirectPath(url.searchParams.get("next"));
  const sb = await supabaseForRequest();
  if (!sb || !code) return NextResponse.redirect(new URL("/sign-in", base));
  const { data, error } = await sb.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(new URL("/sign-in?error=link_expired", base));
  const rt = await getRuntime();
  await ensureProfile(systemContext(rt, "auth"), { id: data.user.id, email: data.user.email ?? "", fullName: (data.user.user_metadata?.full_name as string | undefined) ?? null });
  const actor = await getActor();
  if (actor) await recordSignIn(await contextFor(actor), data.user.app_metadata?.provider ?? "email_link");
  return NextResponse.redirect(new URL(next, base));
}
