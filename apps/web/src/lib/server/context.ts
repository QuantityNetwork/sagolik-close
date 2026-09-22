import "server-only";
import type { Actor } from "@sagolik/auth";
import { getRuntime, loadFlags, type ServiceContext, userContext } from "@sagolik/core";
import { createSupabaseDb } from "@sagolik/database";
import { MemoryRateLimitStore, type RateLimitPolicy, checkRateLimit } from "@sagolik/security";
import { globalSingleton } from "@sagolik/integrations";
import { requestMeta, requireActor, supabaseForRequest } from "./session";

/** Service context for the signed-in person. Reads go through RLS in Supabase mode. */
export async function contextFor(actor: Actor): Promise<ServiceContext> {
  const rt = await getRuntime();
  const flags = await loadFlags(rt);
  const meta = await requestMeta();
  let readerDb = rt.serviceDb;
  if (rt.mode === "supabase") {
    const sb = await supabaseForRequest();
    if (sb) readerDb = createSupabaseDb(sb);
  }
  return userContext(rt, actor, { readerDb, flags, correlationId: meta.requestId });
}

export async function requireContext(next?: string) {
  const actor = await requireActor(next);
  return { actor, ctx: await contextFor(actor) };
}

const limiter = globalSingleton("rate_limit_store", () => new MemoryRateLimitStore());

/** Per-key rate limit. Production: back `RateLimitStore` with Redis so limits span instances. */
export async function rateLimit(key: string, policy: RateLimitPolicy) {
  return checkRateLimit(limiter, key, policy);
}
