/**
 * Data keys for field encryption, wrapped by a key-encryption key that lives
 * in Key Vault's HSM and never leaves it. Configuration holds only wrapped
 * keys (`DATA_KEYS_WRAPPED="v2:<base64>,v1:<base64>"`, newest first); they are
 * unwrapped once at start-up and kept in memory only.
 */
import { randomBytes } from "node:crypto";
import type { TokenCredential } from "@azure/identity";
import { CryptographyClient, type KeyWrapAlgorithm } from "@azure/keyvault-keys";

export const DATA_KEY_WRAP_ALGORITHM: KeyWrapAlgorithm = "RSA-OAEP-256";

/** The part of Key Vault's CryptographyClient used here (tests pass a fake). */
export interface KeyWrapper {
  wrapKey(algorithm: KeyWrapAlgorithm, key: Uint8Array): Promise<{ result: Uint8Array }>;
  unwrapKey(algorithm: KeyWrapAlgorithm, encryptedKey: Uint8Array): Promise<{ result: Uint8Array }>;
}

export function keyVaultWrapper(kekId: string, credential: TokenCredential): KeyWrapper {
  return new CryptographyClient(kekId, credential);
}

const ENTRY = /^(v\d+):([A-Za-z0-9+/=_-]+)$/;

/** Unwraps every data key and returns the key ring in the plain `v2:<base64>,v1:<base64>` form the app parses. */
export async function unwrapKeyRing(wrapped: string, wrapper: KeyWrapper): Promise<string> {
  const entries = wrapped.split(",").map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) throw new Error("DATA_KEYS_WRAPPED is empty.");
  const out: string[] = [];
  for (const entry of entries) {
    const m = entry.match(ENTRY);
    if (!m) throw new Error("DATA_KEYS_WRAPPED entries look like v1:<base64 wrapped key>.");
    const { result } = await wrapper.unwrapKey(DATA_KEY_WRAP_ALGORITHM, Buffer.from(m[2]!, "base64"));
    if (result.length !== 32) throw new Error(`Data key ${m[1]} didn't unwrap to 32 bytes.`);
    out.push(`${m[1]}:${Buffer.from(result).toString("base64")}`);
  }
  return out.join(",");
}

/** A new random data key, wrapped: what an operator adds to DATA_KEYS_WRAPPED when rotating. */
export async function newWrappedDataKey(version: string, wrapper: KeyWrapper): Promise<string> {
  if (!/^v\d+$/.test(version)) throw new Error("Versions look like v2.");
  const key = randomBytes(32);
  try {
    const { result } = await wrapper.wrapKey(DATA_KEY_WRAP_ALGORITHM, key);
    return `${version}:${Buffer.from(result).toString("base64")}`;
  } finally {
    key.fill(0);
  }
}
