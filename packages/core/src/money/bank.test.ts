import { describe, expect, it } from "vitest";
import { DEMO_TRANSACTION_ID } from "../demo/seed";
import { toAppError } from "../errors";
import { checkFundsForClosing, completeBankConnection, completeMoneyBankLink, disconnectBank, proofOfFundsFor, startBankConnection } from "../services/banking";
import { fundsStillNeeded } from "../services/views";
import { loadSnapshot } from "../snapshot";
import { createTestHarness } from "../testing";
import type { MoneyBankConnection, MoneyCaller, MoneyServiceClient } from "./client";

async function code(p: Promise<unknown>) {
  try {
    await p;
    return "ok";
  } catch (e) {
    return toAppError(e).code;
  }
}

describe("proof of funds (direct provider)", () => {
  it("compares the buyer's own account with what the closing still needs", async () => {
    const h = await createTestHarness();
    const olivia = await h.as("olivia.carter");
    const { connectionId } = await startBankConnection(olivia, { transactionId: DEMO_TRANSACTION_ID, institutionId: "mock_chase", country: "US" }, "http://localhost:3000/cb");
    await completeBankConnection(olivia, connectionId, h.providers.mocks.banking!.approveConsent(connectionId));
    const account = (await h.db.bank_accounts.find({ connectionId }))[0]!;

    const r = await checkFundsForClosing(olivia, connectionId, account.id);
    const s = (await loadSnapshot(olivia, DEMO_TRANSACTION_ID))!;
    expect(r.required).toBe(fundsStillNeeded(s, new Date().toISOString()));
    expect(r.sufficient).toBe(r.available !== null && r.available >= r.required);
    expect(await code(checkFundsForClosing(await h.as("daniel.brooks"), connectionId, account.id))).toBe("not_found");
  });
});

/** Records what the web app asks of the money service and answers like it. */
function stubMoney() {
  const calls: Array<{ op: string; caller: MoneyCaller; body?: unknown }> = [];
  const conn = (status: MoneyBankConnection["status"] = "connected"): MoneyBankConnection => ({
    id: "9f1c1c7e-7a43-4c55-9d8b-2d2c4b0c0001",
    transactionId: DEMO_TRANSACTION_ID,
    userId: "",
    provider: "plaid",
    institutionName: "First Platypus Bank",
    status,
    statusAt: new Date().toISOString(),
    consentExpiresAt: null,
    createdAt: new Date().toISOString(),
    accounts: [
      { id: "acc-1", connectionId: "c", name: "Plaid Checking", mask: "0000", type: "depository", subtype: "checking", currency: "USD", ownershipMatched: true, ownershipCheckedAt: new Date().toISOString(), lastFundsCheck: null },
      { id: "acc-2", connectionId: "c", name: "Plaid Saving", mask: "1111", type: "depository", subtype: "savings", currency: "USD", ownershipMatched: false, ownershipCheckedAt: new Date().toISOString(), lastFundsCheck: null },
    ],
  });
  const money = {
    async startBankLink(caller: MoneyCaller, body: unknown) {
      calls.push({ op: "start", caller, body });
      return { linkId: "5b0e2f4a-8a55-4a8f-9b53-2f0f6e0a0002", hostedLinkUrl: "https://hosted.plaid.com/link/abc", expiresAt: new Date().toISOString() };
    },
    async completeBankLink(caller: MoneyCaller, linkId: string, body: unknown) {
      calls.push({ op: `complete:${linkId}`, caller, body });
      return { connection: { ...conn(), userId: caller.userId } };
    },
    async proofOfFunds(caller: MoneyCaller, connectionId: string, accountId: string, body: { requiredAmount: number; currency: string }) {
      calls.push({ op: `proof:${connectionId}:${accountId}`, caller, body });
      const available = 50_000_000;
      return { fundsCheck: { id: "f", accountId, transactionId: caller.transactionId, checkedBy: caller.userId, requiredAmount: body.requiredAmount, currency: body.currency, available, current: available, sufficient: available >= body.requiredAmount, checkedAt: new Date().toISOString() } };
    },
    async disconnectBank(caller: MoneyCaller, connectionId: string) {
      calls.push({ op: `disconnect:${connectionId}`, caller });
      return { connection: conn("revoked") };
    },
    async funds(caller: MoneyCaller) {
      calls.push({ op: "funds", caller });
      return { transactionId: caller.transactionId, balances: [], proofOfFunds: [{ userId: "u", institutionName: "First Platypus Bank", accountMask: "0000", ownershipMatched: true, requiredAmount: 1, currency: "USD", sufficient: true, checkedAt: new Date().toISOString() }] };
    },
  };
  return { money: money as unknown as MoneyServiceClient, calls };
}

describe("bank connections through the money service", () => {
  it("keeps tokens out of the web app and mirrors only masked data", async () => {
    const { money, calls } = stubMoney();
    const h = await createTestHarness({ money });
    const olivia = await h.as("olivia.carter");

    // Plaid picks the bank; no institution from us.
    const started = await startBankConnection(olivia, { transactionId: DEMO_TRANSACTION_ID, country: "US" }, "http://localhost:3000/cb");
    expect(started.redirectUrl).toBe("https://hosted.plaid.com/link/abc");
    expect(calls[0]).toMatchObject({ op: "start", caller: { role: "buyer", transactionId: DEMO_TRANSACTION_ID }, body: { legalName: "Olivia Carter" } });
    expect(await code(startBankConnection(olivia, { country: "US" }, "http://x/cb"))).toBe("bad_request"); // needs the closing
    expect(await code(startBankConnection(await h.as("jessica.morgan"), { transactionId: DEMO_TRANSACTION_ID, country: "US" }, "http://x/cb"))).toBe("forbidden");

    // Only the person who started it can finish it.
    const linkId = "5b0e2f4a-8a55-4a8f-9b53-2f0f6e0a0002";
    expect(await code(completeMoneyBankLink(await h.as("daniel.brooks"), linkId))).toBe("not_found");
    const conn = await completeMoneyBankLink(olivia, linkId);
    expect(conn).toMatchObject({ status: "connected", institutionName: "First Platypus Bank", externalConnectionId: "money:9f1c1c7e-7a43-4c55-9d8b-2d2c4b0c0001" });
    expect(await h.db.bank_connection_secrets.findOne({ connectionId: conn.id })).toBeNull();
    const accounts = await h.db.bank_accounts.find({ connectionId: conn.id });
    expect(accounts.map((a) => [a.mask, a.ownershipVerified, a.ownerNames.length])).toEqual([
      ["0000", true, 0],
      ["1111", false, 0],
    ]);

    // Proof of funds: the amount comes from the transaction, not from the request.
    const checking = accounts.find((a) => a.mask === "0000")!;
    const r = await checkFundsForClosing(olivia, conn.id, checking.id);
    const s = (await loadSnapshot(olivia, DEMO_TRANSACTION_ID))!;
    const needed = fundsStillNeeded(s, new Date().toISOString());
    expect(calls.at(-1)).toMatchObject({ op: "proof:9f1c1c7e-7a43-4c55-9d8b-2d2c4b0c0001:acc-1", body: { requiredAmount: needed, currency: "USD" } });
    expect(r).toMatchObject({ required: needed, available: 50_000_000, sufficient: 50_000_000 >= needed });
    expect((await h.db.bank_accounts.get(checking.id))!.availableBalance).toBe(50_000_000);

    // Escrow sees results through the money service.
    const escrowProofs = await proofOfFundsFor(await h.as("marcus.lee"), s);
    expect(escrowProofs[0]).toMatchObject({ sufficient: true, accountMask: "0000" });
    expect(calls.at(-1)).toMatchObject({ op: "funds", caller: { role: "escrow_officer" } });

    // Disconnecting needs step-up and goes to the money service.
    expect(await code(disconnectBank(olivia, conn.id))).toBe("step_up_required");
    const revoked = await disconnectBank(await h.as("olivia.carter", { stepUp: true }), conn.id);
    expect(revoked.status).toBe("revoked");
    expect(calls.at(-1)!.op).toBe("disconnect:9f1c1c7e-7a43-4c55-9d8b-2d2c4b0c0001");
  });
});
