/**
 * Envelope-style field encryption for provider tokens and full account
 * numbers. AES-256-GCM, versioned keys to support rotation:
 *
 *   ciphertext format:  <keyVersion>.<iv b64url>.<tag b64url>.<data b64url>
 *
 * In production, DATA_ENCRYPTION_KEYS should be sourced from a KMS-backed
 * secret store. Rotation: add a new version first in the list, keep old
 * versions until `reencrypt` has run over existing rows.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface KeyRing {
  current: string;
  keys: Map<string, Buffer>;
}

export function parseKeyRing(spec: string): KeyRing {
  const keys = new Map<string, Buffer>();
  let current: string | undefined;
  for (const entry of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [version, b64] = entry.split(":");
    if (!version || !b64) throw new Error("Invalid key ring entry");
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) throw new Error(`Encryption key ${version} must be 32 bytes`);
    keys.set(version, key);
    current ??= version;
  }
  if (!current) throw new Error("Empty key ring");
  return { current, keys };
}

export function encryptField(plaintext: string, ring: KeyRing, aad = ""): string {
  const key = ring.keys.get(ring.current)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ring.current, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptField(ciphertext: string, ring: KeyRing, aad = ""): string {
  const [version, iv, tag, data] = ciphertext.split(".");
  if (!version || !iv || !tag || !data) throw new Error("Malformed ciphertext");
  const key = ring.keys.get(version);
  if (!key) throw new Error(`Unknown key version ${version}`);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function keyVersionOf(ciphertext: string): string {
  return ciphertext.split(".")[0] ?? "";
}
