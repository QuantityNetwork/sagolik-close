/**
 * Process runtime shared by the web app and the worker.
 *
 *  - Supabase configured → PostgreSQL via service client for writes,
 *    Supabase Storage for the vault.
 *  - Not configured → LOCAL demo mode: in-memory store seeded with the
 *    fictional demo environment, in-memory vault, sandbox providers.
 */
import type { Actor } from "@sagolik/auth";
import { type Env, type FlagOverride, getEnv, LOCAL_ENCRYPTION_KEYS } from "@sagolik/config";
import { createMemoryDb, createSupabaseDb, type Db } from "@sagolik/database";
import {
  createProviders,
  dropSingletonIf,
  globalSingleton,
  MOCK_SIGNATURE_HEADER,
  type Providers,
  setMockWebhookSink,
} from "@sagolik/integrations";
import { type KeyRing, parseKeyRing } from "@sagolik/security";
import { newCorrelationId } from "@sagolik/audit";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { consoleLogger, type Logger, type ServiceContext } from "./context";
import { restoreSandboxBanking } from "./demo/sandbox-bank";
import { buildDemoData, loadDemoData } from "./demo/seed";
import { registerReactions } from "./services/reactions";
import { handleWebhook } from "./services/webhooks";
import { MoneyServiceClient } from "./money/client";
import { type DocumentStorage, MemoryDocumentStorage, SupabaseDocumentStorage } from "./storage";

export interface Runtime {
  env: Env;
  mode: "memory" | "supabase";
  providers: Providers;
  keyRing: KeyRing;
  /** Service-level store (writes, system work). */
  serviceDb: Db;
  storage: DocumentStorage;
  serviceClient: SupabaseClient | null;
  log: Logger;
  startedAt: number;
  money: MoneyServiceClient | null;
}

async function init(): Promise<Runtime> {
  const env = getEnv();
  const keyRing = parseKeyRing(env.DATA_ENCRYPTION_KEYS ?? LOCAL_ENCRYPTION_KEYS);
  const providers = createProviders(env);
  const log = consoleLogger;
  registerReactions();

  let serviceDb: Db;
  let storage: DocumentStorage;
  let serviceClient: SupabaseClient | null = null;
  let mode: Runtime["mode"];

  if (env.supabaseConfigured && env.SUPABASE_SERVICE_ROLE_KEY) {
    mode = "supabase";
    serviceClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    serviceDb = createSupabaseDb(serviceClient);
    storage = new SupabaseDocumentStorage(serviceClient);
  } else {
    mode = "memory";
    serviceDb = createMemoryDb();
    storage = new MemoryDocumentStorage();
    const demo = buildDemoData(new Date(), keyRing);
    await loadDemoData(serviceDb, demo);
    for (const f of demo.files) await storage.put(f.key, f.bytes, f.mimeType).catch(() => undefined);
    log.info("runtime: LOCAL demo mode (in-memory store, sandbox providers, fictional data)");
  }

  const money = env.MONEY_SERVICE_URL
    ? MoneyServiceClient.fromFiles({
        url: env.MONEY_SERVICE_URL,
        caFile: env.MONEY_SERVICE_CA_FILE!,
        certFile: env.MONEY_SERVICE_CERT_FILE!,
        keyFile: env.MONEY_SERVICE_KEY_FILE!,
        signingJwkFile: env.MONEY_ASSERTION_SIGNING_JWK_FILE!,
        kid: env.MONEY_ASSERTION_KID,
      })
    : null;
  if (money) log.info("runtime: payment instructions and escrow movements are handled by the money service", { url: env.MONEY_SERVICE_URL });
  const runtime: Runtime = { env, mode, providers, keyRing, serviceDb, storage, serviceClient, log, startedAt: Date.now(), money };

  // Sandbox providers deliver signed webhooks through the same pipeline real providers use.
  setMockWebhookSink(async (providerId, rawBody, signature) => {
    const ctx = systemContext(runtime, `webhook:${providerId}`);
    const outcome = await handleWebhook(ctx, providerId, rawBody, new Headers({ [MOCK_SIGNATURE_HEADER]: signature }));
    if (outcome.status === "failed" || outcome.status === "rejected") log.warn("sandbox webhook not processed", { providerId, outcome: outcome.status });
  });
  await hydrateSandboxProviders(runtime);
  return runtime;
}

export async function getRuntime(): Promise<Runtime> {
  const pending = globalSingleton("runtime", () => init());
  const rt = await pending;
  const hours = rt.env.DEMO_RESET_HOURS;
  if (rt.mode === "memory" && hours > 0 && Date.now() - rt.startedAt > hours * 3_600_000) {
    // Public demo: start the fictional environment over so every visitor sees the intended journey.
    dropSingletonIf("runtime", pending);
    const fresh = await globalSingleton("runtime", () => init());
    fresh.log.info("runtime: demo environment reset", { afterHours: hours });
    return fresh;
  }
  return rt;
}

/** Restore sandbox provider state from persisted records so seeded/demo flows keep working across restarts. */
async function hydrateSandboxProviders(rt: Runtime) {
  const db = rt.serviceDb;
  const { signatures, banking, payments } = rt.providers.mocks;
  if (signatures) {
    for (const sig of await db.document_signatures.find({ provider: signatures.info.id, status: ["sent", "viewed", "signed"] })) {
      const doc = await db.documents.get(sig.documentId);
      const v = await db.document_versions.findOne({ documentId: sig.documentId, version: sig.documentVersion });
      if (!doc || !v) continue;
      signatures.hydrate({
        id: sig.externalEnvelopeId,
        documentName: doc.name,
        documentSha256: v.sha256,
        status: sig.status,
        recipients: sig.recipients.map((r, i) => ({ recipientId: r.participantId, name: r.name, email: r.email, routingOrder: i + 1, status: r.status, signedAt: r.signedAt })),
      });
    }
  }
  if (banking) await restoreSandboxBanking(db, banking, rt.keyRing);
  if (payments) {
    for (const p of await db.payments.find({ provider: payments.info.id })) {
      if (p.externalPaymentId) payments.hydrate({ id: p.externalPaymentId, idempotencyKey: p.idempotencyKey, amount: p.amount, currency: p.currency, status: p.status });
    }
  }
}

/** Feature-flag overrides from the database (+ demo defaults so sandbox flows are visible). */
export async function loadFlags(rt: Runtime): Promise<FlagOverride[]> {
  const rows = await rt.serviceDb.feature_flags.find({});
  const overrides: FlagOverride[] = rows.map((r) => ({ key: r.key, enabled: r.enabled, rolloutPercent: r.rolloutPercent, organizationIds: r.organizationIds }));
  if (rt.env.demoMode && !overrides.some((o) => o.key === "payment_initiation")) {
    overrides.push({ key: "payment_initiation", enabled: true, rolloutPercent: 100, organizationIds: [] });
  }
  return overrides;
}

export function systemContext(rt: Runtime, source: string, flags: FlagOverride[] = []): ServiceContext {
  return {
    db: rt.serviceDb,
    writer: rt.serviceDb,
    actor: { kind: "system", source },
    providers: rt.providers,
    storage: rt.storage,
    keyRing: rt.keyRing,
    env: rt.env,
    flags,
    correlationId: newCorrelationId(),
    log: rt.log,
    now: () => new Date(),
    outboxMode: rt.mode === "memory" ? "inline" : "worker",
    money: rt.money,
  };
}

export function userContext(rt: Runtime, actor: Actor, opts: { readerDb?: Db; flags?: FlagOverride[]; correlationId?: string } = {}): ServiceContext {
  return {
    ...systemContext(rt, "user", opts.flags ?? []),
    db: opts.readerDb ?? rt.serviceDb,
    actor,
    correlationId: opts.correlationId ?? newCorrelationId(),
  };
}
