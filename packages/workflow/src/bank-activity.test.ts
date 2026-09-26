import type { Bill, Obligation } from "@sagolik/types";
import { describe, expect, it } from "vitest";
import { type BankActivity, detectRecurring, guessKind, lenderUpdates, matchPayments, merchantKey, payeeWords, streetKey } from "./bank-activity";

const ts = "2027-01-01T00:00:00.000Z";
let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function ob(p: Partial<Obligation> & Pick<Obligation, "kind" | "label">): Obligation {
  return {
    id: uid(), organizationId: uid(), passportId: uid(), vendorId: null, priority: "critical", amountType: "fixed", expectedAmount: null, expectedMin: null, expectedMax: null,
    currency: "USD", frequency: "monthly", nextDueOn: null, graceDays: 0, payMethod: "autopay", escrowStatus: "not_applicable", fundingAccountId: null, referenceLast4: null,
    payeeMatch: null, source: "manual", confidence: 100, status: "active", endedOn: null, createdBy: null, createdAt: ts, updatedAt: ts, ...p,
  };
}

function bill(o: Obligation, amount: number, dueOn: string, p: Partial<Bill> = {}): Bill {
  return {
    id: uid(), organizationId: o.organizationId, passportId: o.passportId, obligationId: o.id, amount, currency: "USD", dueOn, periodLabel: null, status: "received", source: "manual",
    fileKey: null, fileName: null, paidOn: null, paymentReference: null, verifiedAt: null, reviewedBy: null, reviewedAt: null, secondReviewedBy: null, secondReviewedAt: null,
    createdBy: null, createdAt: ts, updatedAt: ts, ...p,
  };
}

const tx = (date: string, description: string, amount: number, accountId = "acc-op"): BankActivity => ({ id: uid(), accountId, accountLabel: "Holdings Operating •••• 8291", date, description, amount });

describe("payee words", () => {
  it("keeps distinctive words only", () => {
    expect(payeeWords("High Country Services (Demo)")).toEqual(["high", "country"]);
    expect(payeeWords("Coastal Power & Light")).toEqual(["coastal", "power", "light"]);
    expect(payeeWords(null)).toEqual([]);
  });
});

describe("verifying payments", () => {
  const snow = ob({ kind: "maintenance", label: "Snow removal", expectedAmount: 45_000, payeeMatch: "High Country" });

  it("needs the exact amount, the payee, and a plausible date", () => {
    const b = bill(snow, 45_000, "2027-03-05", { status: "paid_reported", paidOn: "2027-03-04" });
    const activity = [
      tx("2027-03-04", "HIGH COUNTRY SVCS 450", -45_001), // wrong amount
      tx("2027-03-04", "GROCERY MART", -45_000), // wrong payee
      tx("2027-01-04", "HIGH COUNTRY SERVICES", -45_000), // too early
      tx("2027-03-05", "HIGH COUNTRY SERVICES ACH", -45_000), // ✓
    ];
    const [m] = matchPayments([b], [snow], activity);
    expect(m).toMatchObject({ billId: b.id, paidOn: "2027-03-05" });
    expect(m!.reference).toBe("Bank: HIGH COUNTRY SERVICES ACH, Mar 5 (Holdings Operating •••• 8291)");
  });

  it("uses each transaction once and never confirms without a payee", () => {
    const a = bill(snow, 45_000, "2027-03-05");
    const b = bill(snow, 45_000, "2027-03-07");
    const m = matchPayments([a, b], [snow], [tx("2027-03-05", "HIGH COUNTRY SERVICES", -45_000)]);
    expect(m).toHaveLength(1);
    const noPayee = ob({ kind: "other", label: "Something", expectedAmount: 45_000 });
    expect(matchPayments([bill(noPayee, 45_000, "2027-03-05")], [noPayee], [tx("2027-03-05", "ANYTHING", -45_000)])).toEqual([]);
  });

  it("falls back to the vendor's name, and ignores money coming in", () => {
    const water = ob({ kind: "water", label: "Water", vendorId: "v1" });
    const b = bill(water, 14_210, "2027-03-18");
    expect(matchPayments([b], [water], [tx("2027-03-17", "BAYSHORE WATER AUTOPAY", -14_210)], { v1: "Bayshore Water (Demo)" })).toHaveLength(1);
    expect(matchPayments([b], [water], [tx("2027-03-17", "BAYSHORE WATER REFUND", 14_210)], { v1: "Bayshore Water (Demo)" })).toHaveLength(0);
  });
});

describe("recurring costs", () => {
  it("suggests a monthly payment nobody has added, with its range and next date", () => {
    const activity = [
      tx("2026-12-12", "GREENLEAF LAWN CARE #4412", -9_500, "acc-austin"),
      tx("2027-01-12", "GREENLEAF LAWN CARE #4471", -9_500, "acc-austin"),
      tx("2027-02-11", "GREENLEAF LAWN CARE #4519", -11_000, "acc-austin"),
      tx("2027-03-13", "GREENLEAF LAWN CARE #4570", -9_500, "acc-austin"),
      tx("2027-03-01", "TRANSFER TO SAVINGS", -50_000, "acc-austin"),
      tx("2027-02-01", "TRANSFER TO SAVINGS", -50_000, "acc-austin"),
      tx("2027-01-01", "TRANSFER TO SAVINGS", -50_000, "acc-austin"),
    ];
    const [s, ...rest] = detectRecurring(activity, []);
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ key: "greenleaf lawn care", label: "Greenleaf Lawn Care", kind: "maintenance", occurrences: 4, min: 9_500, max: 11_000, typical: 9_500, nextDueOn: "2027-04-13" });
  });

  it("doesn't suggest what's already a cost, or irregular payments", () => {
    const hoa = ob({ kind: "hoa", label: "HOA dues", payeeMatch: "Bluebonnet Commons" });
    const monthly = ["2027-01-10", "2027-02-10", "2027-03-10"].map((d) => tx(d, "BLUEBONNET COMMONS HOA", -8_500));
    expect(detectRecurring(monthly, [hoa])).toEqual([]);
    const weekly = ["2027-03-01", "2027-03-08", "2027-03-15", "2027-03-22"].map((d) => tx(d, "CORNER COFFEE", -600));
    expect(detectRecurring(weekly, [])).toEqual([]);
  });

  it("guesses the kind from the statement text", () => {
    expect(guessKind("coastal power & light")).toBe("electricity");
    expect(guessKind("city water utility")).toBe("water");
    expect(guessKind("summit peak insurance")).toBe("insurance");
    expect(guessKind("empire mutual servicing")).toBe("mortgage");
    expect(guessKind("palmetto pool care")).toBe("maintenance");
    expect(guessKind("netflix")).toBe("other");
    expect(merchantKey("GREENLEAF LAWN CARE #4412 03/13")).toBe("greenleaf lawn care");
  });
});

describe("lender data", () => {
  it("updates the mortgage from the servicer and treats an escrow balance only as a hint", () => {
    const m = ob({ kind: "mortgage", label: "Mortgage", expectedAmount: 297_000, nextDueOn: "2027-04-01", status: "suggested" });
    const tax = ob({ kind: "property_tax", label: "Property tax", escrowStatus: "unknown" });
    const [u] = lenderUpdates(
      [{ accountId: "m1", lenderName: "Lone Star Home Lending", nextPaymentDueOn: "2027-04-22", nextMonthlyPayment: 298_000, escrowBalance: 421_000, propertyStreet: "2210 CEDAR HOLLOW RD" }],
      "2210 Cedar Hollow Road",
      [m, tax],
    );
    expect(u).toMatchObject({ obligationId: m.id, patch: { nextDueOn: "2027-04-22", expectedAmount: 298_000 }, escrowHintFor: [tax.id] });
    expect(u!.summary).toBe("Lone Star Home Lending reports the next payment of $2,980 due Apr 22, with $4,210 held in escrow.");
    expect(lenderUpdates([{ accountId: "m1", lenderName: "X", nextPaymentDueOn: null, nextMonthlyPayment: null, escrowBalance: null, propertyStreet: "9 Other St" }], "2210 Cedar Hollow Road", [m])).toEqual([]);
    expect(streetKey("88 Harborview Place, Apt 12B")).toBe("88 harborview");
  });
});
