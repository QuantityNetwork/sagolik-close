/**
 * An Ethereum account whose private key lives in Azure Key Vault's HSM: a
 * secp256k1 key (Key Vault curve "P-256K"), created inside the vault, that
 * never leaves it. Signing sends a 32-byte hash to Key Vault (algorithm
 * ES256K) and gets back the raw signature; we normalise it the way Ethereum
 * requires (low s, EIP-2) and work out the recovery bit locally.
 *
 * Used for the deal-record recording account: it can only append fingerprints
 * to the registry and pay its own gas, and with this it can't be copied out
 * of the vault either.
 */
import type { TokenCredential } from "@azure/identity";
import { CryptographyClient, KeyClient } from "@azure/keyvault-keys";
import {
  bytesToHex,
  type Hex,
  hashMessage,
  hashTypedData,
  hexToBigInt,
  isAddressEqual,
  keccak256,
  numberToHex,
  recoverAddress,
  type Signature,
  serializeSignature,
  serializeTransaction,
} from "viem";
import { type LocalAccount, publicKeyToAddress, toAccount } from "viem/accounts";

/** secp256k1 group order. */
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** What the account needs from Key Vault (tests pass a local stand-in). */
export interface Secp256k1Signer {
  /** Uncompressed public key: 0x04 || x || y. */
  publicKey: Hex;
  /** The exact key version that signs (Key Vault keys). */
  keyId?: string;
  /** Signs a 32-byte digest as-is and returns r || s (64 bytes), like Key Vault's ES256K. */
  signDigest(digest: Uint8Array): Promise<Uint8Array>;
}

/** Reads the key's public half from Key Vault and signs through it. */
export async function keyVaultSecp256k1Signer(keyId: string, credential: TokenCredential): Promise<Secp256k1Signer> {
  const url = new URL(keyId);
  const [, , name, version] = url.pathname.split("/");
  if (!name) throw new Error("The key id looks like https://<vault>.vault.azure.net/keys/<name>[/<version>].");
  const key = await new KeyClient(url.origin, credential).getKey(name, version ? { version } : undefined);
  const jwk = key.key;
  if (!jwk?.x || !jwk.y || jwk.crv !== "P-256K" || !(jwk.kty === "EC" || jwk.kty === "EC-HSM")) {
    throw new Error("The recording key must be a Key Vault EC key on curve P-256K (secp256k1).");
  }
  // Pin the version that was read, so a rotated key can't silently change the account's address.
  const crypto = new CryptographyClient(key.id ?? keyId, credential);
  return {
    publicKey: bytesToHex(new Uint8Array([4, ...jwk.x, ...jwk.y])),
    keyId: key.id,
    signDigest: async (digest) => (await crypto.sign("ES256K", digest)).result,
  };
}

export async function secp256k1Account(signer: Secp256k1Signer): Promise<LocalAccount> {
  const address = publicKeyToAddress(signer.publicKey);

  async function sign(hash: Hex): Promise<Signature> {
    const raw = await signer.signDigest(Buffer.from(hash.slice(2), "hex"));
    if (raw.length !== 64) throw new Error("Key Vault returned an unexpected signature length.");
    const r = hexToBigInt(bytesToHex(raw.slice(0, 32)));
    let s = hexToBigInt(bytesToHex(raw.slice(32)));
    if (r === 0n || r >= N || s === 0n || s >= N) throw new Error("Key Vault returned an invalid signature.");
    if (s > N / 2n) s = N - s; // Ethereum accepts only the low-s form (EIP-2).
    for (const yParity of [0, 1]) {
      const signature = { r: numberToHex(r, { size: 32 }), s: numberToHex(s, { size: 32 }), yParity };
      if (isAddressEqual(await recoverAddress({ hash, signature }), address)) return signature;
    }
    throw new Error("Key Vault's signature doesn't match the recording key.");
  }

  return toAccount({
    address,
    async signMessage({ message }) {
      return serializeSignature(await sign(hashMessage(message)));
    },
    async signTransaction(transaction, options) {
      const serializer = options?.serializer ?? serializeTransaction;
      const signature = await sign(keccak256(await serializer(transaction)));
      return serializer(transaction, signature);
    },
    async signTypedData(typedData) {
      return serializeSignature(await sign(hashTypedData(typedData)));
    },
  });
}

/** The recording account backed by a Key Vault key id. */
export async function keyVaultEvmAccount(keyId: string, credential: TokenCredential): Promise<LocalAccount> {
  return secp256k1Account(await keyVaultSecp256k1Signer(keyId, credential));
}
