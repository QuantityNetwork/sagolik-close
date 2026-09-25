import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type PlaidJwk, PlaidWebhookVerifier } from "./plaid-webhook";

const KID = "6c5516e1-92dc-479e-a8ff-5a51992e0001";

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  return { privateKey, jwk: { alg: "ES256", crv: "P-256", kid: KID, kty: "EC", x: jwk.x, y: jwk.y, expired_at: null } satisfies PlaidJwk };
}

function signPlaid(key: KeyObject, body: string, iat: number, kid = KID, alg = "ES256") {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const input = `${enc({ alg, kid, typ: "JWT" })}.${enc({ iat, request_body_sha256: createHash("sha256").update(body).digest("hex") })}`;
  return `${input}.${sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

describe("Plaid webhook verification", () => {
  const now = Date.UTC(2026, 8, 25, 12);
  const nowSec = now / 1000;
  const body = '{\n  "webhook_type": "ITEM",\n  "webhook_code": "ERROR"\n}';

  it("accepts a fresh, correctly signed body and caches the key", async () => {
    const { privateKey, jwk } = keypair();
    let fetches = 0;
    const v = new PlaidWebhookVerifier(async (kid) => (fetches++, kid === KID ? jwk : null), () => now);
    expect(await v.verify(signPlaid(privateKey, body, nowSec - 30), body)).toBeNull();
    expect(await v.verify(signPlaid(privateKey, body, nowSec), body)).toBeNull();
    expect(fetches).toBe(1);
  });

  it("rejects tampering, staleness, other keys and algorithms", async () => {
    const { privateKey, jwk } = keypair();
    const other = keypair();
    const v = new PlaidWebhookVerifier(async (kid) => (kid === KID ? jwk : null), () => now);
    expect(await v.verify(signPlaid(privateKey, body, nowSec), body.replace("ERROR", "LOGIN_REPAIRED"))).toBe("body_mismatch");
    expect(await v.verify(signPlaid(privateKey, body, nowSec - 301), body)).toBe("stale");
    expect(await v.verify(signPlaid(privateKey, body, nowSec + 120), body)).toBe("stale");
    expect(await v.verify(signPlaid(other.privateKey, body, nowSec), body)).toBe("bad_signature");
    expect(await v.verify(signPlaid(privateKey, body, nowSec, "00000000-0000-0000-0000-000000000000"), body)).toBe("unknown_kid");
    expect(await v.verify(signPlaid(privateKey, body, nowSec, KID, "HS256"), body)).toBe("unexpected_alg");
    expect(await v.verify(null, body)).toBe("malformed_token");
    expect(await v.verify("a.b.c", body)).toBe("malformed_token");
  });

  it("rejects keys Plaid has expired", async () => {
    const { privateKey, jwk } = keypair();
    const v = new PlaidWebhookVerifier(async () => ({ ...jwk, expired_at: nowSec - 1 }), () => now);
    expect(await v.verify(signPlaid(privateKey, body, nowSec), body)).toBe("expired_key");
  });
});
