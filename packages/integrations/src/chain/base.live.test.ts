import { secp256k1Account } from "@sagolik/azure";
import { createPublicClient, createWalletClient, getAddress, hexToBigInt, http, keccak256, numberToHex, parseEther, toHex, type Abi, type Account, type Address, type Hex } from "viem";
import { mnemonicToAccount, privateKeyToAccount, sign } from "viem/accounts";
import { hardhat } from "viem/chains";
import { describe, expect, it } from "vitest";
import { BaseChainProvider } from "./base";
import { dealIdFor, kindHex, replayHead } from "./records";
import { DEAL_REGISTRY_ABI, DEAL_REGISTRY_BYTECODE } from "./registry-contract";
import { TEST_USDC_ABI, TEST_USDC_BYTECODE } from "./test-usdc-contract";

/**
 * The real adapter against a local Hardhat node running the compiled
 * contracts (packages/contracts/scripts/integration.sh starts one):
 *   CHAIN_IT_RPC_URL=http://127.0.0.1:8545 npx vitest run packages/integrations/src/chain/base.live.test.ts
 */
const rpc = process.env.CHAIN_IT_RPC_URL;

// Hardhat's public development accounts. Local networks only.
const MNEMONIC = "test test test test test test test test test test test junk";
const dev = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const keyOf = (i: number) => toHex(dev(i).getHdKey().privateKey!);

describe.skipIf(!!rpc || !process.env.CI_REQUIRE_CHAIN_IT)("chain integration configuration", () => {
  it("has a node to test against", () => {
    throw new Error("CI_REQUIRE_CHAIN_IT is set but CHAIN_IT_RPC_URL is not");
  });
});

describe.skipIf(!rpc)("Base adapter (local node)", () => {
  const transport = http(rpc);
  const client = createPublicClient({ chain: hardhat, transport });
  const as = (account: Account) => createWalletClient({ account, chain: hardhat, transport });
  const mined = (hash: Hex) => client.waitForTransactionReceipt({ hash });
  async function deploy(account: Account, abi: Abi, bytecode: Hex, args: unknown[]): Promise<Address> {
    const receipt = await mined(await as(account).deployContract({ abi, bytecode, args }));
    return getAddress(receipt.contractAddress!);
  }

  it("proves wallet control and balances, appends records and reads payments", { timeout: 60_000 }, async () => {
    const [admin, recorder, buyer, outsider] = [dev(0), dev(1), dev(2), dev(3)];
    const usdc = await deploy(admin, TEST_USDC_ABI, TEST_USDC_BYTECODE, []);
    const registry = await deploy(admin, DEAL_REGISTRY_ABI, DEAL_REGISTRY_BYTECODE, [admin.address, recorder.address]);
    const chain = new BaseChainProvider({ network: "local", rpcUrl: rpc, registry, recorderKey: keyOf(1), usdc });
    expect(chain.info).toMatchObject({ chainId: 31337, canRecord: true, registry, usdc });
    expect(chain.recorderAddress).toBe(recorder.address);

    // Proof of funds: a signed message, then a balance read.
    await mined(await as(admin).writeContract({ address: usdc, abi: TEST_USDC_ABI, functionName: "mint", args: [buyer.address, 25_000_000_000n] }));
    expect((await chain.usdcBalance(buyer.address)).cents).toBe(2_500_000);
    const message = "close.sagolik.com: confirm you control this wallet.";
    const signature = await buyer.signMessage({ message });
    expect(await chain.verifyWalletSignature({ address: buyer.address, message, signature })).toBe(true);
    expect(await chain.verifyWalletSignature({ address: outsider.address, message, signature })).toBe(false);
    expect(await chain.verifyWalletSignature({ address: buyer.address, message: `${message}!`, signature })).toBe(false);

    // The deal record: every entry confirms with the head we compute ourselves.
    const dealId = dealIdFor("integration-salt".repeat(2), "tx-1");
    const entries = [
      { kind: kindHex("deal.opened"), digest: toHex(1n, { size: 32 }) },
      { kind: kindHex("milestone.completed"), digest: toHex(2n, { size: 32 }) },
    ];
    const sent = [];
    for (const [i, e] of entries.entries()) {
      const submitted = await chain.record({ dealId, ...e });
      sent.push(submitted);
      await mined(submitted.txHash);
      expect(await chain.recordState(submitted.txHash)).toMatchObject({ state: "confirmed", sequence: i + 1, head: replayHead(entries.slice(0, i + 1).map((x, j) => ({ ...x, sequence: j + 1 }))) });
    }
    expect(sent[1]!.nonce).toBe(sent[0]!.nonce + 1);
    expect(await chain.dealOf(dealId)).toEqual({ entries: 2, head: replayHead(entries.map((x, j) => ({ ...x, sequence: j + 1 }))) });
    expect(await chain.recordState(`0x${"ab".repeat(32)}`)).toEqual({ state: "pending", known: false });

    // A replacement for something that already landed can't land too.
    await expect(chain.record({ dealId, ...entries[0]! }, { replacing: sent[0]! })).rejects.toMatchObject({ code: "NONCE_CONFLICT" });
    expect((await chain.dealOf(dealId)).entries).toBe(2);

    // The hash is handed over before sending; if saving it fails, nothing is sent.
    const third = { dealId, kind: kindHex("ownership.transferred"), digest: toHex(3n, { size: 32 }) };
    await expect(chain.record(third, { beforeSend: async () => Promise.reject(new Error("database unavailable")) })).rejects.toThrow("database unavailable");
    expect((await chain.dealOf(dealId)).entries).toBe(2);
    let saved: Hex | undefined;
    const sentThird = await chain.record(third, { beforeSend: async (s) => void (saved = s.txHash) });
    expect(saved).toBe(sentThird.txHash);
    await mined(sentThird.txHash);
    expect(await chain.recordState(sentThird.txHash)).toMatchObject({ state: "confirmed", sequence: 3 });

    // Only the recording account can append, and only with a key.
    const rogue = new BaseChainProvider({ network: "local", rpcUrl: rpc, registry, recorderKey: keyOf(3), usdc });
    await expect(rogue.record({ dealId, ...entries[0]! })).rejects.toMatchObject({ code: "RECORDER_NOT_AUTHORISED" });
    const readOnly = new BaseChainProvider({ network: "local", rpcUrl: rpc, registry, usdc });
    expect(readOnly.info.canRecord).toBe(false);
    await expect(readOnly.record({ dealId, ...entries[0]! })).rejects.toMatchObject({ code: "RECORDING_NOT_CONFIGURED" });

    // Payment evidence: the buyer pays from their own wallet; we only read it.
    const pay = await as(buyer).writeContract({ address: usdc, abi: TEST_USDC_ABI, functionName: "transfer", args: [outsider.address, 1_000_000_000n] });
    await mined(pay);
    expect(await chain.usdcTransfersIn(pay)).toMatchObject({ status: "confirmed", transfers: [{ from: buyer.address, to: outsider.address, cents: 100_000 }], confirmations: 1 });

    // The registry can't take money.
    await expect(as(outsider).sendTransaction({ to: registry, value: 1n })).rejects.toThrow();
  });

  it("records through an account whose key never enters the process (Key Vault's HSM in production)", { timeout: 60_000 }, async () => {
    // Stands in for Key Vault's ES256K operation: it gets a 32-byte digest and returns r || s, in whichever s form it likes.
    const hsmKey = keccak256(toHex("sagolik: stand-in for a key that lives in an HSM"));
    const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    let signatures = 0;
    const recorder = await secp256k1Account({
      publicKey: privateKeyToAccount(hsmKey).publicKey,
      async signDigest(digest) {
        signatures++;
        const sig = await sign({ hash: toHex(digest), privateKey: hsmKey });
        const highS = N - hexToBigInt(sig.s); // the high-s form, which Ethereum refuses unless normalised
        return Buffer.from(sig.r.slice(2) + numberToHex(highS, { size: 32 }).slice(2), "hex");
      },
    });
    const [admin] = [dev(0)];
    await mined(await as(admin).sendTransaction({ to: recorder.address, value: parseEther("1") }));
    const registry = await deploy(admin, DEAL_REGISTRY_ABI, DEAL_REGISTRY_BYTECODE, [admin.address, recorder.address]);
    const chain = new BaseChainProvider({ network: "local", rpcUrl: rpc, registry, recorder, usdc: admin.address });
    expect(chain.info.canRecord).toBe(true);
    expect(chain.recorderAddress).toBe(recorder.address);

    const dealId = dealIdFor("integration-salt".repeat(2), "tx-hsm");
    const entry = { kind: kindHex("deal.opened"), digest: toHex(7n, { size: 32 }) };
    const submitted = await chain.record({ dealId, ...entry });
    await mined(submitted.txHash);
    expect(await chain.recordState(submitted.txHash)).toMatchObject({ state: "confirmed", sequence: 1, head: replayHead([{ ...entry, sequence: 1 }]) });
    expect(signatures).toBe(1);
    expect(() => new BaseChainProvider({ network: "local", rpcUrl: rpc, registry, recorder, recorderKey: keyOf(1), usdc: admin.address })).toThrow(/not both/);
  });
});
