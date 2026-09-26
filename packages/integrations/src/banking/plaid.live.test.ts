import { describe, expect, it } from "vitest";
import { WebhookRejectedError } from "../common";
import { PlaidBankingProvider } from "./plaid";

/**
 * Against Plaid's real sandbox, when keys are present:
 *   PLAID_CLIENT_ID=… PLAID_SECRET=… npx vitest run packages/integrations/src/banking/plaid.live.test.ts
 */
const id = process.env.PLAID_CLIENT_ID;
const secret = process.env.PLAID_SECRET;

describe.skipIf(!id || !secret)("Plaid adapter (live sandbox)", () => {
  it("links, reads ownership and balances, and disconnects", { timeout: 60_000 }, async () => {
    const plaid = new PlaidBankingProvider({ clientId: id!, secret: secret!, env: "sandbox" });
    const started = await plaid.connectBank({ userId: "sagolik-live-ts", fullName: "Alberta Charleson", country: "US", redirectUri: "https://close.sagolik.com/api/v1/bank-connections/callback", state: "s1" });
    expect(started.redirectUrl).toMatch(/^https:\/\//);

    // Plaid's sandbox shortcut for "the person finished Link at First Platypus Bank".
    const res = await fetch("https://sandbox.plaid.com/sandbox/public_token/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: id, secret, institution_id: "ins_109508", initial_products: ["identity"] }),
    });
    const { public_token } = (await res.json()) as { public_token: string };
    const ex = await plaid.exchangeAuthorization({ code: public_token, state: started.state });
    try {
      expect(ex.institution.name).toBe("First Platypus Bank");
      const accounts = await plaid.listAccounts(ex.accessToken);
      expect(accounts.some((a) => a.type === "checking")).toBe(true);
      expect(accounts.some((a) => a.type === "other")).toBe(true); // credit and loans exist in the sandbox bank
      const owners = await plaid.verifyAccountOwnership(ex.accessToken, "Alberta Charleson");
      expect(owners.every((o) => o.match)).toBe(true);
      const balances = await plaid.getBalances(ex.accessToken);
      expect(balances.find((b) => b.externalAccountId === accounts.find((a) => a.type === "checking")!.externalAccountId)?.available).toBeTypeOf("number");
      expect(await plaid.refreshConnection(ex.accessToken)).toEqual({ status: "connected" });
    } finally {
      await plaid.disconnectBank(ex.accessToken);
    }
    // A webhook signed with a key id Plaid doesn't know is rejected after asking Plaid.
    const fake = `${Buffer.from(JSON.stringify({ alg: "ES256", kid: "00000000-0000-0000-0000-000000000000" })).toString("base64url")}.e30.${"A".repeat(86)}`;
    await expect(plaid.parseWebhook("{}", new Headers({ "plaid-verification": fake }))).rejects.toBeInstanceOf(WebhookRejectedError);
  });
});
