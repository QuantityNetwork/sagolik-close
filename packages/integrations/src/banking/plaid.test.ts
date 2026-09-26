import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WebhookRejectedError } from "../common";
import { PlaidBankingProvider } from "./plaid";

const KID = "6c5516e1-92dc-479e-a8ff-5a51992e0001";

/** Answers like Plaid's API for the endpoints under test and records requests. */
function stubPlaid(opts: { optionalProducts?: Array<"transactions" | "liabilities"> } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: { body: string }) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body) as Record<string, unknown>;
    requests.push({ path, body });
    const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    if (path === "/accounts/get")
      return json(200, {
        accounts: [
          { account_id: "a1", name: "Plaid Checking", mask: "0000", type: "depository", subtype: "checking", balances: { available: 100, current: 110, iso_currency_code: "USD" } },
          { account_id: "a2", name: "Plaid Money Market", mask: "4444", type: "depository", subtype: "money market", balances: { available: 43200, current: 43200, iso_currency_code: "USD" } },
          { account_id: "a3", name: "Plaid Credit Card", mask: "3333", type: "credit", subtype: "credit card", balances: { available: 1000000, current: 410, iso_currency_code: "USD" } },
        ],
      });
    if (path === "/transactions/get") {
      const all = Array.from({ length: 620 }, (_, i) => ({ transaction_id: `t${i}`, account_id: "a1", date: "2027-03-01", name: i === 0 ? "ACH HIGH COUNTRY" : "Coffee", merchant_name: i === 0 ? "High Country Services" : null, amount: i === 1 ? -25.5 : 4.5, iso_currency_code: "USD", pending: i === 2 }));
      const { offset, count } = body.options as { offset: number; count: number };
      return json(200, { total_transactions: all.length, transactions: all.slice(offset, offset + count) });
    }
    if (path === "/liabilities/get")
      return json(200, { liabilities: { mortgage: [{ account_id: "m1", next_payment_due_date: "2027-04-22", next_monthly_payment: 2980, escrow_balance: 4210.5, property_address: { street: "2210 Cedar Hollow Rd" } }] } });
    if (path === "/item/get") return json(200, { item: { institution_name: "Lone Star Home Lending" } });
    if (path === "/link/token/create") return json(200, { link_token: "link-sandbox-1", hosted_link_url: "https://hosted.plaid.com/link/1", expiration: "2026-09-25T13:00:00Z" });
    if (path === "/webhook_verification_key/get") {
      if (body.key_id !== KID) return json(400, { error_type: "INVALID_INPUT", error_code: "INVALID_WEBHOOK_VERIFICATION_KEY_ID" });
      return json(200, { key: { alg: "ES256", crv: "P-256", kid: KID, kty: "EC", use: "sig", x: jwk.x, y: jwk.y, created_at: 1, expired_at: null } });
    }
    return json(400, { error_type: "INVALID_REQUEST", error_code: "UNKNOWN" });
  }) as unknown as typeof fetch;
  const plaid = new PlaidBankingProvider({ clientId: "id", secret: "secret", env: "sandbox", webhookUrl: "https://close.example/api/webhooks/plaid", ...opts }, fetchImpl);
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

  it("asks for transactions and lender data only when the deployment opts in (optional: billed once used)", async () => {
    const off = stubPlaid();
    await off.plaid.connectBank({ userId: "u1", fullName: "A", country: "US", redirectUri: "https://x/cb", state: "s" });
    expect(off.requests[0]!.body).not.toHaveProperty("optional_products");
    expect(off.plaid.activityData).toEqual({ transactions: false, mortgages: false });
    const on = stubPlaid({ optionalProducts: ["transactions", "liabilities"] });
    await on.plaid.connectBank({ userId: "u1", fullName: "A", country: "US", redirectUri: "https://x/cb", state: "s" });
    expect(on.requests[0]!.body).toMatchObject({ products: ["identity"], optional_products: ["transactions", "liabilities"], transactions: { days_requested: 180 } });
    expect(on.plaid.activityData).toEqual({ transactions: true, mortgages: true });
  });

  it("pages through transactions, skips pending ones and uses our sign convention", async () => {
    const { plaid, requests } = stubPlaid();
    const txns = await plaid.getTransactions("access-sandbox-1", { from: "2027-01-01", to: "2027-03-31" });
    expect(requests.filter((r) => r.path === "/transactions/get")).toHaveLength(2);
    expect(txns).toHaveLength(619);
    expect(txns[0]).toMatchObject({ description: "High Country Services ACH HIGH COUNTRY", amount: -450 });
    expect(txns[1]).toMatchObject({ amount: 2550 }); // money in
  });

  it("reads the lender's mortgage data in minor units", async () => {
    const { plaid } = stubPlaid();
    expect(await plaid.getMortgages("access-sandbox-1")).toEqual([{ externalAccountId: "m1", lenderName: "Lone Star Home Lending", nextPaymentDueOn: "2027-04-22", nextMonthlyPayment: 298_000, escrowBalance: 421_050, propertyStreet: "2210 Cedar Hollow Rd" }]);
  });

  it("treats cash accounts as checking/savings and credit as other", async () => {
    const { plaid } = stubPlaid();
    expect((await plaid.listAccounts("access-sandbox-1")).map((a) => [a.mask, a.type])).toEqual([
      ["0000", "checking"],
      ["4444", "savings"],
      ["3333", "other"],
    ]);
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
