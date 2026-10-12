/**
 * The deal record: a tamper-evident log of a closing's key facts, anchored on
 * Base by the SagolikDealRegistry contract.
 *
 * For each fact (deal opened, a milestone, a signed document, verified
 * payment instructions, funds received by escrow, ownership transferred)
 * Sagolik keeps a receipt and appends its keccak-256 fingerprint to the
 * registry under a keyed deal id. Receipts hold facts only: no names,
 * contact details or account numbers. The chain alone reveals nothing about
 * the deal; anyone holding a receipt can recompute its fingerprint and find
 * it there. Nothing here moves money.
 *
 * Delivery is at-least-once and crash-safe: an entry's transaction hash is
 * saved before the transaction is sent, a stuck or dropped submission is
 * replaced with the same nonce (so at most one can land), and a confirmed
 * entry is final.
 */
import { createHash } from "node:crypto";
import { can } from "@sagolik/auth";
import { UniqueViolationError } from "@sagolik/database";
import {
  canonicalJson,
  type ChainProvider,
  dealIdFor,
  kindHex,
  isProviderError,
  newNonce,
  receiptDigest,
  replayHead,
  type RecordReceipt,
  type RecordState,
  SANDBOX_DEAL_SALT,
} from "@sagolik/integrations";
import type { ChainRecord, ChainRecordKind, DomainEventRow } from "@sagolik/types";
import type { Hex } from "viem";
import { type ServiceContext, asSystem, isUser } from "../context";
import { badRequest } from "../errors";
import { audit } from "../events";
import { accessContext, loadAuthorized } from "../snapshot";
import { newId, nowIso } from "../util";

/** Wait before retrying a failed submission; the last value repeats. */
const RETRY_MS = [30_000, 120_000, 600_000, 1_800_000, 3_600_000, 21_600_000];
/** A submission the network has never seen is re-sent with the same nonce after this long… */
const RESEND_UNKNOWN_MS = 10 * 60_000;
/** …and one that sits unconfirmed is re-sent with higher fees after this long. */
const RESEND_STUCK_MS = 30 * 60_000;
/** Between confirmation checks of a submitted entry. */
const CHECK_MS = 30_000;
/** How long a process holds an entry it is working on. */
const LEASE_MS = 2 * 60_000;

export type RecordFacts = RecordReceipt["facts"];

export const RECORD_KIND_LABELS: Record<ChainRecordKind, string> = {
  "deal.opened": "Deal opened",
  "milestone.completed": "Milestone reached",
  "document.version": "Signed document fingerprinted",
  "instruction.verified": "Payment instructions verified",
  "funds.received": "Funds received by escrow",
  "ownership.transferred": "Ownership transferred",
};

/** Entries about money are shown only to people with financial access (RLS applies the same rule). */
const MONEY_KINDS: readonly ChainRecordKind[] = ["instruction.verified", "funds.received"];

async function visibleKinds(ctx: ServiceContext, transactionId: string) {
  const s = await loadAuthorized(ctx, transactionId, "transaction.view");
  const money = !isUser(ctx.actor) || can(ctx.actor, "financial.view", accessContext(s));
  return { s, visible: (kind: ChainRecordKind) => money || !MONEY_KINDS.includes(kind) };
}

const later = (ctx: ServiceContext, ms: number) => new Date(ctx.now().getTime() + ms).toISOString();

function dealSalt(ctx: ServiceContext, chain: ChainProvider): string | null {
  if (ctx.env.CHAIN_DEAL_SALT) return ctx.env.CHAIN_DEAL_SALT;
  return chain.info.network === "sandbox" ? SANDBOX_DEAL_SALT : null;
}

/** The configured chain, when it can serve this entry (same network and registry). */
function chainFor(ctx: ServiceContext, row?: Pick<ChainRecord, "network" | "registry">): ChainProvider | null {
  const chain = ctx.providers.chain;
  if (!chain?.info.registry) return null;
  if (row && (row.network !== chain.info.network || row.registry.toLowerCase() !== chain.info.registry.toLowerCase())) return null;
  return chain;
}

export function dealRecordEnabled(ctx: ServiceContext): boolean {
  const chain = chainFor(ctx);
  return !!chain && dealSalt(ctx, chain) !== null;
}

export interface AppendInput {
  transactionId: string;
  kind: ChainRecordKind;
  facts: RecordFacts;
  occurredAt: string;
  /** One entry per fact, however often the fact is reported. */
  dedupeKey: string;
}

/**
 * Adds a fact to the deal record. Never throws: the record must not get in
 * the way of the closing. An entry that can't be sent now waits for a retry.
 */
export async function appendRecord(ctx: ServiceContext, input: AppendInput): Promise<ChainRecord | null> {
  try {
    const chain = chainFor(ctx);
    const salt = chain && dealSalt(ctx, chain);
    if (!chain || !salt) return null;
    const existing = await ctx.writer.chain_records.findOne({ dedupeKey: input.dedupeKey });
    if (existing) return existing;
    const dealId = dealIdFor(salt, input.transactionId);
    const receipt: RecordReceipt = { v: 1, dealId, kind: input.kind, facts: input.facts, occurredAt: input.occurredAt, nonce: newNonce() };
    const now = nowIso(ctx);
    let row: ChainRecord;
    try {
      row = await ctx.writer.chain_records.insert({
        id: newId(),
        transactionId: input.transactionId,
        kind: input.kind,
        dealId,
        receipt: receipt as unknown as Record<string, unknown>,
        digest: receiptDigest(receipt),
        dedupeKey: input.dedupeKey,
        network: chain.info.network,
        chainId: chain.info.chainId,
        registry: chain.info.registry!,
        status: "queued",
        txHash: null,
        txNonce: null,
        previousTxHashes: [],
        sequence: null,
        head: null,
        blockNumber: null,
        attempts: 0,
        lastError: null,
        nextAttemptAt: now,
        submittedAt: null,
        confirmedAt: null,
        recordedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (e) {
      // `code` rather than instanceof: the store may come from another copy of the database package.
      if (e instanceof UniqueViolationError || (e as { code?: unknown }).code === "conflict") return ctx.writer.chain_records.findOne({ dedupeKey: input.dedupeKey });
      throw e;
    }
    // Deliver now when this process records (local and demo); otherwise the worker does.
    if (ctx.outboxMode === "inline" && chain.info.canRecord) return await deliver(ctx, chain, row);
    return row;
  } catch (e) {
    ctx.log.error("deal record entry not created", { kind: input.kind, transactionId: input.transactionId, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

async function deliver(ctx: ServiceContext, chain: ChainProvider, row: ChainRecord): Promise<ChainRecord> {
  let current = row;
  if (current.status === "queued") current = await submit(ctx, chain, current);
  if (current.status === "submitted") current = await check(ctx, chain, current);
  return current;
}

/** Signs and sends one entry. The hash is saved before sending, so a crash in between loses nothing. */
async function submit(ctx: ServiceContext, chain: ChainProvider, row: ChainRecord): Promise<ChainRecord> {
  // Claim it first, so two processes never send the same entry at once.
  const claimed = await ctx.writer.chain_records.updateIf(row.id, { status: row.status, attempts: row.attempts }, { attempts: row.attempts + 1, nextAttemptAt: later(ctx, LEASE_MS) });
  if (!claimed) return (await ctx.writer.chain_records.get(row.id)) ?? row;
  const replacing = claimed.status === "submitted" && claimed.txHash && claimed.txNonce !== null ? { txHash: claimed.txHash as Hex, nonce: claimed.txNonce } : undefined;
  let current = claimed;
  try {
    await chain.record(
      { dealId: claimed.dealId as Hex, kind: kindHex(claimed.kind), digest: claimed.digest as Hex },
      {
        replacing,
        beforeSend: async (signed) => {
          current = await ctx.writer.chain_records.update(claimed.id, {
            status: "submitted",
            txHash: signed.txHash,
            txNonce: signed.nonce,
            previousTxHashes: claimed.txHash ? [...claimed.previousTxHashes, claimed.txHash] : claimed.previousTxHashes,
            submittedAt: nowIso(ctx),
            lastError: null,
            nextAttemptAt: later(ctx, CHECK_MS),
          });
        },
      },
    );
    return current;
  } catch (e) {
    const pe = isProviderError(e) ? e : null;
    const lastError = (pe?.userMessage ?? "The network couldn't be reached.").slice(0, 300);
    ctx.log.warn("deal record submission failed", { recordId: row.id, code: pe?.code, error: e instanceof Error ? e.message : String(e) });
    if (current.txHash !== claimed.txHash) {
      // Saved but maybe not sent: the confirmation check works out which, and re-sends if needed.
      return ctx.writer.chain_records.update(current.id, { lastError, nextAttemptAt: later(ctx, CHECK_MS) });
    }
    if (pe && !pe.opts.retryable) {
      await audit(asSystem(ctx, "deal_record"), { action: "chain.record_failed", resourceType: "chain_record", resourceId: row.id, transactionId: row.transactionId, metadata: { code: pe.code, kind: row.kind } });
      ctx.log.error("deal record entry needs attention", { recordId: row.id, code: pe.code });
      return ctx.writer.chain_records.update(current.id, { status: "failed", lastError, nextAttemptAt: null });
    }
    return ctx.writer.chain_records.update(current.id, { lastError, nextAttemptAt: later(ctx, RETRY_MS[Math.min(claimed.attempts - 1, RETRY_MS.length - 1)]!) });
  }
}

/** Checks a submitted entry: confirmed, failed (send again), or still pending (maybe replace it). */
async function check(ctx: ServiceContext, chain: ChainProvider, row: ChainRecord): Promise<ChainRecord> {
  const claimed = await ctx.writer.chain_records.updateIf(row.id, { status: "submitted", txHash: row.txHash }, { nextAttemptAt: later(ctx, LEASE_MS) });
  if (!claimed?.txHash) return (await ctx.writer.chain_records.get(row.id)) ?? row;
  const hashes = [claimed.txHash, ...[...claimed.previousTxHashes].reverse()] as Hex[];
  let latest: RecordState | null = null;
  try {
    for (const hash of hashes) {
      const state = await chain.recordState(hash);
      if (hash === claimed.txHash) latest = state;
      if (state.state === "confirmed") return await confirm(ctx, claimed, hash, state);
    }
    if (latest?.state === "failed") {
      // It ran and reverted, so nothing was appended: send it again.
      return ctx.writer.chain_records.update(claimed.id, { status: "queued", lastError: `The network rejected the submission (${latest.reason}).`, nextAttemptAt: nowIso(ctx) });
    }
    const known = latest?.state === "pending" && latest.known;
    if (!known && claimed.txNonce !== null && (await chain.nonceSpent(claimed.txNonce))) {
      // Its nonce went to another transaction, so it can never land: send it again with a fresh one.
      return ctx.writer.chain_records.update(claimed.id, { status: "queued", lastError: null, nextAttemptAt: nowIso(ctx) });
    }
    const age = ctx.now().getTime() - Date.parse(claimed.submittedAt ?? claimed.updatedAt);
    if ((!known && age >= RESEND_UNKNOWN_MS) || age >= RESEND_STUCK_MS) {
      if (!chain.info.canRecord) return ctx.writer.chain_records.update(claimed.id, { nextAttemptAt: later(ctx, CHECK_MS) });
      const resent = await submit(ctx, chain, claimed);
      return resent.status === "submitted" && resent.txHash !== claimed.txHash ? check(ctx, chain, resent) : resent;
    }
    return ctx.writer.chain_records.update(claimed.id, { nextAttemptAt: later(ctx, CHECK_MS) });
  } catch (e) {
    ctx.log.warn("deal record check failed", { recordId: row.id, error: e instanceof Error ? e.message : String(e) });
    return ctx.writer.chain_records.update(claimed.id, { nextAttemptAt: later(ctx, CHECK_MS * 4) });
  }
}

async function confirm(ctx: ServiceContext, row: ChainRecord, hash: Hex, state: Extract<RecordState, { state: "confirmed" }>): Promise<ChainRecord> {
  const matches = state.entry.dealId.toLowerCase() === row.dealId && state.entry.digest.toLowerCase() === row.digest && state.entry.kind.toLowerCase() === kindHex(row.kind);
  if (!matches) {
    // Our own signed transaction carrying something else would mean a serious fault: stop and say so.
    ctx.log.error("deal record confirmation doesn't match its entry", { recordId: row.id, txHash: hash });
    return ctx.writer.chain_records.update(row.id, { status: "failed", lastError: "The confirmed transaction doesn't carry this entry.", nextAttemptAt: null });
  }
  const all = [row.txHash, ...row.previousTxHashes].filter((h): h is string => !!h);
  const updated = await ctx.writer.chain_records.update(row.id, {
    status: "confirmed",
    txHash: hash,
    previousTxHashes: all.filter((h) => h !== hash),
    sequence: state.sequence,
    head: state.head,
    blockNumber: state.blockNumber,
    confirmedAt: nowIso(ctx),
    recordedAt: state.recordedAt,
    lastError: null,
    nextAttemptAt: null,
  });
  await audit(asSystem(ctx, "deal_record"), {
    action: "chain.record_confirmed",
    resourceType: "chain_record",
    resourceId: row.id,
    transactionId: row.transactionId,
    metadata: { kind: row.kind, network: row.network, sequence: state.sequence, txHash: hash },
  });
  return updated;
}

/**
 * Sends what's due and checks what's pending. The worker calls this every
 * tick; pages call it with `transactionId` (and, where a worker runs,
 * `confirmOnly`) so what people see is current.
 */
export async function syncDealRecords(ctx: ServiceContext, opts: { transactionId?: string; limit?: number; confirmOnly?: boolean } = {}) {
  const counts = { submitted: 0, confirmed: 0, failed: 0, waiting: 0 };
  const chain = chainFor(ctx);
  if (!chain) return counts;
  const limit = opts.limit ?? 25;
  const now = nowIso(ctx);
  const open = await ctx.writer.chain_records.find(
    { status: opts.confirmOnly ? ["submitted"] : ["queued", "submitted"], ...(opts.transactionId ? { transactionId: opts.transactionId } : {}) },
    { orderBy: "nextAttemptAt", limit: limit * 4 },
  );
  const due = open.filter((r) => (r.nextAttemptAt ?? "") <= now && chainFor(ctx, r)).slice(0, limit);
  for (const row of due) {
    if (row.status === "queued" && !chain.info.canRecord) {
      counts.waiting++;
      continue;
    }
    const before = row.status;
    const after = await deliver(ctx, chain, row);
    if (after.status === "confirmed") counts.confirmed++;
    else if (after.status === "failed") counts.failed++;
    else if (before === "queued" && after.status === "submitted") counts.submitted++;
    else counts.waiting++;
  }
  return counts;
}

// ----------------------------------------------------------------------------- reading and verifying

export interface DealRecordEntryView {
  id: string;
  kind: ChainRecordKind;
  label: string;
  facts: RecordFacts;
  occurredAt: string;
  status: ChainRecord["status"];
  sequence: number | null;
  digest: string;
  txHash: string | null;
  txUrl: string | null;
  blockNumber: string | null;
  recordedAt: string | null;
  networkLabel: string;
  lastError: string | null;
}

export interface DealRecordView {
  enabled: boolean;
  networkLabel: string | null;
  network: string | null;
  registry: string | null;
  registryUrl: string | null;
  canRecord: boolean;
  entries: DealRecordEntryView[];
}

/** The entries the viewer may see (money facts need financial access), newest first. */
export async function dealRecordView(ctx: ServiceContext, transactionId: string): Promise<DealRecordView> {
  const { visible } = await visibleKinds(ctx, transactionId);
  const chain = chainFor(ctx);
  if (chain) {
    await syncDealRecords(asSystem(ctx, "deal_record"), { transactionId, confirmOnly: ctx.outboxMode === "worker" }).catch((e) =>
      ctx.log.warn("deal record refresh failed", { transactionId, error: e instanceof Error ? e.message : String(e) }),
    );
  }
  const rows = (await ctx.db.chain_records.find({ transactionId }, { orderBy: "createdAt", ascending: false })).filter((r) => visible(r.kind));
  const label = (network: string) => (chain && chain.info.network === network ? chain.info.networkLabel : network === "base" ? "Base" : network === "base-sepolia" ? "Base Sepolia (test network)" : network === "sandbox" ? "Sandbox chain (demo)" : "Local test chain");
  return {
    enabled: !!chain && dealSalt(ctx, chain) !== null,
    network: chain?.info.network ?? null,
    networkLabel: chain?.info.networkLabel ?? null,
    registry: chain?.info.registry ?? null,
    registryUrl: chain?.info.registry ? chain.addressUrl(chain.info.registry) : null,
    canRecord: chain?.info.canRecord ?? false,
    entries: rows.map((r) => {
      const receipt = r.receipt as unknown as RecordReceipt;
      const sameChain = !!chain && !!chainFor(ctx, r);
      return {
        id: r.id,
        kind: r.kind,
        label: RECORD_KIND_LABELS[r.kind],
        facts: receipt.facts ?? {},
        occurredAt: receipt.occurredAt,
        status: r.status,
        sequence: r.sequence,
        digest: r.digest,
        txHash: r.txHash,
        txUrl: r.txHash && sameChain ? chain!.txUrl(r.txHash as Hex) : null,
        blockNumber: r.blockNumber,
        recordedAt: r.recordedAt,
        networkLabel: label(r.network),
        lastError: r.lastError,
      };
    }),
  };
}

export interface DealRecordVerification {
  status: "match" | "settling" | "mismatch";
  entries: number;
  onChainEntries: number;
  head: string;
  networkLabel: string;
  checkedAt: string;
  problems: string[];
}

/**
 * Checks our receipts against the public record: every receipt still hashes
 * to its fingerprint, and replaying them in order gives exactly the running
 * fingerprint the registry holds for this deal.
 */
export async function verifyDealRecord(ctx: ServiceContext, transactionId: string): Promise<DealRecordVerification> {
  const s = await loadAuthorized(ctx, transactionId, "transaction.view");
  const chain = chainFor(ctx);
  const salt = chain && dealSalt(ctx, chain);
  if (!chain || !salt) throw badRequest("The deal record isn't available right now.");
  const dealId = dealIdFor(salt, transactionId);
  // All entries, including money facts the viewer may not see: the result is all they learn.
  const rows = (await ctx.writer.chain_records.find({ transactionId, network: chain.info.network })).filter((r) => chainFor(ctx, r));
  const confirmed = rows.filter((r) => r.status === "confirmed").sort((a, b) => a.sequence! - b.sequence!);
  const settling = rows.some((r) => r.status === "queued" || r.status === "submitted");
  const problems: string[] = [];
  for (const r of confirmed) {
    if (r.dealId !== dealId) problems.push(`Entry ${r.sequence} belongs to a different deal id.`);
    if (receiptDigest(r.receipt as unknown as RecordReceipt) !== r.digest) problems.push(`Entry ${r.sequence}'s receipt no longer matches its fingerprint.`);
  }
  const contiguous = confirmed.every((r, i) => r.sequence === i + 1);
  const expected = replayHead(confirmed.map((r) => ({ kind: kindHex(r.kind), digest: r.digest as Hex, sequence: r.sequence! })));
  const onChain = await chain.dealOf(dealId);
  let status: DealRecordVerification["status"] = "match";
  if (problems.length) status = "mismatch";
  else if (onChain.entries === confirmed.length && contiguous && onChain.head === expected) status = "match";
  else if (settling && onChain.entries >= confirmed.length) status = "settling";
  else {
    status = "mismatch";
    problems.push(
      onChain.entries !== confirmed.length
        ? `${chain.info.networkLabel} holds ${onChain.entries} entries for this deal; our confirmed receipts cover ${confirmed.length}.`
        : "The running fingerprint on the network doesn't match our receipts.",
    );
  }
  await audit(ctx, {
    action: "chain.record_verified",
    resourceType: "transaction",
    resourceId: transactionId,
    transactionId,
    organizationId: s.transaction.organizationId,
    metadata: { status, entries: confirmed.length, onChainEntries: onChain.entries, network: chain.info.network },
  });
  return { status, entries: confirmed.length, onChainEntries: onChain.entries, head: onChain.head, networkLabel: chain.info.networkLabel, checkedAt: nowIso(ctx), problems };
}

/** Everything someone needs to check the record without Sagolik: receipts, hashes and the rules. */
export async function exportDealRecord(ctx: ServiceContext, transactionId: string) {
  const { s, visible } = await visibleKinds(ctx, transactionId);
  const chain = chainFor(ctx);
  const rows = (await ctx.db.chain_records.find({ transactionId, status: "confirmed" })).filter((r) => visible(r.kind)).sort((a, b) => a.sequence! - b.sequence!);
  await audit(ctx, { action: "chain.receipts_exported", resourceType: "transaction", resourceId: transactionId, transactionId, organizationId: s.transaction.organizationId, metadata: { entries: rows.length } });
  return {
    format: "sagolik-close/deal-record/v1",
    reference: s.transaction.reference,
    network: rows[0]?.network ?? chain?.info.network ?? null,
    chainId: rows[0]?.chainId ?? chain?.info.chainId ?? null,
    registry: rows[0]?.registry ?? chain?.info.registry ?? null,
    dealId: rows[0]?.dealId ?? null,
    howToVerify: [
      "digest = keccak256(UTF-8 bytes of the receipt as canonical JSON: object keys sorted at every level, no whitespace).",
      "The registry's Recorded event in txHash carries the same dealId, kind (the label as UTF-8, right-padded to 32 bytes), digest and sequence.",
      "head(n) = keccak256(abi.encode(bytes32 head(n-1), bytes32 kind, bytes32 digest, uint64 n)), head(0) = 0x00…00; SagolikDealRegistry.dealOf(dealId) returns the entry count and the latest head.",
      "Entries about money are included only for people with financial access; replaying the running head needs every entry.",
    ],
    entries: rows.map((r) => ({
      sequence: r.sequence,
      kind: r.kind,
      digest: r.digest,
      head: r.head,
      txHash: r.txHash,
      blockNumber: r.blockNumber,
      recordedAt: r.recordedAt,
      receipt: r.receipt,
    })),
  };
}

// ----------------------------------------------------------------------------- facts from domain events

/*
 * Each reaction turns a domain event into one entry. Facts are chosen so the
 * receipt proves what happened without saying who: states, categories,
 * fingerprints, amounts and public recording references, never names.
 */

export async function recordDealOpened(ctx: ServiceContext, e: DomainEventRow) {
  const tx = e.transactionId ? await ctx.writer.transactions.get(e.transactionId) : null;
  if (!tx) return;
  await appendRecord(ctx, {
    transactionId: tx.id,
    kind: "deal.opened",
    facts: { reference: tx.reference, type: tx.type, jurisdiction: tx.jurisdiction, currency: tx.currency },
    occurredAt: tx.createdAt,
    dedupeKey: `deal.opened:${tx.id}`,
  });
}

export async function recordMilestone(ctx: ServiceContext, e: DomainEventRow) {
  if (!e.transactionId) return;
  await appendRecord(ctx, {
    transactionId: e.transactionId,
    kind: "milestone.completed",
    facts: { from: String(e.payload.from ?? ""), to: String(e.payload.to ?? "") },
    occurredAt: e.createdAt,
    dedupeKey: `milestone.completed:${e.idempotencyKey}`,
  });
}

export async function recordSignedDocument(ctx: ServiceContext, e: DomainEventRow) {
  const doc = await ctx.writer.documents.get(e.aggregateId);
  const version = doc ? await ctx.writer.document_versions.findOne({ documentId: doc.id, version: doc.currentVersion }) : null;
  if (!doc || !version) return;
  await appendRecord(ctx, {
    transactionId: doc.transactionId,
    kind: "document.version",
    facts: { documentId: doc.id, category: doc.category, version: version.version, sha256: version.sha256, signed: version.isSigned },
    occurredAt: version.createdAt,
    dedupeKey: `document.version:${version.id}`,
  });
}

export async function recordVerifiedInstruction(ctx: ServiceContext, e: DomainEventRow) {
  const ins = await ctx.writer.bank_instructions.get(e.aggregateId);
  if (!ins || !ins.verifiedAt) return;
  // A fingerprint of the instructions as everyone saw them (the row itself can never change).
  const shown = { purpose: ins.purpose, version: ins.version, beneficiaryName: ins.beneficiaryName, bankName: ins.bankName, accountMask: ins.accountMask, routingIdentifier: ins.routingIdentifier, currency: ins.currency };
  await appendRecord(ctx, {
    transactionId: ins.transactionId,
    kind: "instruction.verified",
    facts: { instructionId: ins.id, purpose: ins.purpose, version: ins.version, method: ins.verificationMethod ?? null, fingerprint: createHash("sha256").update(canonicalJson(shown)).digest("hex") },
    occurredAt: ins.verifiedAt,
    dedupeKey: `instruction.verified:${ins.id}`,
  });
}

export async function recordFundsReceived(ctx: ServiceContext, e: DomainEventRow) {
  const escrow = await ctx.writer.escrow_accounts.get(e.aggregateId);
  if (!escrow) return;
  const p = e.payload as Record<string, unknown>;
  const evidence = Object.fromEntries(Object.entries(p).filter(([k, v]) => k.startsWith("evidence") && (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null))) as RecordFacts;
  await appendRecord(ctx, {
    transactionId: escrow.transactionId,
    kind: "funds.received",
    facts: { amountCents: Number(p.amount ?? 0), currency: escrow.currency, source: String(p.source ?? "escrow_report"), ...evidence },
    occurredAt: e.createdAt,
    dedupeKey: `funds.received:${e.idempotencyKey}`,
  });
}

export async function recordOwnershipTransferred(ctx: ServiceContext, e: DomainEventRow) {
  const recording = e.transactionId ? await ctx.writer.recordings.findOne({ transactionId: e.transactionId }) : null;
  if (!recording || recording.status !== "recorded") return;
  await appendRecord(ctx, {
    transactionId: recording.transactionId,
    kind: "ownership.transferred",
    facts: { registry: recording.registry, recordingReference: recording.recordingReference, recordedAt: recording.recordedAt, confirmationSource: recording.confirmationSource },
    occurredAt: recording.recordedAt ?? e.createdAt,
    dedupeKey: `ownership.transferred:${recording.transactionId}`,
  });
}
