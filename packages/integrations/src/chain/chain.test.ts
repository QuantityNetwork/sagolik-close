import { encodeAbiParameters, keccak256, stringToHex, zeroHash, type Hex } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import { ProviderError } from "../common";
import { canonicalJson, chainHead, dealIdFor, kindHex, kindLabel, newNonce, receiptDigest, replayHead, usdcToCents, type RecordReceipt } from "./records";
import { demoWallet, SandboxChainProvider } from "./sandbox";

const digest = (label: string) => keccak256(stringToHex(label));

describe("record rules", () => {
  it("encodes kinds as readable bytes32 labels", () => {
    const k = kindHex("milestone.completed");
    expect(k).toHaveLength(66);
    expect(kindLabel(k)).toBe("milestone.completed");
    expect(() => kindHex("")).toThrow();
    expect(() => kindHex("x".repeat(33))).toThrow();
  });

  it("derives deal ids that can't be linked to a transaction without the salt", () => {
    const a = dealIdFor("salt-one".repeat(4), "tx-1");
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(dealIdFor("salt-one".repeat(4), "tx-1")).toBe(a);
    expect(dealIdFor("salt-two".repeat(4), "tx-1")).not.toBe(a);
    expect(dealIdFor("salt-one".repeat(4), "tx-2")).not.toBe(a);
  });

  it("serialises receipts canonically, so key order never changes the digest", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: true, y: null }], c: "x" } })).toBe('{"a":{"c":"x","d":[1,{"y":null,"z":true}]},"b":1}');
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
    const receipt: RecordReceipt = { v: 1, dealId: digest("deal"), kind: "funds.received", facts: { amountCents: 2500000, currency: "USD" }, occurredAt: "2026-10-01T12:00:00.000Z", nonce: newNonce() };
    const reordered = { nonce: receipt.nonce, occurredAt: receipt.occurredAt, facts: { currency: "USD", amountCents: 2500000 }, kind: receipt.kind, dealId: receipt.dealId, v: 1 } as RecordReceipt;
    expect(receiptDigest(reordered)).toBe(receiptDigest(receipt));
    // The nonce keeps identical facts from producing a guessable digest.
    expect(receiptDigest({ ...receipt, nonce: newNonce() })).not.toBe(receiptDigest(receipt));
  });

  it("chains heads exactly like the contract (keccak256 of abi.encode)", () => {
    const k = kindHex("deal.opened");
    const expected = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }], [zeroHash, k, digest("r1"), 1n]));
    expect(chainHead(zeroHash, k, digest("r1"), 1)).toBe(expected);
    const second = chainHead(expected, k, digest("r2"), 2);
    expect(
      replayHead([
        { kind: k, digest: digest("r1"), sequence: 1 },
        { kind: k, digest: digest("r2"), sequence: 2 },
      ]),
    ).toBe(second);
  });

  it("converts USDC base units to whole cents", () => {
    expect(usdcToCents(1_000_000n)).toBe(100);
    expect(usdcToCents(1_234_567_899n)).toBe(123_456);
    expect(usdcToCents(9_999n)).toBe(0);
  });
});

describe("sandbox chain", () => {
  const chain = new SandboxChainProvider();
  beforeEach(() => chain.reset());

  it("checks signatures from demo wallets like any wallet", async () => {
    const olivia = demoWallet("user-olivia");
    const message = "close.sagolik.com: confirm you control this wallet.";
    const signature = await olivia.sign(message);
    expect(await chain.verifyWalletSignature({ address: olivia.address, message, signature })).toBe(true);
    expect(await chain.verifyWalletSignature({ address: demoWallet("someone-else").address, message, signature })).toBe(false);
    expect(await chain.verifyWalletSignature({ address: olivia.address, message: `${message} (edited)`, signature })).toBe(false);
    expect(await chain.verifyWalletSignature({ address: olivia.address, message, signature: "0x1234" })).toBe(false);
    expect(demoWallet("user-olivia").address).toBe(olivia.address);
  });

  it("appends records with the contract's sequence and running hash", async () => {
    const deal = digest("deal-1");
    const entries = [
      { kind: kindHex("deal.opened"), digest: digest("r1") },
      { kind: kindHex("milestone.completed"), digest: digest("r2") },
    ];
    const hashes: Hex[] = [];
    for (const e of entries) hashes.push((await chain.record({ dealId: deal, ...e })).txHash);
    const expected = replayHead(entries.map((e, i) => ({ ...e, sequence: i + 1 })));
    expect(await chain.dealOf(deal)).toEqual({ entries: 2, head: expected });
    expect(await chain.recordState(hashes[1]!)).toMatchObject({ state: "confirmed", sequence: 2, head: expected });
    expect(await chain.recordState(digest("never sent"))).toEqual({ state: "pending", known: false });
    expect(await chain.dealOf(digest("another deal"))).toEqual({ entries: 0, head: zeroHash });
  });

  it("refuses incomplete or malformed entries, as the contract does", async () => {
    await expect(chain.record({ dealId: zeroHash, kind: kindHex("deal.opened"), digest: digest("x") })).rejects.toMatchObject({ code: "EMPTY_DEAL_ID" });
    await expect(chain.record({ dealId: digest("d"), kind: zeroHash, digest: digest("x") })).rejects.toMatchObject({ code: "EMPTY_KIND" });
    await expect(chain.record({ dealId: digest("d"), kind: kindHex("deal.opened"), digest: zeroHash })).rejects.toMatchObject({ code: "EMPTY_DIGEST" });
    await expect(chain.record({ dealId: "0x1234", kind: kindHex("deal.opened"), digest: digest("x") })).rejects.toMatchObject({ code: "INVALID_ENTRY" });
  });

  it("reports an outage as retryable", async () => {
    chain.setOutage(true);
    const err = await chain.record({ dealId: digest("d"), kind: kindHex("deal.opened"), digest: digest("x") }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.opts.retryable).toBe(true);
    chain.setOutage(false);
  });

  it("restores persisted entries under their original hashes", async () => {
    const deal = digest("deal-restore");
    const a = await chain.record({ dealId: deal, kind: kindHex("deal.opened"), digest: digest("r1") });
    const b = await chain.record({ dealId: deal, kind: kindHex("document.version"), digest: digest("r2") });
    const before = await chain.dealOf(deal);
    chain.reset();
    chain.hydrateRecord({ dealId: deal, kind: kindHex("deal.opened"), digest: digest("r1") }, a.txHash, "2026-10-01T00:00:00.000Z");
    chain.hydrateRecord({ dealId: deal, kind: kindHex("document.version"), digest: digest("r2") }, b.txHash, "2026-10-02T00:00:00.000Z");
    // Replaying the same entry twice is a no-op.
    chain.hydrateRecord({ dealId: deal, kind: kindHex("document.version"), digest: digest("r2") }, b.txHash, "2026-10-02T00:00:00.000Z");
    expect(await chain.dealOf(deal)).toEqual(before);
    expect(await chain.recordState(b.txHash)).toMatchObject({ state: "confirmed", sequence: 2, recordedAt: "2026-10-02T00:00:00.000Z" });
    // Restored entries keep their blocks, and the chain carries on above them.
    chain.reset();
    chain.hydrateRecord({ dealId: deal, kind: kindHex("deal.opened"), digest: digest("r1") }, a.txHash, "2026-10-01T00:00:00.000Z", "1007");
    expect(await chain.recordState(a.txHash)).toMatchObject({ blockNumber: "1007" });
    const next = await chain.record({ dealId: deal, kind: kindHex("document.version"), digest: digest("r3") });
    expect(Number((await chain.recordState(next.txHash) as { blockNumber: string }).blockNumber)).toBeGreaterThan(1007);
  });

  it("reads scripted USDC balances and the transfers a person makes from their own wallet", async () => {
    const buyer = demoWallet("buyer").address;
    const escrow = demoWallet("escrow").address;
    chain.setUsdcBalance(buyer, 5_000_000);
    expect((await chain.usdcBalance(buyer)).cents).toBe(5_000_000);
    expect((await chain.usdcBalance(escrow)).cents).toBe(0);
    const hash = chain.simulateTransfer({ from: buyer, to: escrow, cents: 1_250_000 });
    expect(await chain.usdcTransfersIn(hash)).toMatchObject({ status: "confirmed", transfers: [{ from: buyer, to: escrow, cents: 1_250_000 }], confirmations: 1 });
    expect((await chain.usdcBalance(buyer)).cents).toBe(3_750_000);
    expect(() => chain.simulateTransfer({ from: escrow, to: buyer, cents: 99_000_000 })).toThrow(ProviderError);
    await expect(chain.usdcBalance("0xnot-an-address" as Hex)).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
  });
});
