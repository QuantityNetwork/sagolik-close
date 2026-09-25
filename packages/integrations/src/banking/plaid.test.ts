import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WebhookRejectedError } from "../common";
import { PlaidBankingProvider } from "./plaid";

const KID = "6c5516e1-92dc-479e-a8ff-5a51992e0001";

/** Answers like Plaid's API for the endpoints under test and records requests. */
function stubPlaid() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: { body: string }) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body) as Record<string, unknown>;
    requests.push({ path, body });
    const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    if (path === "/link/token/create") return json(200, { link_token: "link-sandbox-1", hosted_link_url: "https://hosted.plaid.com/link/1", expiration: "2026-09-25T13:00:00Z" });
    if (path === "/webhook_verification_key/get") {
      if (body.key_id !== KID) return json(400, { error_type: "INVALID_INPUT", error_code: "INVALID_WEBHOOK_VERIFICATION_KEY_ID" });
      return json(200, { key: { alg: "ES256", crv: "P-256", kid: KID, kty: "EC", use: "sig", x: jwk.x, y: jwk.y, created_at: 1, expired_at: null } });
    }
    return json(400, { error_type: "INVALID_REQUEST", error_code: "UNKNOWN" });
  }) as unknown as typeof fetch;
  const plaid = new PlaidBankingProvider({ clientId: "id", secret: "secret", env: "sandbox", webhookUrl: "https://close.example/api/webhooks/plaid" }, fetchImpl);
  const signBody = (body: string, iat = Math.floor(Date.now() / 1000)) => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const input = `${enc({ alg: "ES256", kid: KID, typ: "JWT" })}.${enc({ iat, request_body_sha256: createHash("sha256").update(body).digest("hex") })}`;
    return `${input}.${sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };
  return { plaid, requests, signBody };
}

describe("Plaid adapter", () => {
  it("starts Hosted Link asking only for identity, with Plaid choosing the bank", async () => {
    const { plaid, requests } = stubPlaid();
    const started = await plaid.connectBank({ userId: "u1", fullName: "Olivia Carter", country: "US", redirectUri: "https://close.example/cb", state: "conn-1" });
    expect(started).toEqual({ redirectUrl: "https://hosted.plaid.com/link/1", state: "link-sandbox-1" });
    const body = requests[0]!.body;
    expect(body.products).toEqual(["identity"]);
    expect(body).not.toHaveProperty("institution_id");
    expect(body).not.toHaveProperty("optional_products");
    expect(body.hosted_link).toEqual({ completion_redirect_uri: "https://close.example/cb?state=conn-1", url_lifetime_seconds: 1800 });
    expect(plaid.providerChoosesInstitution).toBe(true);
  });

  it("verifies and maps webhooks", async () => {
    const { plaid, signBody } = stubPlaid();
    const headers = (sig: string) => new Headers({ "plaid-verification": sig });
    const body = JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR", item_id: "item-1", error: { error_code: "ITEM_LOGIN_REQUIRED" }, environment: "sandbox" });
    const ev = await plaid.parseWebhook(body, headers(signBody(body)));
    expect(ev).toMatchObject({ eventType: "bank.reauth_required", data: { externalConnectionId: "item-1" } });
    expect(ev.externalEventId).toMatch(/^plaid_[0-9a-f]{64}$/);

    const revoked = JSON.stringify({ webhook_type: "ITEM", webhook_code: "USER_PERMISSION_REVOKED", item_id: "item-1", environment: "sandbox" });
    expect((await plaid.parseWebhook(revoked, headers(signBody(revoked)))).eventType).toBe("bank.revoked");
    const prod = JSON.stringify({ webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED", item_id: "item-1", environment: "production" });
    expect((await plaid.parseWebhook(prod, headers(signBody(prod)))).eventType).toBe("plaid.other_environment");

    await expect(plaid.parseWebhook(body, headers(signBody("{}")))).rejects.toBeInstanceOf(WebhookRejectedError);
    await expect(plaid.parseWebhook(body, new Headers())).rejects.toBeInstanceOf(WebhookRejectedError);
    await expect(plaid.parseWebhook(body, headers(signBody(body, Math.floor(Date.now() / 1000) - 600)))).rejects.toBeInstanceOf(WebhookRejectedError);
  });
});
