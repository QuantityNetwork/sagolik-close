import { type Hex, hexToBigInt, numberToHex, recoverTransactionAddress, type TransactionSerializedEIP1559, verifyMessage } from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { type Secp256k1Signer, secp256k1Account } from "./evm-account";

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const KEY: Hex = "0x8b3d5c1a2f4e6d7c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c";

/** Stands in for Key Vault's ES256K: signs the digest as given and returns r || s, optionally in the high-s form. */
function localSigner(key: Hex, highS = false): Secp256k1Signer {
  const account = privateKeyToAccount(key);
  return {
    publicKey: account.publicKey,
    async signDigest(digest) {
      const sig = await sign({ hash: `0x${Buffer.from(digest).toString("hex")}`, privateKey: key });
      const s = highS ? N - hexToBigInt(sig.s) : hexToBigInt(sig.s);
      return Buffer.from((sig.r.slice(2) + numberToHex(s, { size: 32 }).slice(2)).padStart(128, "0"), "hex");
    },
  };
}

describe("HSM-backed Ethereum account", () => {
  const local = privateKeyToAccount(KEY);

  it("has the key's address and signs messages exactly like a local key", async () => {
    const account = await secp256k1Account(localSigner(KEY));
    expect(account.address).toBe(local.address);
    const message = "deal record: recording account check";
    const signature = await account.signMessage({ message });
    expect(signature).toBe(await local.signMessage({ message }));
    expect(await verifyMessage({ address: account.address, message, signature })).toBe(true);
  });

  it("turns a high-s signature into Ethereum's low-s form", async () => {
    const account = await secp256k1Account(localSigner(KEY, true));
    const message = "low s please";
    expect(await account.signMessage({ message })).toBe(await local.signMessage({ message }));
  });

  it("signs EIP-1559 transactions that recover to the recording address", async () => {
    const account = await secp256k1Account(localSigner(KEY, true));
    const tx = { chainId: 84532, type: "eip1559", nonce: 7, to: "0x0000000000000000000000000000000000000001", data: "0x1234", gas: 90_000n, maxFeePerGas: 2_000_000n, maxPriorityFeePerGas: 1_000_000n, value: 0n } as const;
    const signed = await account.signTransaction(tx);
    expect(signed).toBe(await local.signTransaction(tx));
    expect(await recoverTransactionAddress({ serializedTransaction: signed as TransactionSerializedEIP1559 })).toBe(local.address);
  });

  it("refuses a signature made by another key", async () => {
    const other = localSigner("0x1111111111111111111111111111111111111111111111111111111111111111");
    const account = await secp256k1Account({ publicKey: local.publicKey, signDigest: other.signDigest });
    await expect(account.signMessage({ message: "x" })).rejects.toThrow(/doesn't match/);
  });
});
