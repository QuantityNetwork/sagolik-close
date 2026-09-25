import { describe, expect, it } from "vitest";
import { DEMO_TRANSACTION_ID } from "../demo/seed";
import { createTestHarness } from "../testing";
import { HELD_BY_MONEY_SERVICE, moneyCaller } from "./bridge";
import { MoneyServiceClient } from "./client";
import { runF1Scenario } from "./scenario";
import { loadSnapshot } from "../snapshot";
import { checkFundsForClosing, completeMoneyBankLink, disconnectBank, proofOfFundsFor, startBankConnection } from "../services/banking";

/**
 * Runs the same scenario with the real Go money service (mutual TLS, signed
 * assertions, Postgres). Started by services/money/scripts/integration.sh.
 */
const env = process.env;
const configured = !!env.MONEY_IT_URL;

describe.skipIf(!configured)("payment instructions and escrow movements (Go money service)", () => {
  it("runs the F1 scenario through the money service", async () => {
    const money = MoneyServiceClient.fromFiles({
      url: env.MONEY_IT_URL!,
      caFile: env.MONEY_IT_CA!,
      certFile: env.MONEY_IT_CERT!,
      keyFile: env.MONEY_IT_KEY!,
      signingJwkFile: env.MONEY_IT_SIGNING_JWK!,
      kid: "web-it",
    });
    const h = await createTestHarness({ money });
    const { instructionId, buyer } = await runF1Scenario(h);

    // The web app only holds a masked mirror; the account number lives in the money service.
    const row = await h.db.bank_instructions.get(instructionId);
    expect(row!.encryptedAccountNumber).toBe(HELD_BY_MONEY_SERVICE);

    // The Go ledger reflects the recorded receipt; its instruction list matches the mirror.
    const s = (await loadSnapshot(buyer, DEMO_TRANSACTION_ID))!;
    const caller = moneyCaller(buyer, s, "financial.view");
    const funds = await money.funds(caller);
    expect(funds.balances[0]).toMatchObject({ currency: "USD", received: 1_000_000 });
    const { instructions } = await money.listInstructions(caller);
    expect(instructions.find((i) => i.id === instructionId)).toMatchObject({ status: "verified", usable: true, accountMask: "3456" });
  });
});

describe.skipIf(!configured)("bank connections through Plaid (Go money service, stand-in Plaid)", () => {
  it("connects, checks ownership and funds, shows escrow the result, and disconnects", async () => {
    const money = MoneyServiceClient.fromFiles({
      url: env.MONEY_IT_URL!,
      caFile: env.MONEY_IT_CA!,
      certFile: env.MONEY_IT_CERT!,
      keyFile: env.MONEY_IT_KEY!,
      signingJwkFile: env.MONEY_IT_SIGNING_JWK!,
      kid: "web-it",
    });
    const h = await createTestHarness({ money });
    const olivia = await h.as("olivia.carter");

    const started = await startBankConnection(olivia, { transactionId: DEMO_TRANSACTION_ID, country: "US" }, "http://localhost:3000/api/v1/bank-connections/callback");
    expect(started.redirectUrl).toMatch(/^https:\/\/hosted\.plaid\.com\//);
    const mirror = (await h.db.bank_connections.get(started.connectionId))!;
    const linkId = mirror.externalConnectionId!.replace("link:", "");

    // Not finished at Plaid yet → the person is told to start again.
    await expect(completeMoneyBankLink(olivia, linkId)).rejects.toMatchObject({ code: "conflict" });
    const again = await startBankConnection(olivia, { transactionId: DEMO_TRANSACTION_ID, country: "US" }, "http://localhost:3000/api/v1/bank-connections/callback");
    const linkId2 = (await h.db.bank_connections.get(again.connectionId))!.externalConnectionId!.replace("link:", "");
    const finished = await fetch(`${env.MONEY_IT_PLAID_FAKE}/__plaidtest/finish-latest-link`, { method: "POST", body: "{}" });
    expect(finished.status).toBe(204);

    const conn = await completeMoneyBankLink(olivia, linkId2);
    expect(conn).toMatchObject({ status: "connected", institutionName: "First Platypus Bank" });
    expect(await h.db.bank_connection_secrets.findOne({ connectionId: conn.id })).toBeNull();
    const accounts = await h.db.bank_accounts.find({ connectionId: conn.id });
    const checking = accounts.find((a) => a.mask === "0000")!;
    expect(checking.ownershipVerified).toBe(true); // the stand-in reports "Olivia Carter" as owner

    const r = await checkFundsForClosing(olivia, conn.id, checking.id);
    expect(r.available).toBe(25_000_000);
    expect(r.sufficient).toBe(25_000_000 >= r.required);

    const s = (await loadSnapshot(olivia, DEMO_TRANSACTION_ID))!;
    const proofs = await proofOfFundsFor(await h.as("marcus.lee"), s);
    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({ accountMask: "0000", ownershipMatched: true, sufficient: r.sufficient, requiredAmount: r.required });
    expect(JSON.stringify(proofs)).not.toContain("25000000");

    const revoked = await disconnectBank(await h.as("olivia.carter", { stepUp: true }), conn.id);
    expect(revoked.status).toBe("revoked");
    await expect(checkFundsForClosing(olivia, conn.id, checking.id)).rejects.toMatchObject({ code: "conflict" });
  });
});

describe.skipIf(configured || !env.CI_REQUIRE_MONEY_IT)("integration configuration", () => {
  it("must run in CI", () => {
    throw new Error("CI_REQUIRE_MONEY_IT is set but MONEY_IT_URL is not");
  });
});
