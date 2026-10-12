/**
 * In-memory chain for the demo and tests. Records follow the registry
 * contract's rules exactly (same sequence numbers, same running hash), so a
 * receipt made here replays the same way it would on Base.
 *
 * Demo wallets are fictional. Their keys are derived from public labels, so
 * anyone can recompute them: they exist only here and must never hold real funds.
 */
import { randomBytes } from "node:crypto";
import { getAddress, isHex, keccak256, size, slice, stringToHex, toHex, verifyMessage, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ProviderError } from "../common";
import { globalSingleton } from "../singleton";
import type { ChainInfo, ChainProvider, RecordEntry, RecordOptions, RecordState, Submitted, UsdcBalance, UsdcTransfers } from "./provider";
import { chainHead, usdcToCents } from "./records";

type SandboxTx =
  | { type: "record"; entry: RecordEntry; sequence: number; head: Hex; blockNumber: bigint; at: string }
  | { type: "transfer"; from: Address; to: Address; raw: bigint; blockNumber: bigint; at: string };

interface SandboxChainState {
  block: bigint;
  nonce: number;
  deals: Map<Hex, { entries: number; head: Hex }>;
  txs: Map<Hex, SandboxTx>;
  balances: Map<Address, bigint>;
  outage: boolean;
}

const fresh = (): SandboxChainState => ({ block: 1n, nonce: 0, deals: new Map(), txs: new Map(), balances: new Map(), outage: false });

/** A stable, obviously-made-up address for a sandbox label. */
const sandboxAddress = (label: string) => getAddress(slice(keccak256(stringToHex(`sagolik-close/sandbox/${label}`)), 12));

export const SANDBOX_REGISTRY = sandboxAddress("registry");
export const SANDBOX_USDC = sandboxAddress("usdc");
/** The sandbox is a demo, so its deal ids need no secret. Live networks require CHAIN_DEAL_SALT. */
export const SANDBOX_DEAL_SALT = "sagolik-close/sandbox-deal-salt/not-a-secret";

/** A fictional wallet for one demo holder (a user id). Anyone can derive its key: demo use only. */
export function demoWallet(holder: string) {
  const account = privateKeyToAccount(keccak256(stringToHex(`sagolik-close/demo-wallet/${holder}`)));
  return { address: account.address, sign: (message: string) => account.signMessage({ message }) };
}

const lower = (h: Hex) => h.toLowerCase() as Hex;

export class SandboxChainProvider implements ChainProvider {
  readonly info: ChainInfo = {
    id: "sandbox_chain",
    displayName: "Sandbox chain",
    mode: "mock",
    network: "sandbox",
    // The conventional chain id for local development networks; the sandbox isn't a real network.
    chainId: 31337,
    networkLabel: "Sandbox chain (demo)",
    registry: SANDBOX_REGISTRY,
    usdc: SANDBOX_USDC,
    canRecord: true,
  };
  private state = globalSingleton("sandbox_chain", fresh);

  async verifyWalletSignature(opts: { address: Address; message: string; signature: Hex }): Promise<boolean> {
    try {
      return await verifyMessage(opts);
    } catch {
      return false;
    }
  }

  async usdcBalance(address: Address): Promise<UsdcBalance> {
    this.up();
    return { cents: usdcToCents(this.state.balances.get(this.address(address)) ?? 0n), blockNumber: this.state.block.toString(), asOf: new Date().toISOString() };
  }

  async record(entry: RecordEntry, opts: RecordOptions = {}): Promise<Submitted> {
    this.up();
    for (const [field, value] of Object.entries(entry)) {
      if (!isHex(value, { strict: true }) || size(value) !== 32) throw new ProviderError(this.info.id, "INVALID_ENTRY", "This record entry is malformed.", { cause: field });
    }
    // The contract's own checks, in its order.
    if (BigInt(entry.dealId) === 0n) throw new ProviderError(this.info.id, "EMPTY_DEAL_ID", "This record entry is incomplete.");
    if (BigInt(entry.kind) === 0n) throw new ProviderError(this.info.id, "EMPTY_KIND", "This record entry is incomplete.");
    if (BigInt(entry.digest) === 0n) throw new ProviderError(this.info.id, "EMPTY_DIGEST", "This record entry is incomplete.");
    const signed = { txHash: lower(toHex(randomBytes(32))), nonce: opts.replacing?.nonce ?? this.state.nonce++ };
    await opts.beforeSend?.(signed);
    this.up();
    this.append(entry, signed.txHash);
    return signed;
  }

  async recordState(txHash: Hex): Promise<RecordState> {
    const tx = this.state.txs.get(lower(txHash));
    if (!tx || tx.type !== "record") return { state: "pending", known: false };
    return { state: "confirmed", entry: tx.entry, sequence: tx.sequence, head: tx.head, blockNumber: tx.blockNumber.toString(), recordedAt: tx.at };
  }

  async nonceSpent(nonce: number): Promise<boolean> {
    return nonce < this.state.nonce;
  }

  async dealOf(dealId: Hex) {
    return this.state.deals.get(lower(dealId)) ?? { entries: 0, head: zeroHash };
  }

  async usdcTransfersIn(txHash: Hex): Promise<UsdcTransfers> {
    const tx = this.state.txs.get(lower(txHash));
    if (!tx) return { status: "pending", transfers: [] };
    const transfers = tx.type === "transfer" ? [{ from: tx.from, to: tx.to, cents: usdcToCents(tx.raw) }] : [];
    return { status: "confirmed", transfers, blockNumber: tx.blockNumber.toString(), confirmations: Number(this.state.block - tx.blockNumber) + 1, at: tx.at };
  }

  txUrl(): string | null {
    return null;
  }

  addressUrl(): string | null {
    return null;
  }

  // ------------------------------------------------------------------ sandbox controls

  /** Sets a wallet's USDC balance (demo scripting). */
  setUsdcBalance(address: Address, cents: number) {
    this.state.balances.set(this.address(address), BigInt(Math.round(cents)) * 10_000n);
  }

  /** Simulates a person sending USDC from their own wallet. Sagolik never does this; the sandbox stands in for the wallet app. */
  simulateTransfer(opts: { from: Address; to: Address; cents: number }): Hex {
    const from = this.address(opts.from);
    const to = this.address(opts.to);
    const raw = BigInt(Math.round(opts.cents)) * 10_000n;
    const balance = this.state.balances.get(from) ?? 0n;
    if (raw <= 0n || balance < raw) throw new ProviderError(this.info.id, "INSUFFICIENT_BALANCE", "This demo wallet doesn't hold enough USDC.");
    this.state.balances.set(from, balance - raw);
    this.state.balances.set(to, (this.state.balances.get(to) ?? 0n) + raw);
    const hash = lower(toHex(randomBytes(32)));
    this.state.txs.set(hash, { type: "transfer", from, to, raw, blockNumber: this.mine(), at: new Date().toISOString() });
    return hash;
  }

  /** Replays a persisted entry under its original hash and block (restores the demo after a restart). */
  hydrateRecord(entry: RecordEntry, txHash: Hex, at: string, blockNumber?: string): { sequence: number; head: Hex } {
    const hash = lower(txHash);
    const known = this.state.txs.get(hash);
    if (known?.type === "record") return { sequence: known.sequence, head: known.head };
    this.append(entry, hash, at, blockNumber ? BigInt(blockNumber) : undefined);
    const tx = this.state.txs.get(hash) as Extract<SandboxTx, { type: "record" }>;
    return { sequence: tx.sequence, head: tx.head };
  }

  /** Simulates the network being unreachable (exercises retries). */
  setOutage(on: boolean) {
    this.state.outage = on;
  }

  /** Forgets everything (a fresh demo). */
  reset() {
    Object.assign(this.state, fresh());
  }

  private append(entry: RecordEntry, txHash: Hex, at = new Date().toISOString(), block?: bigint): Hex {
    const dealId = lower(entry.dealId);
    const deal = this.state.deals.get(dealId) ?? { entries: 0, head: zeroHash };
    const sequence = deal.entries + 1;
    const head = chainHead(deal.head, entry.kind, entry.digest, sequence);
    this.state.deals.set(dealId, { entries: sequence, head });
    const hash = lower(txHash);
    // A restored entry keeps its block; the chain carries on above the highest one.
    if (block !== undefined && block > this.state.block) this.state.block = block;
    this.state.txs.set(hash, { type: "record", entry: { dealId, kind: lower(entry.kind), digest: lower(entry.digest) }, sequence, head, blockNumber: block ?? this.mine(), at });
    return hash;
  }

  private mine(): bigint {
    this.state.block += 1n;
    return this.state.block;
  }

  private address(a: string): Address {
    try {
      return getAddress(a);
    } catch {
      throw new ProviderError(this.info.id, "INVALID_ADDRESS", "That isn't a valid wallet address.");
    }
  }

  private up() {
    if (this.state.outage) throw new ProviderError(this.info.id, "RPC_UNAVAILABLE", "We couldn't reach the network. Please try again in a moment.", { retryable: true, action: "retry" });
  }
}
