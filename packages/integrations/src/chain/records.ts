/**
 * How a deal record entry is built. Pure functions, shared by the services,
 * the sandbox chain and anyone verifying a receipt independently.
 *
 *  dealId  = HMAC-SHA256(salt, "sagolik-close/deal/v1:" + transactionId)
 *            Unlinkable to the transaction without the deployment's secret salt.
 *  digest  = keccak256(canonical JSON of the receipt)
 *            The receipt includes a random 32-byte nonce, so its contents
 *            (amounts, document hashes, dates) can't be guessed from the digest.
 *  head    = keccak256(abi.encode(previousHead, kind, digest, sequence))
 *            Exactly the contract's rule (SagolikDealRegistry.chain).
 */
import { createHmac, randomBytes } from "node:crypto";
import { encodeAbiParameters, hexToString, keccak256, stringToHex, toHex, trim, zeroHash, type Hex } from "viem";

export const RECORD_KINDS = [
  "deal.opened",
  "milestone.completed",
  "document.version",
  "instruction.verified",
  "funds.received",
  "ownership.transferred",
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/** A short ASCII label as the contract's bytes32 kind (readable on a block explorer). */
export function kindHex(kind: string): Hex {
  const bytes = new TextEncoder().encode(kind);
  if (bytes.length === 0 || bytes.length > 32) throw new Error(`Record kind must be 1–32 bytes: ${kind}`);
  return stringToHex(kind, { size: 32 });
}

export function kindLabel(kind: Hex): string {
  return hexToString(trim(kind, { dir: "right" }));
}

export function dealIdFor(salt: string, transactionId: string): Hex {
  return `0x${createHmac("sha256", salt).update(`sagolik-close/deal/v1:${transactionId}`).digest("hex")}`;
}

export function newNonce(): Hex {
  return toHex(randomBytes(32));
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** JSON with object keys sorted at every level and no whitespace: one value, one string. */
export function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k] as Json)}`)
      .join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Receipts can't contain non-finite numbers.");
  return JSON.stringify(value);
}

/** The off-chain receipt behind one entry. Only the parties see it; the chain sees its digest. */
export interface RecordReceipt {
  v: 1;
  dealId: Hex;
  kind: RecordKind;
  /** Facts about the event, never names or contact details. */
  facts: Record<string, string | number | boolean | null>;
  occurredAt: string;
  nonce: Hex;
}

export function receiptDigest(receipt: RecordReceipt): Hex {
  return keccak256(stringToHex(canonicalJson(receipt as unknown as Json)));
}

export function chainHead(previous: Hex, kind: Hex, digest: Hex, sequence: number | bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }], [previous, kind, digest, BigInt(sequence)]));
}

/** Replays a deal's entries (in sequence order) and returns the head the contract should report. */
export function replayHead(entries: Array<{ kind: Hex; digest: Hex; sequence: number }>): Hex {
  return entries.reduce<Hex>((head, e) => chainHead(head, e.kind, e.digest, e.sequence), zeroHash);
}

/** USDC has 6 decimals: 1 cent = 10,000 base units. Fractions of a cent are dropped. */
export function usdcToCents(raw: bigint): number {
  return Number(raw / 10_000n);
}
