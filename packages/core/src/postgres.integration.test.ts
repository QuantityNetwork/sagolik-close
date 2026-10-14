/**
 * The PostgreSQL store against a real PostgreSQL 16 database, migrated the
 * Azure way (infra/azure/sql/bootstrap.sql, no Supabase) and seeded with the
 * demo data. Connects as a workload login role that can do nothing until the
 * store takes an API role, exactly like a managed identity on Azure.
 *
 * Run with scripts/postgres-it.sh, which sets DATABASE_IT_URL. Skipped
 * otherwise (unless CI_REQUIRE_DB_IT is set, where skipping would hide it).
 */
import { type Actor, canViewDocument } from "@sagolik/auth";
import { LOCAL_ENCRYPTION_KEYS, parseEnv } from "@sagolik/config";
import { AppendOnlyViolationError, createPostgresDb, createPostgresPool, type Db, NotFoundError, UniqueViolationError } from "@sagolik/database";
import { createProviders } from "@sagolik/integrations";
import { parseKeyRing } from "@sagolik/security";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "./context";
import { DEMO_PERSONAS, DEMO_TRANSACTION_ID, did } from "./demo/seed";
import { professionalMemberships } from "./memberships";
import { accessContext } from "./snapshot";
import { listThreads, sendMessage } from "./services/messaging";
import { registerReactions } from "./services/reactions";
import { listTransactionsForActor } from "./services/transactions";
import { MemoryDocumentStorage } from "./storage";
import { createTestHarness, type TestHarness } from "./testing";

const url = process.env.DATABASE_IT_URL;
if (!url && process.env.CI_REQUIRE_DB_IT) throw new Error("CI_REQUIRE_DB_IT is set but DATABASE_IT_URL isn't: run scripts/postgres-it.sh.");

const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const persona = (key: string) => DEMO_PERSONAS.find((p) => p.key === key)!.userId;
const MAPLE = DEMO_TRANSACTION_ID;

describe.skipIf(!url)("PostgreSQL store, Azure flavour", () => {
  let pool: ReturnType<typeof createPostgresPool>;
  let service: Db;
  let memory: TestHarness;
  const env = parseEnv({ APP_ENV: "local", APP_URL: "http://localhost:3000", DEMO_MODE: "true" });
  const keyRing = parseKeyRing(LOCAL_ENCRYPTION_KEYS);
  const providers = createProviders(env);
  const reader = (userId: string) => createPostgresDb(pool, { role: "authenticated", userId });

  /** A person's context as the web app builds it on PostgreSQL: reads under RLS, writes by the service layer. */
  async function contextAs(key: string): Promise<ServiceContext> {
    const userId = persona(key);
    const profile = (await service.profiles.get(userId))!;
    return {
      db: reader(userId),
      writer: service,
      actor: {
        userId,
        email: profile.email,
        displayName: profile.fullName,
        isPlatformAdmin: profile.isPlatformAdmin,
        memberships: await professionalMemberships(service, userId),
        stepUpAt: null,
        sessionId: "it-session",
        ipAddress: "203.0.113.20",
        userAgent: "vitest",
      },
      providers,
      storage: new MemoryDocumentStorage(),
      keyRing,
      env,
      flags: [],
      correlationId: `corr_it_${crypto.randomUUID().slice(0, 8)}`,
      log: quiet,
      now: () => new Date(),
      outboxMode: "inline",
      money: null,
    };
  }

  beforeAll(async () => {
    pool = createPostgresPool({ connectionString: url!, max: 5 });
    service = createPostgresDb(pool, { role: "service_role" });
    registerReactions();
    memory = await createTestHarness();
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("gives the login role nothing of its own: every query has to take an API role", async () => {
    await expect(pool.query("select count(*) from public.profiles")).rejects.toThrow(/permission denied/);
    await expect(pool.query("select count(*) from auth.users")).rejects.toThrow(/permission denied/);
    expect(await service.profiles.count({})).toBeGreaterThanOrEqual(DEMO_PERSONAS.length);
  });

  it("shows every person what the in-memory store does, with row-level security deciding", async () => {
    // What a person is shown: their transactions, the people on them, and the documents they may open.
    const shown = async (ctx: ServiceContext) =>
      (await listTransactionsForActor(ctx)).map(({ snapshot: s }) => ({
        id: s.transaction.id,
        participants: s.participants.map((x) => x.id).sort(),
        documents: s.documents.filter((d) => canViewDocument(ctx.actor as Actor, accessContext(s), d)).map((d) => d.id).sort(),
        // The database may hold back more than the app's own checks would (it hides restricted
        // records from everyone but their uploader), never less.
        heldBackByDatabase: s.documents.filter((d) => !canViewDocument(ctx.actor as Actor, accessContext(s), d)).length,
      }));
    for (const p of DEMO_PERSONAS) {
      const expected = (await shown(await memory.as(p.key))).map(({ heldBackByDatabase: _, ...rest }) => rest);
      const actual = await shown(await contextAs(p.key));
      expect(actual.map(({ heldBackByDatabase: _, ...rest }) => rest), p.key).toEqual(expected);
      for (const t of actual) expect(t.heldBackByDatabase, `${p.key} sees a document the app would hide`).toBe(0);
    }
  });

  it("keeps readers inside their own data, and secrets out of every reader's reach", async () => {
    const buyer = reader(persona("olivia.carter"));
    // People with financial access see the instructions, never the encrypted account number.
    const [instruction] = await buyer.bank_instructions.find({ transactionId: MAPLE });
    expect(instruction?.accountMask).toBeTruthy();
    expect(instruction).not.toHaveProperty("encryptedAccountNumber");
    expect((await service.bank_instructions.get(instruction!.id))?.encryptedAccountNumber).toBeTruthy();
    expect(await buyer.transactions.get(did("tx:barton"))).toBeNull();
    expect(await buyer.bank_connection_secrets.count({})).toBe(0);
    expect(await buyer.audit_events.count({})).toBe(0);
    // A reader can't write, even to their own transaction.
    await expect(buyer.transactions.update(MAPLE, { reference: "CHANGED-BY-A-READER" })).rejects.toThrow();
    expect((await service.transactions.get(MAPLE))!.reference).toBe("SC-DEMO-MAPLE");
  });

  it("never mixes up people who share pooled connections", async () => {
    const buyer = reader(persona("olivia.carter"));
    const agent = reader(persona("jessica.morgan"));
    const [buyerCount, agentCount] = [await buyer.transactions.count({}), await agent.transactions.count({})];
    expect(buyerCount).toBe(1);
    expect(agentCount).toBeGreaterThan(1);
    const counts = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? buyer : agent).transactions.count({})));
    counts.forEach((n, i) => expect(n).toBe(i % 2 ? buyerCount : agentCount));
  });

  it("runs a person's action end to end: authorized by the service, written as service_role, read back under RLS", async () => {
    const buyer = await contextAs("olivia.carter");
    const [room] = (await listThreads(buyer, MAPLE)).filter((t) => t.thread.kind === "transaction_room");
    const msg = await sendMessage(buyer, { threadId: room!.thread.id, body: "Integration check: @Daniel, the wiring call is at 3pm.", attachmentDocumentIds: [] });
    // Types survive the round trip: timestamps as the ISO strings the app writes, arrays as arrays.
    expect(await buyer.db.messages.get(msg.id)).toEqual(msg);
    expect(msg.mentions).toEqual([persona("daniel.brooks")]);
    const seller = await contextAs("daniel.brooks");
    const sellerRoom = (await listThreads(seller, MAPLE)).find((t) => t.thread.id === room!.thread.id)!;
    expect(sellerRoom.messages.map((m) => m.id)).toContain(msg.id);
    // Someone outside the transaction can't see it.
    expect(await reader(persona("mia.rodriguez")).messages.get(msg.id)).toBeNull();
    // The audit trail recorded it, append-only.
    const [entry] = await service.audit_events.find({ resourceId: msg.id });
    expect(entry?.action).toBe("message.sent");
    await expect(service.audit_events.update(entry!.id, { action: "tampered" })).rejects.toBeInstanceOf(AppendOnlyViolationError);
  });

  it("maps database errors to the store's own", async () => {
    const profile = (await service.profiles.get(persona("olivia.carter")))!;
    await expect(service.profiles.insert({ ...profile })).rejects.toBeInstanceOf(UniqueViolationError);
    await expect(service.profiles.update(crypto.randomUUID(), { fullName: "Nobody" })).rejects.toBeInstanceOf(NotFoundError);
    expect(await service.profiles.updateIf(profile.id, { fullName: "Someone else" }, { fullName: "Changed" })).toBeNull();
    const latest = await service.audit_events.find({}, { orderBy: "occurredAt", ascending: false, limit: 2 });
    expect(latest).toHaveLength(2);
    expect(latest[0]!.occurredAt >= latest[1]!.occurredAt).toBe(true);
  });
});
