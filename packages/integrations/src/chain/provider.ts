/**
 * The chain adapter: what Sagolik Close needs from a blockchain, and nothing
 * more. Record and verify only — there is deliberately no way to send or
 * receive money through this interface.
 *
 *  - Wallet proof of funds: check that a person controls a wallet (a signed
 *    message) and read its USDC balance.
 *  - Deal record: append a fingerprint to the SagolikDealRegistry contract
 *    and read back its confirmation.
 *  - Payment evidence: read the USDC transfers in a transaction someone
 *    points us to (sent directly between the parties' own wallets).
 */
import type { Address, Hex } from "viem";
import type { ProviderInfo } from "../common";

export type LiveChainNetwork = "base" | "base-sepolia" | "local";

export interface ChainInfo extends ProviderInfo {
  network: "sandbox" | LiveChainNetwork;
  chainId: number;
  /** Shown to people: "Base", "Base Sepolia (test network)", "Sandbox chain (demo)". */
  networkLabel: string;
  registry: Address | null;
  usdc: Address;
  /** True when records can be written (a recording key is configured). */
  canRecord: boolean;
}

export interface UsdcBalance {
  /** Whole cents (USDC has 6 decimals; fractions of a cent are dropped). */
  cents: number;
  blockNumber: string;
  asOf: string;
}

export interface RecordEntry {
  dealId: Hex;
  kind: Hex;
  digest: Hex;
}

export type RecordState =
  /** `known: false` means the network has no trace of the transaction (not yet propagated, or dropped). */
  | { state: "pending"; known: boolean }
  /** The transaction ran and failed (nothing was appended), so it is safe to submit the entry again. */
  | { state: "failed"; reason: string }
  | { state: "confirmed"; entry: RecordEntry; sequence: number; head: Hex; blockNumber: string; recordedAt: string };

export interface Submitted {
  txHash: Hex;
  /** The recording account's nonce. A replacement reuses it, so at most one of the two can ever land. */
  nonce: number;
}

export interface UsdcTransfer {
  from: Address;
  to: Address;
  cents: number;
}

export interface UsdcTransfers {
  status: "pending" | "failed" | "confirmed";
  transfers: UsdcTransfer[];
  blockNumber?: string;
  confirmations?: number;
  at?: string;
}

export interface RecordOptions {
  /** Re-send a stuck or dropped submission: same nonce, higher fees. */
  replacing?: Submitted;
  /**
   * Called once the transaction is signed and before it is sent. Saving the
   * hash here means a crash in between loses nothing: the hash is known, and
   * a replacement with the same nonce can follow.
   */
  beforeSend?: (signed: Submitted) => Promise<void>;
}

export interface ChainProvider {
  readonly info: ChainInfo;
  /** Signed-message check. Works for ordinary wallets and smart-contract wallets (EIP-1271). */
  verifyWalletSignature(opts: { address: Address; message: string; signature: Hex }): Promise<boolean>;
  usdcBalance(address: Address): Promise<UsdcBalance>;
  /** Submits one record to the registry and resolves once it is sent (not yet confirmed). */
  record(entry: RecordEntry, opts?: RecordOptions): Promise<Submitted>;
  recordState(txHash: Hex): Promise<RecordState>;
  /** True once the recording account has used this nonce in a mined transaction (so nothing else with it can land). */
  nonceSpent(nonce: number): Promise<boolean>;
  /** The registry's state for one deal: entries so far and the running hash. */
  dealOf(dealId: Hex): Promise<{ entries: number; head: Hex }>;
  /** USDC transfers inside a transaction (read-only evidence for a payment the parties made themselves). */
  usdcTransfersIn(txHash: Hex): Promise<UsdcTransfers>;
  /** Link to a public block explorer, or null. */
  txUrl(hash: Hex): string | null;
  addressUrl(address: Address): string | null;
}
