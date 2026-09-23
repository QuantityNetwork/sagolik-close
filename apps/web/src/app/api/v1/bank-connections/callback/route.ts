/**
 * Where the open-banking provider sends the person back after consent.
 * Completes the connection for the signed-in person only, then returns them
 * to the transaction (or their bank settings).
 */
import { completeBankConnection, getRuntime, toAppError } from "@sagolik/core";
import { NextResponse } from "next/server";
import { contextFor } from "@/lib/server/context";
import { getActor } from "@/lib/server/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Redirect to the public origin: behind a proxy, request.url carries the internal address.
  const base = (await getRuntime()).env.APP_URL;
  const actor = await getActor();
  if (!actor) return NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`, base));
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const ctx = await contextFor(actor);
  try {
    const conn = await completeBankConnection(ctx, state, code);
    const dest = conn.transactionId ? `/app/transactions/${conn.transactionId}/money?bank=connected` : "/app/settings/banks?bank=connected";
    return NextResponse.redirect(new URL(dest, base));
  } catch (e) {
    const err = toAppError(e);
    return NextResponse.redirect(new URL(`/app/settings/banks?bank_error=${encodeURIComponent(err.userMessage)}`, base));
  }
}
