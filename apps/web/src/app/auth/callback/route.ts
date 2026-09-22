/**
 * Supabase Auth callback (magic link, OAuth, SSO, email confirmation):
 * exchange the one-time code for a session, create the profile on first
 * sign-in, link pending invitations, audit the login.
 */
import { ensureProfile, getRuntime, recordSignIn, systemContext } from "@sagolik/core";
import { NextResponse } from "next/server";
import { contextFor } from "@/lib/server/context";
import { getActor, supabaseForRequest } from "@/lib/server/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/app";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/app";
  const sb = await supabaseForRequest();
  if (!sb || !code) return NextResponse.redirect(new URL("/sign-in", url.origin));
  const { data, error } = await sb.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(new URL("/sign-in?error=link_expired", url.origin));
  const rt = await getRuntime();
  await ensureProfile(systemContext(rt, "auth"), { id: data.user.id, email: data.user.email ?? "", fullName: (data.user.user_metadata?.full_name as string | undefined) ?? null });
  const actor = await getActor();
  if (actor) await recordSignIn(await contextFor(actor), data.user.app_metadata?.provider ?? "email_link");
  return NextResponse.redirect(new URL(next, url.origin));
}
