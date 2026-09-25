import { describe, expect, it } from "vitest";
import { DEMO_TRANSACTION_ID } from "../demo/seed";
import { createTestHarness } from "../testing";
import { HELD_BY_MONEY_SERVICE, moneyCaller } from "./bridge";
import { MoneyServiceClient } from "./client";
import { runF1Scenario } from "./scenario";
import { loadSnapshot } from "../snapshot";

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

describe.skipIf(configured || !env.CI_REQUIRE_MONEY_IT)("integration configuration", () => {
  it("must run in CI", () => {
    throw new Error("CI_REQUIRE_MONEY_IT is set but MONEY_IT_URL is not");
  });
});
