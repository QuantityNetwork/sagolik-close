/**
 * Base (and Base Sepolia, and a local test node) through viem. Reads are
 * public; the only write is SagolikDealRegistry.record, sent by a recording
 * account that holds RECORDER_ROLE and nothing else. Nothing here can move
 * anyone's money: the contract has no payable functions, and the recording
 * account only ever pays its own gas.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  InsufficientFundsError,
  isAddressEqual,
  keccak256,
  NonceTooLowError,
  parseEventLogs,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, hardhat } from "viem/chains";
import { ProviderError } from "../common";
import type { ChainInfo, ChainProvider, LiveChainNetwork, RecordEntry, RecordOptions, RecordState, Submitted, UsdcBalance, UsdcTransfers } from "./provider";
import { usdcToCents } from "./records";
import { DEAL_REGISTRY_ABI } from "./registry-contract";

/** Circle's USDC on each network. */
export const BASE_USDC = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const satisfies Record<Exclude<LiveChainNetwork, "local">, Address>;

const NETWORKS: Record<LiveChainNetwork, { chain: Chain; id: string; label: string; mode: ChainInfo["mode"]; explorer: string | null; confirmations: number }> = {
  base: { chain: base, id: "base", label: "Base", mode: "production", explorer: "https://basescan.org", confirmations: 3 },
  "base-sepolia": { chain: baseSepolia, id: "base_sepolia", label: "Base Sepolia (test network)", mode: "sandbox", explorer: "https://sepolia.basescan.org", confirmations: 3 },
  local: { chain: hardhat, id: "local_chain", label: "Local test chain", mode: "sandbox", explorer: null, confirmations: 1 },
};

export interface BaseChainOptions {
  network: LiveChainNetwork;
  /** JSON-RPC endpoint; defaults to the network's public endpoint. */
  rpcUrl?: string;
  registry: Address;
  /** The recording account's key. Without it (or `recorder`) everything works except `record`. */
  recorderKey?: Hex;
  /** Or the recording account itself, when its key signs elsewhere (Key Vault's HSM) and can't be handed over. */
  recorder?: LocalAccount;
  /** Local test networks only: the token to read as USDC. */
  usdc?: Address;
  /** Blocks on top of the one holding a transaction before it counts as confirmed. */
  confirmations?: number;
}

export class BaseChainProvider implements ChainProvider {
  readonly info: ChainInfo;
  private readonly client: PublicClient;
  private readonly chain: Chain;
  private readonly registry: Address;
  private readonly account: LocalAccount | null;
  private readonly explorer: string | null;
  private readonly confirmations: number;
  /** Submissions from this process go out one at a time, so they never race for a nonce. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: BaseChainOptions) {
    const n = NETWORKS[opts.network];
    const usdc = opts.network === "local" ? opts.usdc : BASE_USDC[opts.network];
    if (!usdc) throw new Error("A local test network needs the address of a token to read as USDC.");
    this.chain = n.chain;
    this.client = createPublicClient({ chain: n.chain, transport: http(opts.rpcUrl, { retryCount: 2, timeout: 15_000 }) }) as PublicClient;
    if (opts.recorder && opts.recorderKey) throw new Error("Give the recording account or its key, not both.");
    this.account = opts.recorder ?? (opts.recorderKey ? privateKeyToAccount(opts.recorderKey) : null);
    this.registry = getAddress(opts.registry);
    this.explorer = n.explorer;
    this.confirmations = opts.confirmations ?? n.confirmations;
    this.info = {
      id: n.id,
      displayName: n.label,
      mode: n.mode,
      network: opts.network,
      chainId: n.chain.id,
      networkLabel: n.label,
      registry: this.registry,
      usdc: getAddress(usdc),
      canRecord: this.account !== null,
    };
  }

  /** The recording account's address (fund it with a little ETH for gas). */
  get recorderAddress(): Address | null {
    return this.account?.address ?? null;
  }

  async verifyWalletSignature(opts: { address: Address; message: string; signature: Hex }): Promise<boolean> {
    // Ordinary wallets are checked locally; smart-contract wallets (EIP-1271/6492) through the network.
    try {
      return await this.client.verifyMessage(opts);
    } catch (e) {
      if (isNetworkError(e)) throw this.unavailable(e);
      return false;
    }
  }

  async usdcBalance(address: Address): Promise<UsdcBalance> {
    return this.read(async () => {
      const block = await this.client.getBlock();
      const raw = await this.client.readContract({ address: this.info.usdc, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(address)], blockNumber: block.number });
      return { cents: usdcToCents(raw), blockNumber: block.number.toString(), asOf: new Date(Number(block.timestamp) * 1000).toISOString() };
    });
  }

  record(entry: RecordEntry, opts: RecordOptions = {}): Promise<Submitted> {
    const run = this.queue.then(() => this.submit(entry, opts));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async submit(entry: RecordEntry, { replacing, beforeSend }: RecordOptions): Promise<Submitted> {
    const account = this.account;
    if (!account) throw new ProviderError(this.info.id, "RECORDING_NOT_CONFIGURED", "On-chain recording isn't set up yet.", { action: "contact_support" });
    let signed: Submitted;
    let raw: Hex;
    try {
      const args = [entry.dealId, entry.kind, entry.digest] as const;
      // Dry run first: a refusal (missing role, empty field) surfaces as the contract's own error, before any fee is spent.
      await this.client.simulateContract({ address: this.registry, abi: DEAL_REGISTRY_ABI, functionName: "record", args, account });
      const nonce = replacing?.nonce ?? (await this.client.getTransactionCount({ address: account.address, blockTag: "pending" }));
      const fees = await this.fees(replacing);
      const wallet = createWalletClient({ account, chain: this.chain, transport: http(this.opts.rpcUrl, { retryCount: 0, timeout: 15_000 }) });
      const request = await wallet.prepareTransactionRequest({ to: this.registry, data: encodeFunctionData({ abi: DEAL_REGISTRY_ABI, functionName: "record", args }), nonce, ...fees });
      raw = await wallet.signTransaction(request);
      signed = { txHash: keccak256(raw), nonce };
    } catch (e) {
      throw this.writeError(e);
    }
    await beforeSend?.(signed);
    try {
      await this.client.sendRawTransaction({ serializedTransaction: raw });
    } catch (e) {
      throw this.writeError(e);
    }
    return signed;
  }

  /**
   * Generous fee caps (twice the current base fee): an entry costs a fraction
   * of a cent on Base, and a cap that can absorb a fee spike keeps it from
   * getting stuck. A replacement must outbid the original by at least 10%.
   */
  private async fees(replacing?: Submitted): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    const [block, tip] = await Promise.all([this.client.getBlock(), this.client.estimateMaxPriorityFeePerGas()]);
    let maxPriorityFeePerGas = tip;
    let maxFeePerGas = (block.baseFeePerGas ?? 0n) * 2n + tip;
    if (replacing) {
      const original = await this.client.getTransaction({ hash: replacing.txHash }).catch(() => null);
      const bump = (fresh: bigint, old: bigint | undefined) => {
        const raised = (fresh * 5n) / 4n;
        const outbid = old ? (old * 5n) / 4n : 0n;
        return raised > outbid ? raised : outbid;
      };
      maxPriorityFeePerGas = bump(maxPriorityFeePerGas, original?.maxPriorityFeePerGas);
      maxFeePerGas = bump(maxFeePerGas, original?.maxFeePerGas);
      if (maxFeePerGas < maxPriorityFeePerGas) maxFeePerGas = maxPriorityFeePerGas;
    }
    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  async recordState(txHash: Hex): Promise<RecordState> {
    return this.read(async () => {
      const receipt = await this.receipt(txHash);
      if (receipt === "unknown") return { state: "pending", known: false };
      if (receipt === "pending") return { state: "pending", known: true };
      if (receipt.status === "reverted") return { state: "failed", reason: "reverted" };
      if (!(await this.deepEnough(receipt))) return { state: "pending", known: true };
      const event = parseEventLogs({ abi: DEAL_REGISTRY_ABI, eventName: "Recorded", logs: receipt.logs }).find((l) => isAddressEqual(l.address, this.registry));
      if (!event) return { state: "failed", reason: "no_record_event" };
      return {
        state: "confirmed",
        entry: { dealId: event.args.dealId, kind: event.args.kind, digest: event.args.digest },
        sequence: Number(event.args.sequence),
        head: event.args.head,
        blockNumber: receipt.blockNumber.toString(),
        recordedAt: new Date(Number(event.args.recordedAt) * 1000).toISOString(),
      };
    });
  }

  async nonceSpent(nonce: number): Promise<boolean> {
    if (!this.account) return false;
    const address = this.account.address;
    return this.read(async () => (await this.client.getTransactionCount({ address, blockTag: "latest" })) > nonce);
  }

  async dealOf(dealId: Hex) {
    return this.read(async () => {
      const [entries, head] = await this.client.readContract({ address: this.registry, abi: DEAL_REGISTRY_ABI, functionName: "dealOf", args: [dealId] });
      return { entries: Number(entries), head };
    });
  }

  async usdcTransfersIn(txHash: Hex): Promise<UsdcTransfers> {
    return this.read(async () => {
      const receipt = await this.receipt(txHash);
      if (receipt === "unknown" || receipt === "pending") return { status: "pending", transfers: [] };
      if (receipt.status === "reverted") return { status: "failed", transfers: [] };
      const [tip, block] = await Promise.all([this.client.getBlockNumber(), this.client.getBlock({ blockNumber: receipt.blockNumber })]);
      const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })
        .filter((l) => isAddressEqual(l.address, this.info.usdc))
        .map((l) => ({ from: getAddress(l.args.from), to: getAddress(l.args.to), cents: usdcToCents(l.args.value) }));
      return {
        status: "confirmed",
        transfers,
        blockNumber: receipt.blockNumber.toString(),
        confirmations: Number(tip - receipt.blockNumber) + 1,
        at: new Date(Number(block.timestamp) * 1000).toISOString(),
      };
    });
  }

  txUrl(hash: Hex): string | null {
    return this.explorer ? `${this.explorer}/tx/${hash}` : null;
  }

  addressUrl(address: Address): string | null {
    return this.explorer ? `${this.explorer}/address/${address}` : null;
  }

  // ------------------------------------------------------------------ helpers

  private async receipt(hash: Hex): Promise<TransactionReceipt | "pending" | "unknown"> {
    try {
      return await this.client.getTransactionReceipt({ hash });
    } catch (e) {
      if (!(e instanceof TransactionReceiptNotFoundError)) throw e;
    }
    try {
      await this.client.getTransaction({ hash });
      return "pending";
    } catch (e) {
      if (e instanceof TransactionNotFoundError) return "unknown";
      throw e;
    }
  }

  private async deepEnough(receipt: TransactionReceipt): Promise<boolean> {
    if (this.confirmations <= 1) return true;
    const tip = await this.client.getBlockNumber();
    return tip - receipt.blockNumber + 1n >= BigInt(this.confirmations);
  }

  private async read<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw this.unavailable(e);
    }
  }

  private unavailable(cause: unknown) {
    return new ProviderError(this.info.id, "RPC_UNAVAILABLE", `We couldn't reach ${this.info.networkLabel}. Please try again in a moment.`, { retryable: true, action: "retry", cause });
  }

  private writeError(e: unknown): ProviderError {
    if (e instanceof ProviderError) return e;
    if (e instanceof BaseError) {
      const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
      if (revert instanceof ContractFunctionRevertedError) {
        const name = revert.data?.errorName;
        if (name === "AccessControlUnauthorizedAccount") {
          return new ProviderError(this.info.id, "RECORDER_NOT_AUTHORISED", "The recording account isn't authorised on the deal registry.", { action: "contact_support", cause: e });
        }
        return new ProviderError(this.info.id, "INVALID_ENTRY", "The deal registry refused this entry.", { cause: e });
      }
      if (e.walk((x) => x instanceof InsufficientFundsError)) {
        return new ProviderError(this.info.id, "RECORDER_OUT_OF_GAS", "The recording account needs a little ETH for network fees.", { retryable: true, action: "contact_support", cause: e });
      }
      if (e.walk((x) => x instanceof NonceTooLowError) || /underpriced|already known|nonce too low/i.test(e.message)) {
        return new ProviderError(this.info.id, "NONCE_CONFLICT", "Another submission used the same slot; this one will be retried.", { retryable: true, action: "retry", cause: e });
      }
    }
    return this.unavailable(e);
  }
}

function isNetworkError(e: unknown): boolean {
  return e instanceof BaseError && /HttpRequestError|TimeoutError|fetch failed|ECONNREFUSED/i.test(`${e.name} ${e.message}`);
}
