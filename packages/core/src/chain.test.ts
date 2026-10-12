/**
 * Wallet proof of funds and the deal record, through the real services on the
 * sandbox chain (which follows the registry contract's rules exactly).
 */
import { type ChainProvider, demoWallet, kindHex, ProviderError, type RecordEntry, type RecordOptions, type SandboxChainProvider } from "@sagolik/integrations";
import { keccak256, stringToHex, type Hex } from "viem";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ServiceContext } from "./context";
import { DEMO_TRANSACTION_ID } from "./demo/seed";
import { toAppError } from "./errors";
import {
  type AppendInput,
  appendRecord,
  checkWalletFunds,
  connectWallet,
  dealRecordView,
  fundsChecksFor,
  getTransaction,
  myWallets,
  recordEscrowMovement,
  removeWallet,
  syncDealRecords,
  verifyDealRecord,
  walletChallenge,
} from "./index";
import { createTestHarness, type TestHarness } from "./testing";

const M = DEMO_TRANSACTION_ID;

async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    expect(toAppError(e).code).toBe(code);
    return toAppError(e);
  }
  throw new Error(`expected ${code} but the call succeeded`);
}

const at = (ctx: ServiceContext, minutes: number): ServiceContext => ({ ...ctx, now: () => new Date(Date.now() + minutes * 60_000) });

describe("wallet proof of funds", () => {
  let h: TestHarness;
  let chain: SandboxChainProvider;
  let olivia: ServiceContext;
  let wallet: ReturnType<typeof demoWallet>;

  beforeAll(async () => {
    h = await createTestHarness();
    chain = h.providers.mocks.chain!;
    olivia = await h.as("olivia.carter");
    wallet = demoWallet(h.userId("olivia.carter"));
  });
  beforeEach(() => chain.setUsdcBalance(wallet.address, 25_000_000)); // $250,000 in USDC (the demo script's amount)

  it("asks for a free, readable signature bound to the person, closing and wallet", async () => {
    const c = await walletChallenge(olivia, M, wallet.address.toLowerCase());
    expect(c.address).toBe(wallet.address);
    expect(c.message).toContain("localhost:3000 asks you to confirm you control this wallet.");
    expect(c.message).toContain(`Wallet: ${wallet.address}`);
    expect(c.message).toContain("Purpose: proof of funds for closing SC-DEMO-MAPLE");
    expect(c.message).toContain("does not send money, approve spending or give anyone access to your wallet");
    await expectCode(walletChallenge(olivia, M, "0x1234"), "bad_request");
    // Only the people paying can add a wallet.
    await expectCode(walletChallenge(await h.as("daniel.brooks"), M, wallet.address), "forbidden");
  });

  it("connects only with a valid signature from that wallet, and reads its USDC balance", async () => {
    const c = await walletChallenge(olivia, M, wallet.address);
    await expectCode(connectWallet(olivia, c.token, await demoWallet("someone else").sign(c.message)), "bad_request");
    await expectCode(connectWallet(olivia, c.token, "0xnope"), "bad_request");
    // Someone else can't use Olivia's request, and requests expire.
    const signature = await wallet.sign(c.message);
    await expectCode(connectWallet(await h.as("daniel.brooks"), c.token, signature), "bad_request");
    await expectCode(connectWallet(at(olivia, 11), c.token, signature), "bad_request");
    await expectCode(connectWallet(olivia, `${c.token.split(".")[0]}.forged`, signature), "bad_request");

    const w = await connectWallet(olivia, c.token, signature);
    expect(w).toMatchObject({ status: "verified", address: wallet.address, network: "sandbox", usdcBalance: 25_000_000 });
    // The same signed request twice is the same connection.
    expect((await connectWallet(olivia, c.token, signature)).id).toBe(w.id);
    expect((await myWallets(olivia, M)).map((x) => x.id)).toEqual([w.id]);
    expect(await myWallets(await h.as("daniel.brooks"), M)).toEqual([]);
  });

  it("checks the wallet against what the closing still needs; escrow sees the result, not the balance", async () => {
    const [w] = await myWallets(olivia, M);
    const ok = await checkWalletFunds(olivia, w!.id);
    expect(ok).toMatchObject({ sufficient: true, available: 25_000_000, required: 20_000_000, currency: "USD" });
    chain.setUsdcBalance(wallet.address, 1_000_000);
    expect(await checkWalletFunds(olivia, w!.id)).toMatchObject({ sufficient: false, available: 1_000_000 });

    const s = await getTransaction(olivia, M);
    const forEscrow = await fundsChecksFor(await h.as("marcus.lee"), s);
    const result = forEscrow.find((r) => r.sourceId === w!.id)!;
    expect(result).toMatchObject({ source: "wallet", sufficient: false, requiredAmount: 20_000_000, ownershipProven: true });
    expect(result.sourceLabel).toBe(`USDC wallet on Sandbox chain (demo) •••• ${wallet.address.slice(-4)}`);
    expect(JSON.stringify(forEscrow)).not.toContain(wallet.address);
    // An agent isn't escrow or a verifier: no results.
    expect(await fundsChecksFor(await h.as("jessica.morgan"), s)).toEqual([]);
    await expectCode(checkWalletFunds(await h.as("daniel.brooks"), w!.id), "not_found");
  });

  it("backs escrow's 'funds received' with the USDC transaction the buyer sent from their own wallet", async () => {
    const marcus = await h.as("marcus.lee", { stepUp: true });
    const escrowWallet = demoWallet("escrow-partner").address;
    const hash = chain.simulateTransfer({ from: wallet.address, to: escrowWallet, cents: 5_000_000 });
    const before = (await getTransaction(marcus, M)).escrow!.receivedAmount;

    const wrong = await expectCode(recordEscrowMovement(marcus, M, { kind: "receipt", amount: 4_000_000, reference: "USDC 1", chainTxHash: hash }), "bad_request");
    expect(wrong.userMessage).toContain("$50,000.00");
    await expectCode(recordEscrowMovement(marcus, M, { kind: "disbursement", amount: 1_000_000, reference: "USDC 1", chainTxHash: hash }), "bad_request");
    await expectCode(recordEscrowMovement(marcus, M, { kind: "receipt", amount: 5_000_000, reference: "USDC 1", chainTxHash: keccak256(stringToHex("never sent")) }), "conflict");

    await recordEscrowMovement(marcus, M, { kind: "receipt", amount: 5_000_000, reference: "USDC 1", chainTxHash: hash });
    expect((await getTransaction(marcus, M)).escrow!.receivedAmount).toBe(before + 5_000_000);
    const entry = (await dealRecordView(marcus, M)).entries.find((e) => e.kind === "funds.received" && e.facts.evidenceTxHash === hash)!;
    expect(entry).toMatchObject({ status: "confirmed", facts: { amountCents: 5_000_000, evidenceUsdcCents: 5_000_000, evidenceTo: escrowWallet, evidenceFromVerifiedWallet: true } });
    // One payment backs one receipt.
    await expectCode(recordEscrowMovement(marcus, M, { kind: "receipt", amount: 5_000_000, reference: "USDC 2", chainTxHash: hash }), "conflict");
  });

  it("removes a wallet from the closing", async () => {
    const [w] = await myWallets(olivia, M);
    await removeWallet(olivia, w!.id);
    expect(await myWallets(olivia, M)).toEqual([]);
    await expectCode(checkWalletFunds(olivia, w!.id), "not_found");
  });
});

describe("deal record delivery and verification", () => {
  let h: TestHarness;
  let chain: SandboxChainProvider;
  let system: ServiceContext;
  let n = 0;
  const entry = (kind: "milestone.completed" | "funds.received" = "milestone.completed"): AppendInput => ({
    transactionId: M,
    kind,
    facts: kind === "funds.received" ? { amountCents: 100, currency: "USD", source: "escrow_report" } : { from: "a", to: `b${++n}` },
    occurredAt: new Date().toISOString(),
    dedupeKey: `test:${kind}:${++n}`,
  });

  beforeAll(async () => {
    h = await createTestHarness();
    chain = h.providers.mocks.chain!;
    system = h.system();
  });

  it("delivers at once, never duplicates a fact, and keeps money facts from people without financial access", async () => {
    const e = entry("funds.received");
    const first = await appendRecord(system, e);
    expect(first).toMatchObject({ status: "confirmed", sequence: expect.any(Number) });
    expect((await appendRecord(system, e))!.id).toBe(first!.id);
    await appendRecord(system, entry());
    const marcus = await dealRecordView(await h.as("marcus.lee"), M);
    const agent = await dealRecordView(await h.as("jessica.morgan"), M);
    expect(marcus.entries.some((x) => x.kind === "funds.received")).toBe(true);
    expect(agent.entries.some((x) => x.kind === "funds.received")).toBe(false);
    expect(agent.entries.some((x) => x.kind === "milestone.completed")).toBe(true);
    expect(await verifyDealRecord(await h.as("jessica.morgan"), M)).toMatchObject({ status: "match" });
  });

  it("keeps entries through an outage and sends them when the network is back", async () => {
    chain.setOutage(true);
    const queued = await appendRecord(system, entry());
    expect(queued).toMatchObject({ status: "queued", attempts: 1 });
    expect(queued!.lastError).toContain("couldn't reach");
    chain.setOutage(false);
    expect(await syncDealRecords(system)).toMatchObject({ submitted: 0, confirmed: 0 }); // not due yet
    expect(await syncDealRecords(at(system, 1))).toMatchObject({ confirmed: 1 });
    expect((await h.db.chain_records.get(queued!.id))!.status).toBe("confirmed");
    expect(await verifyDealRecord(await h.as("marcus.lee"), M)).toMatchObject({ status: "match" });
  });

  it("recovers when a process stops between saving and sending: same nonce, so only one can land", async () => {
    let crash = true;
    const flaky: ChainProvider = Object.assign(Object.create(chain) as ChainProvider, {
      record: async (e: RecordEntry, opts: RecordOptions = {}) => {
        if (!crash) return chain.record(e, opts);
        crash = false;
        await opts.beforeSend?.({ txHash: keccak256(stringToHex("saved but never sent")), nonce: 1_000_000 });
        throw new ProviderError("sandbox_chain", "RPC_UNAVAILABLE", "We couldn't reach the network.", { retryable: true });
      },
    });
    const ctx: ServiceContext = { ...system, providers: { ...system.providers, chain: flaky } };
    const row = (await appendRecord(ctx, entry()))!;
    expect(row).toMatchObject({ status: "submitted", txHash: keccak256(stringToHex("saved but never sent")), txNonce: 1_000_000 });
    await syncDealRecords(at(ctx, 5));
    expect((await h.db.chain_records.get(row.id))!.status).toBe("submitted"); // unseen, but not for long enough to re-send
    await syncDealRecords(at(ctx, 11));
    const done = (await h.db.chain_records.get(row.id))!;
    expect(done).toMatchObject({ status: "confirmed", txNonce: 1_000_000, previousTxHashes: [keccak256(stringToHex("saved but never sent"))] });
    expect(await verifyDealRecord(await h.as("marcus.lee"), M)).toMatchObject({ status: "match" });
  });

  it("stops and flags an entry the registry refuses", async () => {
    const refusing: ChainProvider = Object.assign(Object.create(chain) as ChainProvider, {
      record: async () => {
        throw new ProviderError("sandbox_chain", "RECORDER_NOT_AUTHORISED", "The recording account isn't authorised on the deal registry.", { action: "contact_support" });
      },
    });
    const row = (await appendRecord({ ...system, providers: { ...system.providers, chain: refusing } }, entry()))!;
    expect(row).toMatchObject({ status: "failed", lastError: "The recording account isn't authorised on the deal registry." });
    expect(await h.db.audit_events.findOne({ action: "chain.record_failed", resourceId: row.id })).not.toBeNull();
  });

  it("detects a record that diverges from our receipts, and refuses to rewrite history", async () => {
    const rows = await h.db.chain_records.find({ transactionId: M, status: "confirmed" });
    const confirmed = rows[0]!;
    await expect(h.db.chain_records.update(confirmed.id, { receipt: { forged: true } })).rejects.toThrow();
    await expect(h.db.chain_records.update(confirmed.id, { head: `0x${"0".repeat(64)}` })).rejects.toThrow();
    // An entry on the registry that we hold no receipt for.
    await chain.record({ dealId: confirmed.dealId as Hex, kind: kindHex("milestone.completed"), digest: keccak256(stringToHex("unknown")) });
    const v = await verifyDealRecord(await h.as("marcus.lee"), M);
    expect(v.status).toBe("mismatch");
    expect(v.problems[0]).toMatch(/holds \d+ entries for this deal; our confirmed receipts cover \d+/);
  });
});
