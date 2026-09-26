import { describe, expect, it } from "vitest";
import { DEMO_PASSPORTS, DEMO_PORTFOLIO_ORG_ID } from "./demo/seed";
import { toAppError } from "./errors";
import {
  addBill,
  autopilotHome,
  billFile,
  markBillPaid,
  passportView,
  prepareFromOwnershipRecord,
  reviewBill,
  runAutopilotChecks,
  savePolicy,
  setUpFromHomeRecord,
  updateFunding,
  updateObligation,
} from "./services/autopilot";
import { createTestHarness } from "./testing";

async function code(p: Promise<unknown>) {
  try {
    await p;
    return "ok";
  } catch (e) {
    return toAppError(e).code;
  }
}

describe("Property Autopilot — demo portfolio", () => {
  it("shows Alex the exceptions, not the bills", async () => {
    const h = await createTestHarness();
    const home = await autopilotHome(await h.as("alex.morgan"));
    const { summary } = home;
    expect(summary).toMatchObject({ properties: 5, protected: 2, attention: 3, atRisk: 0 });
    const byLabel = Object.fromEntries(home.properties.map((p) => [p.passport.label, p.assessment]));
    expect(byLabel["Manhattan Condo"]!.status).toBe("protected");
    expect(byLabel["Austin Rental #1"]!.status).toBe("protected");

    const titles = summary.attentionItems.map((a) => `${a.passportLabel}: ${a.title}`);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Miami Beach Residence: Electricity $2,870 is 9.4× the usual amount",
        "Austin Rental #2: Move $1,840 from your reserve",
        "Aspen Vacation Home: Homeowners insurance $14,200 needs your review",
      ]),
    );
    expect(summary.attentionItems[0]!.severity).toBe("urgent"); // the autopay will pull $2,870
    expect(summary.suggestedTransfers).toBe(184_000);
    expect(byLabel["Manhattan Condo"]!.checklist.find((c) => c.kind === "property_tax")).toMatchObject({ state: "escrow" });
    expect(home.recent.length).toBeGreaterThan(0);
  });

  it("keeps the portfolio private to its members", async () => {
    const h = await createTestHarness();
    for (const who of ["olivia.carter", "jessica.morgan", "admin"]) {
      expect(await code(passportView(await h.as(who), DEMO_PASSPORTS.miami))).toBe("not_found");
      expect((await autopilotHome(await h.as(who))).properties).toHaveLength(0);
    }
  });

  it("clears the anomaly once Alex reviews it, and logs each step once", async () => {
    const h = await createTestHarness();
    const alex = await h.as("alex.morgan");
    const before = await passportView(alex, DEMO_PASSPORTS.miami);
    expect(before.assessment.status).toBe("attention");
    const big = before.bills.find((b) => b.amount === 287_000)!;
    await reviewBill(alex, big.id);
    expect(await code(reviewBill(alex, big.id))).toBe("conflict"); // not twice by the same person
    const after = await passportView(alex, DEMO_PASSPORTS.miami);
    expect(after.assessment.status).toBe("protected");
    // Re-running the checks adds nothing new: each situation is logged once.
    const n = await runAutopilotChecks(h.system("worker"));
    expect(n).toBe(0);
  });

  it("flags a new unusual bill, then records it as paid when Alex says so (reported, not verified)", async () => {
    const h = await createTestHarness();
    const alex = await h.as("alex.morgan");
    const v = await passportView(alex, DEMO_PASSPORTS.austin1);
    const water = v.obligations.find((o) => o.kind === "water")!;
    const bill = await addBill(alex, DEMO_PASSPORTS.austin1, { obligationId: water.id, amount: 98_000, dueOn: water.nextDueOn });
    const flagged = (await passportView(alex, DEMO_PASSPORTS.austin1)).assessment;
    expect(flagged.status).toBe("attention");
    expect(flagged.attention[0]!.title).toMatch(/Water \$980/);
    const notes = await h.db.notifications.find({ userId: h.userId("alex.morgan"), kind: "autopilot_urgent" });
    expect(notes.length).toBe(1);

    await markBillPaid(alex, bill.id, { paidOn: new Date().toISOString().slice(0, 10), reference: "Paid by autopay" });
    const paid = await passportView(alex, DEMO_PASSPORTS.austin1);
    expect(paid.bills.find((b) => b.id === bill.id)!.status).toBe("paid_reported");
    expect(paid.assessment.status).toBe("protected");
    expect(paid.decisions.map((d) => d.outcome)).toEqual(expect.arrayContaining(["anomaly", "paid_reported"]));
  });

  it("resolves the Austin #2 shortfall when the balance changes, and only owners change funding", async () => {
    const h = await createTestHarness();
    const alex = await h.as("alex.morgan");
    await h.db.bank_accounts.update((await passportView(alex, DEMO_PASSPORTS.austin2)).funding!.operatingAccountId!, { availableBalance: 600_000 });
    expect((await passportView(alex, DEMO_PASSPORTS.austin2)).assessment.status).toBe("protected");
    // Olivia can't point Alex's property at their own account, or change it at all.
    const olivia = await h.as("olivia.carter");
    expect(await code(updateFunding(olivia, DEMO_PASSPORTS.austin2, { operatingAccountId: null, reserveAccountId: null, minOperatingBalance: 0, targetOperatingBalance: 0 }))).toBe("not_found");
  });

  it("serves the renewal notice only to portfolio members", async () => {
    const h = await createTestHarness();
    const alex = await h.as("alex.morgan");
    const renewal = (await passportView(alex, DEMO_PASSPORTS.aspen)).bills.find((b) => b.fileKey)!;
    const f = await billFile(alex, renewal.id);
    expect(new TextDecoder().decode(f.bytes)).toContain("FICTIONAL");
    expect(await code(billFile(await h.as("olivia.carter"), renewal.id))).toBe("not_found");
  });

  it("lets owners tune rules: a routine limit makes the renewal quiet", async () => {
    const h = await createTestHarness();
    const alex = await h.as("alex.morgan");
    const v = await passportView(alex, DEMO_PASSPORTS.aspen);
    const over10k = v.policies.find((p) => p.name === "Any bill over $10,000 needs your review")!;
    await savePolicy(alex, DEMO_PORTFOLIO_ORG_ID, over10k.id, { ...over10k, enabled: false });
    const ins = v.policies.find((p) => p.obligationKind === "insurance")!;
    await savePolicy(alex, DEMO_PORTFOLIO_ORG_ID, ins.id, { ...ins, maxAmount: 2_000_000 });
    expect((await passportView(alex, DEMO_PASSPORTS.aspen)).assessment.status).toBe("protected");
  });
});

describe("Close → Live", () => {
  it("builds the Passport from Mia's closing, suggesting what it can't confirm", async () => {
    const h = await createTestHarness();
    const mia = await h.as("mia.rodriguez");
    const home = await autopilotHome(mia);
    expect(home.setup).toHaveLength(1);
    const passport = await setUpFromHomeRecord(mia, home.setup[0]!.ownershipRecordId);
    expect(await setUpFromHomeRecord(mia, home.setup[0]!.ownershipRecordId)).toMatchObject({ id: passport.id }); // idempotent
    const v = await passportView(mia, passport.id);
    expect(v.scope.type).toBe("personal_portfolio");
    // Cash purchase in Texas: no mortgage, tax due Jan 31, HOA from the listing, utilities to confirm.
    const kinds = v.obligations.map((o) => [o.kind, o.status, o.escrowStatus]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ["property_tax", "suggested", "confirmed_not_escrowed"],
        ["hoa", "suggested", "not_applicable"],
        ["electricity", "suggested", "not_applicable"],
        ["water", "suggested", "not_applicable"],
      ]),
    );
    expect(v.obligations.find((o) => o.kind === "property_tax")!.nextDueOn).toMatch(/-01-31$/);
    const steps = Object.fromEntries(v.liveSteps.map((s) => [s.key, s.state]));
    expect(steps).toMatchObject({ passport: "done", mortgage: "not_applicable", escrow: "not_applicable", tax: "needs_you", insurance: "needs_you", rules: "done" });
    expect(v.assessment.status).toBe("attention"); // suggestions to confirm, insurance missing
    // Confirming a suggestion makes it monitored.
    const tax = v.obligations.find((o) => o.kind === "property_tax")!;
    await updateObligation(mia, tax.id, { status: "active" });
    expect((await passportView(mia, passport.id)).obligations.find((o) => o.id === tax.id)).toMatchObject({ status: "active", confidence: 100 });
    // Others can't see it.
    expect(await code(passportView(await h.as("alex.morgan"), passport.id))).toBe("not_found");
  });

  it("prepares a financed purchase from the closing: mortgage estimate and escrow to verify", async () => {
    const h = await createTestHarness();
    // The hillside closing, as if it had been financed ($540,000 at 6.5% over 30 years, 80% LTV).
    const mia = await h.as("mia.rodriguez");
    const hill = (await autopilotHome(mia)).setup[0]!;
    const rec = (await h.db.ownership_records.get(hill.ownershipRecordId))!;
    const now = new Date().toISOString();
    await h.db.mortgages.insert({ id: crypto.randomUUID(), transactionId: rec.transactionId, lenderName: "Harbor Lending (Demo)", loanOfficerParticipantId: null, loanAmount: 54_000_000, currency: "USD", interestRateBps: 650, termMonths: 360, loanType: "Conventional 30-year fixed", ltvBps: 8000, status: "funded", appraisalStatus: "completed", underwritingStatus: "approved", clearToCloseAt: now, fundedAt: now, provider: "manual", externalReference: null, createdAt: now, updatedAt: now });
    const passport = (await prepareFromOwnershipRecord(h.system("reaction"), rec.id))!;
    const v = await passportView(mia, passport.id);
    const mortgage = v.obligations.find((o) => o.kind === "mortgage")!;
    expect(mortgage).toMatchObject({ status: "suggested", expectedAmount: 341_317, frequency: "monthly" });
    expect(v.obligations.find((o) => o.kind === "property_tax")!.escrowStatus).toBe("unknown"); // 80% LTV: not necessarily escrowed
    expect(v.liveSteps.find((s) => s.key === "escrow")!.state).toBe("needs_you");
  });
});
