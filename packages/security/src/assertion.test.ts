import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertionJwks, signUserAssertion } from "./assertion";

/**
 * Cross-language contract: this test and services/money/internal/assertion
 * both pin the same vector. Ed25519 is deterministic, so the TypeScript signer
 * must reproduce the exact token and the Go verifier must accept it.
 * Regenerate with UPDATE_VECTORS=1 only for a deliberate contract change.
 */
const VECTOR = fileURLToPath(new URL("../../../services/money/internal/assertion/testdata/web-vector.json", import.meta.url));

// TEST-ONLY key: seed bytes 0x00..0x1f. Never used outside tests.
const seed = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });

const now = new Date("2026-09-23T12:00:00Z");
const input = {
  userId: "4a6a4324-5fc8-4baa-a828-14210de77d3c",
  transactionId: "a8db1096-1336-4467-8fd9-6415bd8939c0",
  role: "buyer",
  aal2: true,
  stepUpAt: new Date("2026-09-23T11:58:30Z"),
};

describe("user assertion (money service contract)", () => {
  const token = signUserAssertion(input, { privateKey, kid: "web-test-1" }, { now, jti: "vector-jti-0000000001" });
  const jwks = assertionJwks(privateKey, "web-test-1");

  it("matches the shared vector byte for byte", () => {
    const vector = { now: now.toISOString(), jwks, token };
    if (process.env.UPDATE_VECTORS === "1") writeFileSync(VECTOR, `${JSON.stringify(vector, null, 2)}\n`);
    expect(JSON.parse(readFileSync(VECTOR, "utf8"))).toEqual(vector);
  });

  it("carries the expected claims and a 60-second lifetime", () => {
    const [h, c] = token.split(".").slice(0, 2).map((s) => JSON.parse(Buffer.from(s!, "base64url").toString()));
    expect(h).toEqual({ alg: "EdDSA", typ: "JWT", kid: "web-test-1" });
    expect(c.exp - c.iat).toBe(60);
    expect(c).toMatchObject({ iss: "sagolik-web", aud: "sagolik-money", sub: input.userId, txn: input.transactionId, aal: "aal2" });
  });

  it("publishes only public key material", () => {
    expect(JSON.stringify(jwks)).not.toContain('"d"');
    expect(createPublicKey(privateKey).asymmetricKeyType).toBe("ed25519");
  });
});
