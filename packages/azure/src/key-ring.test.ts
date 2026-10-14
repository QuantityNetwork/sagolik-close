import { constants, generateKeyPairSync, privateDecrypt, publicEncrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type KeyWrapper, newWrappedDataKey, unwrapKeyRing } from "./key-ring";

/** RSA-OAEP with SHA-256, as Key Vault's RSA-OAEP-256 does. The private half plays the HSM. */
function rsaWrapper(): KeyWrapper {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const opts = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" };
  return {
    async wrapKey(alg, key) {
      expect(alg).toBe("RSA-OAEP-256");
      return { result: publicEncrypt({ key: publicKey, ...opts }, key) };
    },
    async unwrapKey(alg, wrapped) {
      expect(alg).toBe("RSA-OAEP-256");
      return { result: privateDecrypt({ key: privateKey, ...opts }, wrapped) };
    },
  };
}

describe("data keys wrapped by Key Vault", () => {
  it("wraps new keys and unwraps the ring, newest first", async () => {
    const hsm = rsaWrapper();
    const v2 = await newWrappedDataKey("v2", hsm);
    const v1 = await newWrappedDataKey("v1", hsm);
    expect(v2).toMatch(/^v2:[A-Za-z0-9+/=]{100,}$/);
    const ring = await unwrapKeyRing(`${v2}, ${v1}`, hsm);
    const [a, b] = ring.split(",");
    expect(a).toMatch(/^v2:/);
    expect(b).toMatch(/^v1:/);
    expect(Buffer.from(a!.slice(3), "base64")).toHaveLength(32);
  });

  it("refuses malformed configuration and keys of the wrong size", async () => {
    const hsm = rsaWrapper();
    await expect(unwrapKeyRing("", hsm)).rejects.toThrow(/empty/);
    await expect(unwrapKeyRing("not-a-key", hsm)).rejects.toThrow(/v1:<base64/);
    const short = await hsm.wrapKey("RSA-OAEP-256", new Uint8Array(16));
    await expect(unwrapKeyRing(`v1:${Buffer.from(short.result).toString("base64")}`, hsm)).rejects.toThrow(/32 bytes/);
    await expect(newWrappedDataKey("2", hsm)).rejects.toThrow(/v2/);
  });
});
