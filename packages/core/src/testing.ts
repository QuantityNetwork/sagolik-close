/**
 * Test harness: an isolated in-memory runtime with sandbox providers wired to
 * the real webhook pipeline. Used by the service tests and the worker tests.
 */
import type { Actor } from "@sagolik/auth";
import { LOCAL_ENCRYPTION_KEYS, parseEnv } from "@sagolik/config";
import { createMemoryDb, type Db } from "@sagolik/database";
import { createProviders, MOCK_SIGNATURE_HEADER, setMockWebhookSink } from "@sagolik/integrations";
import { parseKeyRing } from "@sagolik/security";
import type { Logger, ServiceContext } from "./context";
import { buildDemoData, DEMO_PERSONAS, loadDemoData } from "./demo/seed";
import { registerReactions } from "./services/reactions";
import { handleWebhook } from "./services/webhooks";
import { MemoryDocumentStorage } from "./storage";

const quietLog: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export interface TestHarness {
  db: Db;
  system(source?: string): ServiceContext;
  as(personaKey: string, opts?: { stepUp?: boolean }): Promise<ServiceContext>;
  actorFor(userId: string, stepUp?: boolean): Promise<Actor>;
  providers: ReturnType<typeof createProviders>;
  userId(personaKey: string): string;
}

export async function createTestHarness(opts: { seed?: boolean; flags?: ServiceContext["flags"] } = {}): Promise<TestHarness> {
  const env = parseEnv({ APP_ENV: "local", APP_URL: "http://localhost:3000", DEMO_MODE: "true" });
  const keyRing = parseKeyRing(LOCAL_ENCRYPTION_KEYS);
  const providers = createProviders(env);
  const db = createMemoryDb();
  const storage = new MemoryDocumentStorage();
  registerReactions();
  const demo = buildDemoData(new Date(), keyRing);
  if (opts.seed !== false) {
    await loadDemoData(db, demo);
  } else {
    // People and organizations only.
    await loadDemoData(db, { rows: { profiles: demo.rows.profiles, organizations: demo.rows.organizations, organization_members: demo.rows.organization_members, organization_settings: demo.rows.organization_settings }, files: [] });
  }
  const flags = opts.flags ?? [{ key: "payment_initiation", enabled: true, rolloutPercent: 100, organizationIds: [] }];

  const base = (actor: ServiceContext["actor"]): ServiceContext => ({
    db,
    writer: db,
    actor,
    providers,
    storage,
    keyRing,
    env,
    flags,
    correlationId: `corr_test_${crypto.randomUUID().slice(0, 8)}`,
    log: quietLog,
    now: () => new Date(),
    outboxMode: "inline",
  });

  setMockWebhookSink(async (providerId, rawBody, signature) => {
    await handleWebhook(base({ kind: "system", source: "test" }), providerId, rawBody, new Headers({ [MOCK_SIGNATURE_HEADER]: signature }));
  });

  const actorFor = async (userId: string, stepUp = false): Promise<Actor> => {
    const profile = await db.profiles.get(userId);
    if (!profile) throw new Error(`no profile ${userId}`);
    const memberships = await db.organization_members.find({ userId });
    return {
      userId,
      email: profile.email,
      displayName: profile.fullName,
      isPlatformAdmin: profile.isPlatformAdmin,
      memberships: memberships.map((m) => ({ organizationId: m.organizationId, role: m.role })),
      stepUpAt: stepUp ? Date.now() : null,
      sessionId: "test-session",
      ipAddress: "203.0.113.10",
      userAgent: "vitest",
    };
  };

  const userId = (key: string) => {
    const p = DEMO_PERSONAS.find((x) => x.key === key);
    if (!p) throw new Error(`unknown persona ${key}`);
    return p.userId;
  };

  return {
    db,
    providers,
    userId,
    actorFor,
    system: (source = "test") => base({ kind: "system", source }),
    as: async (key, o = {}) => base(await actorFor(userId(key), o.stepUp)),
  };
}
