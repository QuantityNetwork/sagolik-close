import type { Bill, FundingRule, Obligation, ReviewPolicy } from "@sagolik/types";
import { describe, expect, it } from "vitest";
import {
  addMonths,
  assessPassport,
  assessPortfolio,
  checkFunding,
  defaultReviewPolicies,
  detectBillAnomalies,
  dueDatesBetween,
  estimateMonthlyPayment,
  evaluateBill,
  firstMortgagePaymentDate,
  forecast,
  type FundingAccountView,
  matchPolicy,
  type PassportInput,
  usualRange,
} from "./autopilot";

const TODAY = "2027-04-09";
const ORG = "00000000-0000-4000-8000-000000000001";
const PASS = "00000000-0000-4000-8000-00000000000a";
let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const ts = "2027-01-01T00:00:00.000Z";

function ob(p: Partial<Obligation> & Pick<Obligation, "kind" | "label">): Obligation {
  return {
    id: uid(),
    organizationId: ORG,
    passportId: PASS,
    vendorId: null,
    priority: "critical",
    amountType: "variable",
    expectedAmount: null,
    expectedMin: null,
    expectedMax: null,
    currency: "USD",
    frequency: "monthly",
    nextDueOn: null,
    graceDays: 0,
    payMethod: "autopay",
    escrowStatus: "not_applicable",
    fundingAccountId: null,
    referenceLast4: null,
    payeeMatch: null,
    source: "manual",
    confidence: 100,
    status: "active",
    endedOn: null,
    createdBy: null,
    createdAt: ts,
    updatedAt: ts,
    ...p,
  };
}

function bill(o: Obligation, amount: number, dueOn: string, p: Partial<Bill> = {}): Bill {
  return {
    id: uid(),
    organizationId: ORG,
    passportId: PASS,
    obligationId: o.id,
    amount,
    currency: "USD",
    dueOn,
    periodLabel: null,
    status: "received",
    source: "manual",
    fileKey: null,
    fileName: null,
    paidOn: null,
    paymentReference: null,
    verifiedAt: null,
    reviewedBy: null,
    reviewedAt: null,
    secondReviewedBy: null,
    secondReviewedAt: null,
    createdBy: null,
    createdAt: `${dueOn}T00:00:00.000Z`,
    updatedAt: ts,
    ...p,
  };
}

const paid = (o: Obligation, amount: number, dueOn: string) => bill(o, amount, dueOn, { status: "paid_verified", verifiedAt: ts, paymentReference: "Bank transaction" });

function policies(): ReviewPolicy[] {
  return defaultReviewPolicies().map((p) => ({ ...p, id: uid(), organizationId: ORG, passportId: null, enabled: true, createdAt: ts, updatedAt: ts }));
}

const account = (id: string, available: number | null, p: Partial<FundingAccountView> = {}): FundingAccountView => ({ id, label: "Operating", mask: "8291", currency: "USD", available, asOf: ts, connectionOk: true, ...p });

function input(obligations: Obligation[], bills: Bill[], p: Partial<PassportInput> = {}): PassportInput {
  return { passportId: PASS, label: "Miami Beach Residence", status: "live", monitoring: "monitor", currency: "USD", today: TODAY, obligations, bills, policies: policies(), funding: null, accounts: [], ...p };
}

/** 11 months of electricity between $220 and $310, median $305. */
function electricityHistory(o: Obligation) {
  const amounts = [22_000, 23_800, 25_600, 27_100, 28_900, 30_500, 30_500, 30_600, 30_800, 30_900, 31_000];
  return amounts.map((a, i) => paid(o, a, addMonths("2026-05-18", i)));
}

describe("dates and schedules", () => {
  it("adds months without overflowing short months", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2027-11-15", 3)).toBe("2028-02-15");
  });

  it("rolls a stale next-due date forward by its frequency", () => {
    const tax = ob({ kind: "property_tax", label: "Property tax", frequency: "semiannual", nextDueOn: "2026-11-30" });
    expect(dueDatesBetween(tax, TODAY, "2028-04-09")).toEqual(["2027-05-30", "2027-11-30"]);
    const once = ob({ kind: "maintenance", label: "Roof repair", frequency: "once", nextDueOn: "2027-03-01" });
    expect(dueDatesBetween(once, TODAY, "2027-12-31")).toEqual([]);
  });

  it("estimates a mortgage payment from loan terms and its first due date", () => {
    // $400,000 at 6.5% over 30 years ≈ $2,528.27
    expect(estimateMonthlyPayment(40_000_000, 650, 360)).toBe(252_827);
    expect(estimateMonthlyPayment(12_000_00, 0, 12)).toBe(1_000_00);
    expect(firstMortgagePaymentDate("2027-04-09")).toBe("2027-06-01");
  });
});

describe("unusual bills", () => {
  it("flags an electricity bill far above the usual range, with the factor", () => {
    const e = ob({ kind: "electricity", label: "Electricity", nextDueOn: "2027-04-18" });
    const history = electricityHistory(e);
    const big = bill(e, 287_000, "2027-04-18");
    expect(usualRange(e, [...history, big], big.id)).toMatchObject({ min: 22_000, max: 31_000, typical: 30_500, basis: "history" });
    const [a] = detectBillAnomalies(big, e, [...history, big]);
    expect(a).toMatchObject({ code: "high_amount", factor: 9.4 });
    expect(a!.message).toContain("$220–$310");

    const d = evaluateBill(big, e, input([e], [...history, big]))!;
    expect(d).toMatchObject({ outcome: "anomaly", severity: "urgent", summary: "Electricity $2,870 is 9.4× the usual amount" });
    expect(d.reasons.join(" ")).toMatch(/autopay will pay it on Apr 18 unless you stop it/);
  });

  it("treats a normal bill as routine under the owner's rules", () => {
    const e = ob({ kind: "electricity", label: "Electricity" });
    const history = electricityHistory(e);
    const normal = bill(e, 24_381, "2027-04-18");
    expect(detectBillAnomalies(normal, e, [...history, normal])).toEqual([]);
    expect(evaluateBill(normal, e, input([e], [...history, normal]))).toMatchObject({ outcome: "routine", severity: "info", rule: "Electricity up to $1,000 is routine" });
  });

  it("clears once a person has reviewed it", () => {
    const e = ob({ kind: "electricity", label: "Electricity" });
    const history = electricityHistory(e);
    const big = bill(e, 287_000, "2027-04-18", { reviewedBy: uid(), reviewedAt: ts });
    const d = evaluateBill(big, e, input([e], [...history, big]))!;
    expect(d.outcome).toBe("routine");
    expect(d.reasons).toContain("You reviewed this bill.");
    expect(assessPassport(input([e], [...history, big]), []).attention.filter((a) => a.billId === big.id)).toEqual([]);
  });

  it("detects duplicates, changed fixed amounts, and bills for ended services", () => {
    const hoa = ob({ kind: "hoa", label: "HOA", amountType: "fixed", expectedAmount: 185_000 });
    const first = bill(hoa, 185_000, "2027-04-05", { createdAt: "2027-03-20T00:00:00.000Z" });
    const second = bill(hoa, 185_000, "2027-04-07", { createdAt: "2027-03-25T00:00:00.000Z" });
    expect(detectBillAnomalies(first, hoa, [first, second])).toEqual([]);
    expect(detectBillAnomalies(second, hoa, [first, second]).map((a) => a.code)).toEqual(["duplicate"]);
    expect(evaluateBill(second, hoa, input([hoa], [first, second]))!.outcome).toBe("duplicate_risk");

    const changed = bill(hoa, 212_500, "2027-05-05");
    expect(detectBillAnomalies(changed, hoa, [changed])[0]).toMatchObject({ code: "amount_changed" });
    const ended = { ...hoa, status: "ended" as const };
    expect(detectBillAnomalies(bill(hoa, 185_000, "2027-06-05"), ended, []).map((a) => a.code)).toContain("unexpected_bill");
  });
});

describe("escrow", () => {
  it("never lets an escrowed tax bill look payable", () => {
    const tax = ob({ kind: "property_tax", label: "Property tax", frequency: "semiannual", amountType: "periodic", expectedAmount: 640_000, escrowStatus: "confirmed_escrowed", payMethod: "escrow", nextDueOn: "2027-04-30" });
    const b = bill(tax, 640_000, "2027-04-30");
    expect(evaluateBill(b, tax, input([tax], [b]))).toMatchObject({ outcome: "duplicate_risk" });
    const covered = { ...b, status: "covered_by_escrow" as const };
    expect(evaluateBill(covered, tax, input([tax], [covered]))).toMatchObject({ outcome: "covered_by_escrow", severity: "info" });
    // The forecast shows it at $0 of the owner's cash.
    const f = forecast(input([tax], []), 30);
    expect(f.lines[0]).toMatchObject({ basis: "escrow", amount: 0 });
    expect(f.total).toBe(0);
  });

  it("asks to verify when escrow is uncertain, before anyone pays", () => {
    const ins = ob({ kind: "insurance", label: "Homeowners insurance", frequency: "annual", amountType: "periodic", expectedAmount: 420_000, escrowStatus: "possibly_escrowed", payMethod: "manual", nextDueOn: "2027-09-01" });
    const a = assessPassport(input([ins], []), []);
    expect(a.attention.map((x) => x.outcome)).toContain("verify_escrow");
    const b = bill(ins, 420_000, "2027-04-20");
    expect(evaluateBill(b, ins, input([ins], [b]))!.outcome).toBe("verify_escrow");
  });
});

describe("review rules", () => {
  it("evaluates in order: two people over $50k, your review over $10k, then routine limits", () => {
    const p = policies();
    expect(matchPolicy(6_000_000, "insurance", p)!.action).toBe("two_person_review");
    expect(matchPolicy(1_420_000, "insurance", p)!.name).toBe("Any bill over $10,000 needs your review");
    expect(matchPolicy(825_000, "mortgage", p)!.action).toBe("routine");
    expect(matchPolicy(1_200_000, "mortgage", p)!.action).toBe("routine"); // mortgage rule comes first
    expect(matchPolicy(90_000, "electricity", p)!.action).toBe("routine");
    expect(matchPolicy(90_000, "security", p)).toBeNull(); // no rule → review
  });

  it("needs two different people for a two-person bill", () => {
    const ins = ob({ kind: "insurance", label: "Insurance", amountType: "periodic", expectedAmount: 6_000_000, escrowStatus: "confirmed_not_escrowed", payMethod: "manual" });
    const b = bill(ins, 6_000_000, "2027-05-01");
    expect(evaluateBill(b, ins, input([ins], [b]))!.outcome).toBe("two_person_review");
    const one = { ...b, reviewedBy: uid(), reviewedAt: ts };
    expect(evaluateBill(one, ins, input([ins], [one]))!.reasons.join(" ")).toMatch(/second, different person/);
    const two = { ...one, secondReviewedBy: uid(), secondReviewedAt: ts };
    expect(evaluateBill(two, ins, input([ins], [two]))!.outcome).toBe("routine");
  });

  it("flags an insurance renewal over $10,000 for the owner", () => {
    const ins = ob({ kind: "insurance", label: "Homeowners insurance", amountType: "event", frequency: "annual", escrowStatus: "confirmed_not_escrowed", payMethod: "manual" });
    const renewal = bill(ins, 1_420_000, "2027-10-03");
    expect(evaluateBill(renewal, ins, input([ins], [renewal]))).toMatchObject({ outcome: "review_required", rule: "Any bill over $10,000 needs your review" });
  });

  it("marks unpaid critical bills past their grace period as overdue", () => {
    const m = ob({ kind: "mortgage", label: "Mortgage", amountType: "fixed", expectedAmount: 825_000, graceDays: 5 });
    const late = bill(m, 825_000, "2027-04-01");
    expect(evaluateBill(late, m, input([m], [late]))).toMatchObject({ outcome: "overdue", severity: "critical" });
    const inGrace = bill(m, 825_000, "2027-04-05");
    expect(evaluateBill(inGrace, m, input([m], [inGrace]))!.outcome).toBe("routine");
  });
});

describe("forecast and funding", () => {
  const OP = "00000000-0000-4000-8000-0000000000f1";
  const RES = "00000000-0000-4000-8000-0000000000f2";
  const rule = (p: Partial<FundingRule> = {}): FundingRule => ({ id: uid(), organizationId: ORG, passportId: PASS, operatingAccountId: OP, reserveAccountId: RES, minOperatingBalance: 50_000, targetOperatingBalance: 500_000, createdAt: ts, updatedAt: ts, ...p });

  function austin2() {
    const mortgage = ob({ kind: "mortgage", label: "Mortgage", amountType: "fixed", expectedAmount: 298_000, nextDueOn: "2027-05-01" });
    const utilities = ob({ kind: "electricity", label: "Electricity", expectedMin: 30_000, expectedMax: 46_000, expectedAmount: 38_000, nextDueOn: "2027-04-20" });
    return { mortgage, utilities };
  }

  it("predicts amounts from fixed terms and usual ranges, and lets real bills replace predictions", () => {
    const { mortgage, utilities } = austin2();
    const f = forecast(input([mortgage, utilities], []), 30);
    expect(f.lines.map((l) => [l.label, l.dueOn, l.amount, l.basis])).toEqual([
      ["Electricity", "2027-04-20", 38_000, "estimate"],
      ["Mortgage", "2027-05-01", 298_000, "fixed"],
    ]);
    expect(f).toMatchObject({ billed: 0, predicted: 336_000, total: 336_000 });
    const real = bill(utilities, 41_200, "2027-04-21");
    const g = forecast(input([mortgage, utilities], [real]), 30);
    expect(g.lines.find((l) => l.label === "Electricity")).toMatchObject({ amount: 41_200, basis: "bill" });
    expect(g.billed).toBe(41_200);
  });

  it("finds the Austin #2 shortfall and recommends a reserve transfer (never makes it)", () => {
    const { mortgage, utilities } = austin2();
    const i = input([mortgage, utilities], [], { label: "Austin Rental #2", funding: rule(), accounts: [account(OP, 210_000), account(RES, 4_200_000, { label: "Reserve", mask: "7002" })] });
    // Needed (high end): 298,000 + 46,000 = 344,000; usable: 210,000 − 50,000 = 160,000 → short 184,000.
    const [f] = checkFunding([i]);
    expect(f).toMatchObject({ needed: 344_000, usable: 160_000, shortfall: 184_000, suggestedTransfer: 184_000, status: "shortfall_reserve_can_cover" });
    expect(f!.reasons.join(" ")).toMatch(/Move \$1,840 to cover it; Sagolik doesn't move money/);
    const a = assessPassport(i, [f!]);
    expect(a.status).toBe("attention");
    expect(a.attention[0]).toMatchObject({ outcome: "funding_shortfall", title: "Move $1,840 from your reserve" });
  });

  it("calls it at risk when nothing can cover the shortfall", () => {
    const { mortgage } = austin2();
    const i = input([mortgage], [], { funding: rule({ reserveAccountId: null }), accounts: [account(OP, 100_000)] });
    const a = assessPassport(i, checkFunding([i]));
    expect(a.status).toBe("at_risk");
  });

  it("counts a shared paying account once across properties", () => {
    const one = ob({ kind: "hoa", label: "HOA", amountType: "fixed", expectedAmount: 100_000, nextDueOn: "2027-04-15" });
    const two = { ...ob({ kind: "hoa", label: "HOA", amountType: "fixed", expectedAmount: 100_000, nextDueOn: "2027-04-16" }), passportId: "00000000-0000-4000-8000-00000000000b" };
    const a = input([one], [], { funding: rule({ reserveAccountId: null, minOperatingBalance: 0 }), accounts: [account(OP, 150_000)] });
    const b = input([two], [], { passportId: "00000000-0000-4000-8000-00000000000b", label: "Other", funding: { ...rule({ reserveAccountId: null, minOperatingBalance: 0 }), passportId: "00000000-0000-4000-8000-00000000000b" }, accounts: [account(OP, 150_000)] });
    const checks = checkFunding([a, b]);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ needed: 200_000, shortfall: 50_000, status: "shortfall" });
    const p = assessPortfolio([a, b]);
    expect(p.operatingAvailable).toBe(150_000);
    expect(p.attentionItems.filter((x) => x.outcome === "funding_shortfall")).toHaveLength(1);
    expect(p.attentionItems[0]!.passportLabel).toBe("Miami Beach Residence, Other");
    expect(p.coverage).toBeCloseTo(0.75);
  });
});

describe("continuity", () => {
  it("is protected only when every critical cost is known, funded and on time — and says why", () => {
    const OP = "00000000-0000-4000-8000-0000000000f1";
    const m = ob({ kind: "mortgage", label: "Mortgage", amountType: "fixed", expectedAmount: 825_000, nextDueOn: "2027-05-01", fundingAccountId: OP });
    const tax = ob({ kind: "property_tax", label: "Property tax", frequency: "semiannual", amountType: "periodic", expectedAmount: 640_000, escrowStatus: "confirmed_escrowed", payMethod: "escrow", nextDueOn: "2027-11-30" });
    const ins = ob({ kind: "insurance", label: "Insurance", frequency: "annual", amountType: "periodic", expectedAmount: 380_000, escrowStatus: "confirmed_escrowed", payMethod: "escrow", nextDueOn: "2027-12-01" });
    const i = input([m, tax, ins], [], { funding: { id: uid(), organizationId: ORG, passportId: PASS, operatingAccountId: OP, reserveAccountId: null, minOperatingBalance: 0, targetOperatingBalance: 0, createdAt: ts, updatedAt: ts }, accounts: [account(OP, 3_100_000)] });
    const a = assessPassport(i, checkFunding([i]));
    expect(a.status).toBe("protected");
    expect(a.headline).toBe("All critical costs are covered for the next 30 days.");
    expect(a.reasons.join(" ")).toMatch(/covers the \$8,250 due in the next 30 days/);
    expect(a.checklist.map((c) => [c.kind, c.state])).toEqual([
      ["mortgage", "ok"],
      ["property_tax", "escrow"],
      ["insurance", "escrow"],
    ]);
  });

  it("needs attention when required costs are missing or suggestions await confirmation", () => {
    const hoa = ob({ kind: "hoa", label: "HOA", status: "suggested", source: "closing", amountType: "fixed", expectedAmount: 185_000 });
    const a = assessPassport(input([hoa], []), []);
    expect(a.status).toBe("attention");
    expect(a.checklist.find((c) => c.kind === "property_tax")!.state).toBe("missing");
    expect(a.checklist.find((c) => c.kind === "hoa")!.state).toBe("to_confirm");
    expect(a.attention.map((x) => x.title)).toContain("Confirm 1 suggested cost");
  });

  it("doesn't assess a property that isn't monitored", () => {
    expect(assessPassport(input([], [], { monitoring: "off" }), []).status).toBe("not_monitored");
  });
});
