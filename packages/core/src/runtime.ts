/**
 * Process runtime shared by the web app and the worker.
 *
 *  - DATABASE_URL set → PostgreSQL directly (Azure Database for PostgreSQL):
 *    a person's reads under row-level security, the service's writes as
 *    service_role; documents in Azure Blob Storage. Signs in with the
 *    workload's managed identity when DATABASE_AUTH=entra.
 *  - Supabase configured → PostgreSQL via service client for writes,
 *    Supabase Storage for the vault.
 *  - Neither → LOCAL demo mode: in-memory store seeded with the
 *    fictional demo environment, in-memory vault, sandbox providers.
 *
 * Data keys come in clear (DATA_ENCRYPTION_KEYS) or, on Azure, wrapped by a
 * Key Vault key (DATA_KEYS_WRAPPED) and unwrapped here at start-up. The
 * deal-record recording key can live in Key Vault (CHAIN_RECORDER_KEY_ID),
 * where it signs without ever leaving the HSM.
 */
import type { Actor } from "@sagolik/auth";
import { type Env, type FlagOverride, getEnv, LOCAL_ENCRYPTION_KEYS } from "@sagolik/config";
import { createMemoryDb, createPostgresDb, createPostgresPool, createSupabaseDb, type Db } from "@sagolik/database";
import {
  createProviders,
  dropSingletonIf,
  globalSingleton,
  MOCK_SIGNATURE_HEADER,
  type Providers,
  setMockWebhookSink,
} from "@sagolik/integrations";
import { type KeyRing, parseKeyRing } from "@sagolik/security";
import type { LocalAccount } from "viem/accounts";
import { newCorrelationId } from "@sagolik/audit";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { consoleLogger, type Logger, type ServiceContext } from "./context";
import { restoreSandboxBanking } from "./demo/sandbox-bank";
import { restoreSandboxChain } from "./demo/sandbox-chain";
import { buildDemoData, loadDemoData } from "./demo/seed";
import { registerReactions } from "./services/reactions";
import { handleWebhook } from "./services/webhooks";
import { MoneyServiceClient } from "./money/client";
import { type DocumentStorage, MemoryDocumentStorage, SupabaseDocumentStorage } from "./storage";

export interface Runtime {
  env: Env;
  mode: "memory" | "supabase" | "postgres";
  providers: Providers;
  keyRing: KeyRing;
  /** Service-level store (writes, system work). */
  serviceDb: Db;
  storage: DocumentStorage;
  serviceClient: SupabaseClient | null;
  /** PostgreSQL mode: a store for one person's reads, decided by the row-level security policies. */
  readerFor: ((userId: string) => Db) | null;
  /**
   * Where domain events are processed. In-process ("inline") whenever sandbox
   * providers keep state in this process (in-memory store, demo mode), so the
   * sandbox and the records never diverge; otherwise by the worker.
   */
  outboxMode: "inline" | "worker";
  log: Logger;
  startedAt: number;
  money: MoneyServiceClient | null;
}

type AzureGlue = { azure: typeof import("@sagolik/azure"); credential: import("@sagolik/azure").TokenCredential };
let azureGlue: Promise<AzureGlue> | null = null;

/** Azure SDK glue, loaded only when an Azure setting asks for it. One credential per process, so tokens are cached. */
export function azureFor(env: Env): Promise<AzureGlue> {
  azureGlue ??= import("@sagolik/azure").then((azure) => ({ azure, credential: azure.azureCredential(env.AZURE_CLIENT_ID) }));
  return azureGlue;
}

/** The data keys: unwrapped by Key Vault when configured wrapped (kept in memory only), else from configuration. */
export async function loadKeyRing(env: Env): Promise<KeyRing> {
  if (env.DATA_KEYS_WRAPPED) {
    if (!env.DATA_KEK_ID) throw new Error("DATA_KEYS_WRAPPED needs DATA_KEK_ID.");
    const { azure, credential } = await azureFor(env);
    return parseKeyRing(await azure.unwrapKeyRing(env.DATA_KEYS_WRAPPED, azure.keyVaultWrapper(env.DATA_KEK_ID, credential)));
  }
  return parseKeyRing(env.DATA_ENCRYPTION_KEYS ?? LOCAL_ENCRYPTION_KEYS);
}

/** A pool for DATABASE_URL; with DATABASE_AUTH=entra each new connection signs in with a fresh Entra token. */
export async function postgresPoolFor(env: Env, connectionString = env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL isn't set.");
  const password = env.DATABASE_AUTH === "entra" ? await azureFor(env).then(({ azure, credential }) => azure.entraPostgresPassword(credential)) : undefined;
  return createPostgresPool({ connectionString, password });
}

/** Documents in PostgreSQL mode: Azure Blob Storage, or memory for local development. */
export async function blobOrMemoryStorage(env: Env): Promise<DocumentStorage> {
  if (!env.AZURE_STORAGE_BLOB_URL) return new MemoryDocumentStorage();
  const { azure, credential } = await azureFor(env);
  return new azure.AzureBlobDocumentStorage({ accountUrl: env.AZURE_STORAGE_BLOB_URL, credential, container: env.AZURE_STORAGE_CONTAINER });
}

async function init(): Promise<Runtime> {
  const env = getEnv();
  const log = consoleLogger;
  const keyRing = await loadKeyRing(env);
  let chainRecorder: LocalAccount | undefined;
  if (env.CHAIN_RECORDER_KEY_ID) {
    const { azure, credential } = await azureFor(env);
    chainRecorder = await azure.keyVaultEvmAccount(env.CHAIN_RECORDER_KEY_ID, credential);
  }
  const providers = createProviders(env, { chainRecorder });
  registerReactions();

  let serviceDb: Db;
  let storage: DocumentStorage;
  let serviceClient: SupabaseClient | null = null;
  let readerFor: Runtime["readerFor"] = null;
  let mode: Runtime["mode"];

  if (env.DATABASE_URL) {
    mode = "postgres";
    const pool = await postgresPoolFor(env);
    pool.on("error", (e) => log.warn("database: idle connection dropped", { error: e.message }));
    serviceDb = createPostgresDb(pool, { role: "service_role" });
    readerFor = (userId) => createPostgresDb(pool, { role: "authenticated", userId });
    // Memory only in local development: configuration requires Blob Storage anywhere else.
    storage = await blobOrMemoryStorage(env);
    log.info("runtime: PostgreSQL", { auth: env.DATABASE_AUTH, documents: env.AZURE_STORAGE_BLOB_URL ? "blob" : "memory (local only)", demo: env.demoMode });
  } else if (env.supabaseConfigured && env.SUPABASE_SERVICE_ROLE_KEY) {
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
  if (chainRecorder) log.info("runtime: deal-record entries are signed by the Key Vault recording key", { address: chainRecorder.address });
  const outboxMode = mode === "memory" || env.demoMode ? "inline" : "worker";
  const runtime: Runtime = { env, mode, providers, keyRing, serviceDb, storage, serviceClient, readerFor, outboxMode, log, startedAt: Date.now(), money };

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
  const { signatures, banking, payments, chain } = rt.providers.mocks;
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
  if (chain) await restoreSandboxChain(db, chain);
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
    outboxMode: rt.outboxMode,
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
