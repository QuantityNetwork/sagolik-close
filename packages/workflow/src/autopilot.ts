/**
 * Property Autopilot — the deterministic rules (monitor and verify).
 *
 * Pure functions over plain data: no database, no clock (today is passed in),
 * no language model. Sagolik never pays anything; these rules decide what the
 * owner should know about the payments their bank, autopay and mortgage
 * servicer will make: what's coming, what's unusual, what's not funded, what
 * may be paid twice, and what needs a person.
 *
 * Money is integer minor units (cents) throughout. Ratios (e.g. "9.4× usual")
 * are only ever used for display and thresholds, never for amounts.
 */
import type { Bill, Currency, DecisionOutcome, DecisionSeverity, FundingRule, Obligation, ObligationKind, PassportStatus, ReviewPolicy } from "@sagolik/types";

// ---------------------------------------------------------------- dates (YYYY-MM-DD, UTC)

const DAY_MS = 86_400_000;
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromTime = (t: number) => new Date(t).toISOString().slice(0, 10);

export function addDays(d: string, n: number): string {
  return fromTime(toTime(d) + n * DAY_MS);
}

/** Adds months, clamping to the month's last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return fromTime(Date.UTC(ny, nm, Math.min(day, last)));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toTime(to) - toTime(from)) / DAY_MS);
}

const MONTHS: Record<Obligation["frequency"], number | null> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12, once: null, irregular: null };

// ---------------------------------------------------------------- wording

export const OBLIGATION_KIND_LABELS: Record<ObligationKind, string> = {
  mortgage: "Mortgage",
  property_tax: "Property tax",
  insurance: "Insurance",
  hoa: "HOA",
  electricity: "Electricity",
  water: "Water",
  gas: "Gas",
  internet: "Internet",
  security: "Security",
  property_management: "Property management",
  maintenance: "Maintenance",
  other: "Other",
};

/** Kinds a property can't go without. Mortgage and HOA only apply when they exist. */
export const REQUIRED_KINDS: readonly ObligationKind[] = ["property_tax", "insurance"];
/** Paid by the mortgage servicer when escrowed. */
export const ESCROWABLE_KINDS: readonly ObligationKind[] = ["property_tax", "insurance"];

export function formatAmount(minor: number, currency: Currency = "USD"): string {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(minor / 100);
}

export function formatDay(d: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
}

// ---------------------------------------------------------------- inputs

/** A bank account as the rules see it: balance and freshness, never numbers. */
export interface FundingAccountView {
  id: string;
  label: string;
  mask: string;
  currency: Currency;
  /** Available balance in minor units; null when the bank didn't report one. */
  available: number | null;
  asOf: string | null;
  connectionOk: boolean;
}

export interface PassportInput {
  passportId: string;
  label: string;
  status: PassportStatus;
  monitoring: "off" | "monitor";
  currency: Currency;
  /** YYYY-MM-DD. */
  today: string;
  obligations: Obligation[];
  bills: Bill[];
  /** Enabled rules for this passport (portfolio-wide and its own), in evaluation order. */
  policies: ReviewPolicy[];
  funding: FundingRule | null;
  accounts: FundingAccountView[];
}

// ---------------------------------------------------------------- usual amounts

export interface UsualRange {
  min: number;
  max: number;
  typical: number;
  basis: "history" | "expected";
  samples: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

export const HISTORY_MIN_SAMPLES = 3;
const HISTORY_WINDOW = 12;

/**
 * What this obligation usually costs: from the last 12 bills that were paid
 * (at least 3), otherwise from the amounts the owner told us to expect.
 */
export function usualRange(ob: Obligation, bills: Bill[], excludeBillId?: string): UsualRange | null {
  const history = bills
    .filter((b) => b.obligationId === ob.id && b.id !== excludeBillId && (b.status === "paid_verified" || b.status === "paid_reported"))
    .sort((a, b) => b.dueOn.localeCompare(a.dueOn))
    .slice(0, HISTORY_WINDOW)
    .map((b) => b.amount);
  if (history.length >= HISTORY_MIN_SAMPLES) {
    return { min: Math.min(...history), max: Math.max(...history), typical: median(history), basis: "history", samples: history.length };
  }
  if (ob.expectedMin !== null && ob.expectedMax !== null) {
    return { min: ob.expectedMin, max: ob.expectedMax, typical: ob.expectedAmount ?? Math.round((ob.expectedMin + ob.expectedMax) / 2), basis: "expected", samples: history.length };
  }
  if (ob.expectedAmount !== null) {
    return { min: ob.expectedAmount, max: ob.expectedAmount, typical: ob.expectedAmount, basis: "expected", samples: history.length };
  }
  return null;
}

function rangeText(r: UsualRange, currency: Currency) {
  return r.min === r.max ? formatAmount(r.min, currency) : `${formatAmount(r.min, currency)}–${formatAmount(r.max, currency)}`;
}

// ---------------------------------------------------------------- escrow

export function isEscrowCovered(ob: Obligation): boolean {
  return ob.payMethod === "escrow" || (ESCROWABLE_KINDS.includes(ob.kind) && ob.escrowStatus === "confirmed_escrowed");
}

function escrowUncertain(ob: Obligation): boolean {
  return ESCROWABLE_KINDS.includes(ob.kind) && (ob.escrowStatus === "possibly_escrowed" || ob.escrowStatus === "unknown") && ob.payMethod !== "escrow";
}

// ---------------------------------------------------------------- anomalies

/** Tolerances. Deterministic and explainable; tune per portfolio later. */
export const ANOMALY_RULES = {
  /** A bill above the usual maximum × this factor (and by at least minHighDelta) is unusual. */
  highFactor: 1.5,
  minHighDelta: 5_000,
  /** A bill below the usual minimum × this factor is unusually low (info only). */
  lowFactor: 0.5,
  /** Same obligation, same amount, due within this many days: possible duplicate. */
  duplicateWindowDays: 7,
} as const;

export type AnomalyCode = "high_amount" | "low_amount" | "amount_changed" | "duplicate" | "escrow_double_pay" | "unexpected_bill";

export interface Anomaly {
  code: AnomalyCode;
  message: string;
  /** Amount ÷ typical, for high/low amounts. */
  factor?: number;
}

export function detectBillAnomalies(bill: Bill, ob: Obligation, bills: Bill[]): Anomaly[] {
  if (bill.status === "cancelled" || bill.status === "disputed" || bill.status === "covered_by_escrow") return [];
  const out: Anomaly[] = [];
  const cur = bill.currency;

  const twin = bills.find(
    (b) =>
      b.id !== bill.id &&
      b.obligationId === bill.obligationId &&
      b.status !== "cancelled" &&
      b.amount === bill.amount &&
      Math.abs(daysBetween(b.dueOn, bill.dueOn)) <= ANOMALY_RULES.duplicateWindowDays &&
      b.createdAt <= bill.createdAt,
  );
  if (twin) out.push({ code: "duplicate", message: `A bill for the same amount (${formatAmount(bill.amount, cur)}) is already due ${formatDay(twin.dueOn)}.` });

  if (ESCROWABLE_KINDS.includes(ob.kind) && ob.escrowStatus === "confirmed_escrowed") {
    out.push({ code: "escrow_double_pay", message: `Your mortgage servicer pays ${OBLIGATION_KIND_LABELS[ob.kind].toLowerCase()} from escrow, so paying this bill yourself would pay it twice.` });
  }

  if (ob.status === "ended") out.push({ code: "unexpected_bill", message: "This service was ended, but a new bill arrived." });

  if (ob.amountType === "fixed" && ob.expectedAmount !== null && bill.amount !== ob.expectedAmount) {
    const diff = bill.amount - ob.expectedAmount;
    out.push({ code: "amount_changed", message: `${formatAmount(Math.abs(diff), cur)} ${diff > 0 ? "more" : "less"} than the usual ${formatAmount(ob.expectedAmount, cur)}.` });
  } else if (ob.amountType !== "fixed") {
    const usual = usualRange(ob, bills, bill.id);
    if (usual && usual.typical > 0) {
      const factor = Math.round((bill.amount / usual.typical) * 10) / 10;
      if (bill.amount > usual.max * ANOMALY_RULES.highFactor && bill.amount - usual.max >= ANOMALY_RULES.minHighDelta) {
        out.push({ code: "high_amount", factor, message: `${factor}× the usual amount (${rangeText(usual, cur)}${usual.basis === "history" ? `, last ${usual.samples} bills` : ""}).` });
      } else if (bill.amount < usual.min * ANOMALY_RULES.lowFactor) {
        out.push({ code: "low_amount", factor, message: `Lower than usual (${rangeText(usual, cur)}). Worth a glance: it may be a partial or estimated bill.` });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- review rules

export function matchPolicy(amount: number, kind: ObligationKind, policies: ReviewPolicy[]): ReviewPolicy | null {
  return (
    [...policies]
      .filter((p) => p.enabled)
      .sort((a, b) => a.position - b.position)
      .find((p) => (p.obligationKind === null || p.obligationKind === kind) && amount >= p.minAmount && (p.maxAmount === null || amount <= p.maxAmount)) ?? null
  );
}

/** Starting rules for a new owner (the prompt's authority matrix, for monitoring). */
export function defaultReviewPolicies(): Array<Pick<ReviewPolicy, "name" | "obligationKind" | "minAmount" | "maxAmount" | "action" | "position">> {
  const rows: Array<Pick<ReviewPolicy, "name" | "obligationKind" | "minAmount" | "maxAmount" | "action">> = [
    { name: "Any bill over $50,000 needs two people", obligationKind: null, minAmount: 5_000_001, maxAmount: null, action: "two_person_review" },
    { name: "Mortgage payments are routine", obligationKind: "mortgage", minAmount: 0, maxAmount: null, action: "routine" },
    { name: "Any bill over $10,000 needs your review", obligationKind: null, minAmount: 1_000_001, maxAmount: null, action: "owner_review" },
    { name: "Property tax is routine", obligationKind: "property_tax", minAmount: 0, maxAmount: null, action: "routine" },
    { name: "Insurance up to $10,000 is routine", obligationKind: "insurance", minAmount: 0, maxAmount: 1_000_000, action: "routine" },
    { name: "HOA up to $5,000 is routine", obligationKind: "hoa", minAmount: 0, maxAmount: 500_000, action: "routine" },
    { name: "Electricity up to $1,000 is routine", obligationKind: "electricity", minAmount: 0, maxAmount: 100_000, action: "routine" },
    { name: "Water up to $1,000 is routine", obligationKind: "water", minAmount: 0, maxAmount: 100_000, action: "routine" },
    { name: "Gas up to $1,000 is routine", obligationKind: "gas", minAmount: 0, maxAmount: 100_000, action: "routine" },
    { name: "Internet up to $1,000 is routine", obligationKind: "internet", minAmount: 0, maxAmount: 100_000, action: "routine" },
  ];
  return rows.map((r, position) => ({ ...r, position }));
}

// ---------------------------------------------------------------- decisions

export interface Decision {
  outcome: DecisionOutcome;
  severity: DecisionSeverity;
  summary: string;
  reasons: string[];
  rule: string | null;
  amount: number | null;
  currency: Currency | null;
  obligationId: string | null;
  billId: string | null;
  /** Deadline the owner should act by, if any. */
  deadline: string | null;
  /** Stable part of the dedupe key: the same situation isn't recorded twice. */
  key: string;
}

export const SEVERITY_ORDER: Record<DecisionSeverity, number> = { critical: 3, urgent: 2, action_required: 1, info: 0 };

function paidBy(ob: Obligation): string {
  switch (ob.payMethod) {
    case "autopay":
      return "your autopay";
    case "bank_bill_pay":
      return "your bank's bill pay";
    case "escrow":
      return "your mortgage servicer (escrow)";
    case "manual":
      return "you";
    default:
      return "whoever pays it today";
  }
}

const isReviewed = (b: Bill) => b.reviewedAt !== null;
const isTwoPersonReviewed = (b: Bill) => b.reviewedAt !== null && b.secondReviewedAt !== null;

/**
 * What Sagolik concludes about one bill. Order matters: settled states first,
 * then anything that could cost money twice, then unusual amounts, then
 * lateness, then the owner's review rules.
 */
export function evaluateBill(bill: Bill, ob: Obligation, input: Pick<PassportInput, "today" | "bills" | "policies">): Decision | null {
  const cur = bill.currency;
  const amt = formatAmount(bill.amount, cur);
  const name = ob.label;
  const base = { amount: bill.amount, currency: cur, obligationId: ob.id, billId: bill.id, rule: null as string | null };
  const due = `due ${formatDay(bill.dueOn)}`;

  if (bill.status === "cancelled") return null;
  if (bill.status === "paid_verified")
    return { ...base, outcome: "paid_verified", severity: "info", summary: `${name} ${amt} paid`, reasons: [bill.paymentReference ? `Confirmed: ${bill.paymentReference}.` : "Confirmed by bank data."], deadline: null, key: `bill:${bill.id}:paid_verified` };
  if (bill.status === "paid_reported")
    return { ...base, outcome: "paid_reported", severity: "info", summary: `${name} ${amt} marked as paid`, reasons: ["You marked this as paid. Sagolik will confirm it against your bank activity once transaction data is connected."], deadline: null, key: `bill:${bill.id}:paid_reported` };
  if (bill.status === "covered_by_escrow")
    return { ...base, outcome: "covered_by_escrow", severity: "info", summary: `${name} covered through mortgage escrow`, reasons: ["Your mortgage servicer pays this from your escrow account. Don't pay it separately."], deadline: null, key: `bill:${bill.id}:escrow` };
  if (bill.status === "disputed")
    return { ...base, outcome: "review_required", severity: "action_required", summary: `${name} ${amt} disputed`, reasons: ["You marked this bill as disputed. Resolve it with the vendor before it's paid."], deadline: bill.dueOn, key: `bill:${bill.id}:disputed` };

  const anomalies = detectBillAnomalies(bill, ob, input.bills);
  const overdue = daysBetween(addDays(bill.dueOn, ob.graceDays), input.today) > 0;
  const who = paidBy(ob);
  const pullsAutomatically = ob.payMethod === "autopay" || ob.payMethod === "bank_bill_pay";

  const doublePay = anomalies.find((a) => a.code === "escrow_double_pay");
  if (doublePay)
    return { ...base, outcome: "duplicate_risk", severity: pullsAutomatically ? "urgent" : "action_required", summary: `${name} ${amt} may be paid twice`, reasons: [doublePay.message, pullsAutomatically ? `${who[0]!.toUpperCase()}${who.slice(1)} is also set to pay it; stop that payment.` : "Check with your servicer before paying."], deadline: bill.dueOn, key: `bill:${bill.id}:escrow_double_pay` };

  if (escrowUncertain(ob) && !isReviewed(bill))
    return { ...base, outcome: "verify_escrow", severity: "action_required", summary: `Check whether escrow covers ${name.toLowerCase()} (${amt}, ${due})`, reasons: [ob.escrowStatus === "possibly_escrowed" ? "Your loan terms suggest your servicer may pay this from escrow." : "We don't know yet whether your servicer pays this from escrow.", "Confirm with your servicer before paying, so it isn't paid twice."], deadline: bill.dueOn, key: `bill:${bill.id}:verify_escrow` };

  const unusual = anomalies.filter((a) => a.code === "high_amount" || a.code === "amount_changed" || a.code === "duplicate" || a.code === "unexpected_bill");
  if (unusual.length && !isReviewed(bill)) {
    const dup = unusual.find((a) => a.code === "duplicate");
    const high = unusual.find((a) => a.code === "high_amount");
    const reasons = unusual.map((a) => a.message);
    reasons.push(pullsAutomatically ? `${who[0]!.toUpperCase()}${who.slice(1)} will pay it on ${formatDay(bill.dueOn)} unless you stop it. Sagolik doesn't pay bills, so check with the vendor first.` : `Check it with the vendor before paying it on ${formatDay(bill.dueOn)}.`);
    return {
      ...base,
      outcome: dup ? "duplicate_risk" : "anomaly",
      severity: pullsAutomatically ? "urgent" : "action_required",
      summary: dup ? `${name} ${amt} may be a duplicate` : high ? `${name} ${amt} is ${high.factor}× the usual amount` : `${name} ${amt} is not the usual amount`,
      reasons,
      deadline: bill.dueOn,
      key: `bill:${bill.id}:${dup ? "duplicate" : "anomaly"}`,
    };
  }

  if (overdue)
    return {
      ...base,
      outcome: "overdue",
      severity: ob.priority === "critical" ? "critical" : "urgent",
      summary: `${name} ${amt} is overdue`,
      reasons: [`It was due ${formatDay(bill.dueOn)}${ob.graceDays ? ` (grace period ${ob.graceDays} days)` : ""} and isn't marked as paid.`, ob.priority === "critical" ? "Late payment on this can put the property at risk." : "Late fees may apply."],
      deadline: bill.dueOn,
      key: `bill:${bill.id}:overdue`,
    };

  const policy = matchPolicy(bill.amount, ob.kind, input.policies);
  const low = anomalies.find((a) => a.code === "low_amount");
  const extra = [...(low ? [low.message] : []), ...(isReviewed(bill) ? ["You reviewed this bill."] : [])];
  const action = policy?.action ?? "owner_review";
  const rule = policy?.name ?? "No rule covers this bill, so it needs your review";

  if (action === "flag" && !isReviewed(bill))
    return { ...base, rule, outcome: "flagged", severity: "urgent", summary: `${name} ${amt} flagged`, reasons: [`Rule: ${rule}.`, "Hold the payment until you've checked it."], deadline: bill.dueOn, key: `bill:${bill.id}:flagged` };
  if (action === "two_person_review" && !isTwoPersonReviewed(bill))
    return { ...base, rule, outcome: "two_person_review", severity: "action_required", summary: `${name} ${amt} needs two reviewers`, reasons: [`Rule: ${rule}.`, bill.reviewedAt ? "One person has reviewed it; a second, different person must too." : "Two different people must review it before it's paid.", `Paid by ${who}, ${due}.`], deadline: bill.dueOn, key: `bill:${bill.id}:two_person` };
  if (action === "owner_review" && !isReviewed(bill))
    return { ...base, rule, outcome: "review_required", severity: "action_required", summary: `${name} ${amt} needs your review`, reasons: [`Rule: ${rule}.`, `Paid by ${who}, ${due}.`], deadline: bill.dueOn, key: `bill:${bill.id}:review` };

  return { ...base, rule, outcome: "routine", severity: "info", summary: `${name} ${amt}, ${due}`, reasons: [policy ? `Rule: ${rule}.` : "Reviewed.", `Paid by ${who}.`, ...extra], deadline: null, key: `bill:${bill.id}:routine` };
}

// ---------------------------------------------------------------- upcoming & forecast

export type ForecastBasis = "bill" | "fixed" | "estimate" | "unknown" | "escrow";

export interface ForecastLine {
  obligationId: string;
  label: string;
  kind: ObligationKind;
  priority: Obligation["priority"];
  dueOn: string;
  /** Point estimate used for totals (minor units); null when unknown. */
  amount: number | null;
  /** Conservative amount for funding checks (high end of the usual range). */
  high: number | null;
  range: [number, number] | null;
  basis: ForecastBasis;
  billId: string | null;
  fundingAccountId: string | null;
  payMethod: Obligation["payMethod"];
  overdue: boolean;
}

/** Due dates of an obligation from `from` (inclusive) to `to` (inclusive). */
export function dueDatesBetween(ob: Obligation, from: string, to: string): string[] {
  if (!ob.nextDueOn) return [];
  const step = MONTHS[ob.frequency];
  if (step === null) return ob.nextDueOn >= from && ob.nextDueOn <= to ? [ob.nextDueOn] : [];
  const out: string[] = [];
  let d = ob.nextDueOn;
  let i = 0;
  // A stale next-due date (in the past) rolls forward by the frequency.
  while (d < from && i < 600) d = addMonths(ob.nextDueOn, step * ++i);
  while (d <= to && i < 600) {
    out.push(d);
    d = addMonths(ob.nextDueOn, step * ++i);
  }
  return out;
}

const openStatus = (b: Bill) => b.status === "received" || b.status === "disputed";

/**
 * Everything expected in the next `days` days: actual bills first, then
 * predictions from each active obligation where no bill has arrived yet.
 * Overdue open bills are included (they still need money). Predictions are
 * always marked as such.
 */
export function upcoming(input: PassportInput, days: number): ForecastLine[] {
  const to = addDays(input.today, days);
  const active = input.obligations.filter((o) => o.status === "active");
  const lines: ForecastLine[] = [];

  for (const ob of active) {
    const escrowed = isEscrowCovered(ob);
    const obBills = input.bills.filter((b) => b.obligationId === ob.id && b.status !== "cancelled");
    for (const b of obBills) {
      if (b.status === "covered_by_escrow") {
        if (b.dueOn >= input.today && b.dueOn <= to) lines.push(line(ob, b.dueOn, 0, 0, null, "escrow", b.id, false));
        continue;
      }
      if (!openStatus(b)) continue;
      const overdue = b.dueOn < input.today;
      if (overdue || b.dueOn <= to) lines.push(line(ob, b.dueOn, escrowed ? 0 : b.amount, escrowed ? 0 : b.amount, null, escrowed ? "escrow" : "bill", b.id, overdue && daysBetween(addDays(b.dueOn, ob.graceDays), input.today) > 0));
    }
    const period = MONTHS[ob.frequency];
    const window = period ? Math.min(10, Math.round((period * 30) / 3)) : 10;
    for (const due of dueDatesBetween(ob, input.today, to)) {
      // A bill (open or already paid) near this date replaces the prediction.
      if (obBills.some((b) => Math.abs(daysBetween(b.dueOn, due)) <= window)) continue;
      if (escrowed) {
        lines.push(line(ob, due, 0, 0, null, "escrow", null, false));
        continue;
      }
      const usual = usualRange(ob, input.bills);
      if (ob.amountType === "fixed" && ob.expectedAmount !== null) lines.push(line(ob, due, ob.expectedAmount, ob.expectedAmount, null, "fixed", null, false));
      else if (usual) lines.push(line(ob, due, usual.typical, usual.max, usual.min === usual.max ? null : [usual.min, usual.max], "estimate", null, false));
      else lines.push(line(ob, due, null, null, null, "unknown", null, false));
    }
  }
  return lines.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.label.localeCompare(b.label));
}

function line(ob: Obligation, dueOn: string, amount: number | null, high: number | null, range: [number, number] | null, basis: ForecastBasis, billId: string | null, overdue: boolean): ForecastLine {
  return { obligationId: ob.id, label: ob.label, kind: ob.kind, priority: ob.priority, dueOn, amount, high, range, basis, billId, fundingAccountId: ob.fundingAccountId, payMethod: ob.payMethod, overdue };
}

export interface ForecastSummary {
  days: number;
  lines: ForecastLine[];
  /** From bills that have arrived. */
  billed: number;
  /** Predicted from obligations (fixed amounts and usual ranges). */
  predicted: number;
  total: number;
  /** Lines whose amount we can't estimate yet. */
  unknown: number;
  byKind: Partial<Record<ObligationKind, number>>;
}

export function forecast(input: PassportInput, days: number): ForecastSummary {
  const lines = upcoming(input, days);
  const billed = lines.filter((l) => l.basis === "bill").reduce((s, l) => s + (l.amount ?? 0), 0);
  const predicted = lines.filter((l) => l.basis === "fixed" || l.basis === "estimate").reduce((s, l) => s + (l.amount ?? 0), 0);
  const byKind: ForecastSummary["byKind"] = {};
  for (const l of lines) byKind[l.kind] = (byKind[l.kind] ?? 0) + (l.amount ?? 0);
  return { days, lines, billed, predicted, total: billed + predicted, unknown: lines.filter((l) => l.basis === "unknown").length, byKind };
}

// ---------------------------------------------------------------- funding

export interface FundingCheck {
  accountId: string | null;
  accountLabel: string | null;
  passportIds: string[];
  horizonDays: number;
  /** Conservative total due from this account within the horizon. */
  needed: number;
  available: number | null;
  minBalance: number;
  /** available − minimum balance. */
  usable: number | null;
  shortfall: number;
  reserveAccountId: string | null;
  reserveLabel: string | null;
  reserveAvailable: number | null;
  /** How much to move from the reserve (Sagolik only recommends it). */
  suggestedTransfer: number;
  status: "covered" | "shortfall_reserve_can_cover" | "shortfall" | "no_account" | "no_balance";
  reasons: string[];
  /** Earliest due date among the lines this account must cover. */
  firstDue: string | null;
}

export const FUNDING_HORIZON_DAYS = 30;

/**
 * Checks each operating account against everything it must pay in the
 * horizon, across all properties that share it (so one balance isn't counted
 * twice). Uses the high end of usual ranges: better to warn early.
 */
export function checkFunding(inputs: PassportInput[], horizonDays = FUNDING_HORIZON_DAYS): FundingCheck[] {
  type Acc = { passportIds: Set<string>; needed: number; firstDue: string | null; input: PassportInput };
  const byAccount = new Map<string, Acc>();
  const results: FundingCheck[] = [];

  for (const input of inputs) {
    if (input.monitoring !== "monitor") continue;
    const operating = input.funding?.operatingAccountId ?? null;
    const lines = upcoming(input, horizonDays).filter((l) => l.basis !== "escrow" && l.payMethod !== "escrow");
    for (const l of lines) {
      const accountId = l.fundingAccountId ?? operating;
      const key = accountId ?? `none:${input.passportId}`;
      const acc = byAccount.get(key) ?? { passportIds: new Set<string>(), needed: 0, firstDue: null, input };
      acc.passportIds.add(input.passportId);
      acc.needed += l.high ?? l.amount ?? 0;
      if (!acc.firstDue || l.dueOn < acc.firstDue) acc.firstDue = l.dueOn;
      byAccount.set(key, acc);
    }
  }

  for (const [key, acc] of byAccount) {
    const input = acc.input;
    const cur = input.currency;
    if (key.startsWith("none:")) {
      results.push({ accountId: null, accountLabel: null, passportIds: [...acc.passportIds], horizonDays, needed: acc.needed, available: null, minBalance: 0, usable: null, shortfall: 0, reserveAccountId: null, reserveLabel: null, reserveAvailable: null, suggestedTransfer: 0, status: "no_account", reasons: [`${formatAmount(acc.needed, cur)} is due in the next ${horizonDays} days, but no paying account is set.`], firstDue: acc.firstDue });
      continue;
    }
    const account = input.accounts.find((a) => a.id === key) ?? inputs.flatMap((i) => i.accounts).find((a) => a.id === key) ?? null;
    // Minimum balance and reserve: from the funding rule that names this account as operating.
    const rule = inputs.map((i) => i.funding).find((f) => f?.operatingAccountId === key) ?? null;
    const minBalance = rule?.minOperatingBalance ?? 0;
    const reserve = rule?.reserveAccountId ? (inputs.flatMap((i) => i.accounts).find((a) => a.id === rule.reserveAccountId) ?? null) : null;
    const label = account ? `${account.label} •••• ${account.mask}` : "Paying account";
    const base = { accountId: key, accountLabel: label, passportIds: [...acc.passportIds], horizonDays, needed: acc.needed, minBalance, reserveAccountId: reserve?.id ?? null, reserveLabel: reserve ? `${reserve.label} •••• ${reserve.mask}` : null, reserveAvailable: reserve?.available ?? null, firstDue: acc.firstDue };
    if (!account || account.available === null || !account.connectionOk) {
      results.push({ ...base, available: account?.available ?? null, usable: null, shortfall: 0, suggestedTransfer: 0, status: "no_balance", reasons: [account && !account.connectionOk ? `${label} needs to be reconnected before we can check its balance.` : `We don't have a current balance for ${label}.`] });
      continue;
    }
    const usable = account.available - minBalance;
    const shortfall = Math.max(0, acc.needed - usable);
    const reasons = [
      `${formatAmount(acc.needed, cur)} is due from ${label} in the next ${horizonDays} days (using the high end of usual amounts).`,
      `Available: ${formatAmount(account.available, cur)}${minBalance ? `, keeping ${formatAmount(minBalance, cur)} as the minimum balance` : ""}.`,
    ];
    if (shortfall === 0) {
      results.push({ ...base, available: account.available, usable, shortfall, suggestedTransfer: 0, status: "covered", reasons });
      continue;
    }
    reasons.push(`Projected shortfall: ${formatAmount(shortfall, cur)}${acc.firstDue ? `, starting with the payment due ${formatDay(acc.firstDue)}` : ""}.`);
    if (reserve && reserve.available !== null && reserve.connectionOk && reserve.available >= shortfall) {
      reasons.push(`${base.reserveLabel} has ${formatAmount(reserve.available, cur)}. Move ${formatAmount(shortfall, cur)} to cover it; Sagolik doesn't move money.`);
      results.push({ ...base, available: account.available, usable, shortfall, suggestedTransfer: shortfall, status: "shortfall_reserve_can_cover", reasons });
    } else {
      reasons.push(reserve ? `The reserve account can't cover it either.` : "No reserve account is set for this property.");
      results.push({ ...base, available: account.available, usable, shortfall, suggestedTransfer: 0, status: "shortfall", reasons });
    }
  }
  return results;
}

// ---------------------------------------------------------------- continuity

export type ContinuityStatus = "protected" | "attention" | "at_risk" | "not_monitored";

export interface ChecklistItem {
  kind: ObligationKind;
  label: string;
  state: "ok" | "escrow" | "attention" | "at_risk" | "missing" | "to_confirm";
  detail: string;
}

export interface AttentionItem {
  /** Stable id (for dedupe and UI keys). */
  id: string;
  passportId: string;
  passportLabel: string;
  severity: Exclude<DecisionSeverity, "info">;
  outcome: DecisionOutcome;
  title: string;
  why: string;
  action: string;
  deadline: string | null;
  amount: number | null;
  obligationId: string | null;
  billId: string | null;
}

export interface PassportAssessment {
  passportId: string;
  label: string;
  status: ContinuityStatus;
  headline: string;
  reasons: string[];
  checklist: ChecklistItem[];
  decisions: Decision[];
  attention: AttentionItem[];
  funding: FundingCheck[];
  next30: ForecastSummary;
}

const ACTIONS: Partial<Record<DecisionOutcome, string>> = {
  anomaly: "Check the bill with the vendor. If it's right, mark it reviewed; if not, dispute it and stop the autopay.",
  duplicate_risk: "Make sure only one payment goes out.",
  verify_escrow: "Ask your mortgage servicer whether they pay this, then record the answer.",
  review_required: "Review the bill and mark it reviewed.",
  two_person_review: "Two different people review the bill.",
  flagged: "Check the bill before any payment goes out.",
  overdue: "Pay it or tell us it's paid, and contact the vendor if you need more time.",
  funding_shortfall: "Move money into the paying account before the first payment.",
  missing_information: "Add the missing details.",
};

function toAttention(input: PassportInput, d: Decision): AttentionItem | null {
  if (d.severity === "info") return null;
  return {
    id: `${input.passportId}:${d.key}`,
    passportId: input.passportId,
    passportLabel: input.label,
    severity: d.severity,
    outcome: d.outcome,
    title: d.summary,
    why: d.reasons.join(" "),
    action: ACTIONS[d.outcome] ?? "Take a look.",
    deadline: d.deadline,
    amount: d.amount,
    obligationId: d.obligationId,
    billId: d.billId,
  };
}

/** Obligation-level findings that don't need a bill (missing details, escrow unknown). */
function obligationDecisions(input: PassportInput): Decision[] {
  const out: Decision[] = [];
  const suggested = input.obligations.filter((o) => o.status === "suggested");
  if (suggested.length) {
    out.push({
      outcome: "missing_information",
      severity: "action_required",
      summary: `Confirm ${suggested.length} suggested ${suggested.length === 1 ? "cost" : "costs"}`,
      reasons: [`Found from ${[...new Set(suggested.map((o) => (o.source === "closing" ? "your closing" : o.source === "document" ? "your documents" : o.source === "bank_history" ? "your bank history" : "setup")))].join(" and ")}: ${suggested.map((o) => o.label).join(", ")}. They aren't monitored until you confirm them.`],
      rule: null,
      amount: null,
      currency: null,
      obligationId: null,
      billId: null,
      deadline: null,
      key: `suggested:${suggested.map((o) => o.id).sort().join(",")}`,
    });
  }
  for (const ob of input.obligations.filter((o) => o.status === "active")) {
    const hasOpenBill = input.bills.some((b) => b.obligationId === ob.id && b.status === "received");
    if (escrowUncertain(ob) && !hasOpenBill) {
      out.push({ outcome: "verify_escrow", severity: "action_required", summary: `Check whether escrow covers ${ob.label.toLowerCase()}`, reasons: [ob.escrowStatus === "possibly_escrowed" ? "Your loan terms suggest your servicer may pay this from escrow." : "We don't know yet whether your mortgage servicer pays this from escrow.", "Knowing this prevents paying it twice, or not at all."], rule: null, amount: null, currency: null, obligationId: ob.id, billId: null, deadline: ob.nextDueOn, key: `ob:${ob.id}:verify_escrow:${ob.escrowStatus}` });
    }
    if (ob.priority === "critical" && !ob.nextDueOn && !isEscrowCovered(ob)) {
      out.push({ outcome: "missing_information", severity: "action_required", summary: `Add the next due date for ${ob.label.toLowerCase()}`, reasons: ["Without it, Sagolik can't warn you before it's due."], rule: null, amount: null, currency: null, obligationId: ob.id, billId: null, deadline: null, key: `ob:${ob.id}:no_due_date` });
    }
  }
  return out;
}

function fundingDecision(input: PassportInput, f: FundingCheck): Decision | null {
  if (f.status === "covered") return null;
  const cur = input.currency;
  if (f.status === "no_account")
    return { outcome: "missing_information", severity: "action_required", summary: "Choose the account that pays this property's bills", reasons: f.reasons, rule: null, amount: f.needed, currency: cur, obligationId: null, billId: null, deadline: f.firstDue, key: `funding:none` };
  if (f.status === "no_balance")
    return { outcome: "missing_information", severity: "action_required", summary: "Balance unavailable for the paying account", reasons: f.reasons, rule: null, amount: null, currency: cur, obligationId: null, billId: null, deadline: f.firstDue, key: `funding:${f.accountId}:no_balance` };
  const covered = f.status === "shortfall_reserve_can_cover";
  return {
    outcome: "funding_shortfall",
    severity: covered ? "action_required" : "critical",
    summary: covered ? `Move ${formatAmount(f.shortfall, cur)} from your reserve` : `${formatAmount(f.shortfall, cur)} projected shortfall`,
    reasons: f.reasons,
    rule: null,
    amount: f.shortfall,
    currency: cur,
    obligationId: null,
    billId: null,
    deadline: f.firstDue,
    // Recorded once per shortfall episode (status and first payment it affects), not on every balance change.
    key: `funding:${f.accountId}:${f.status}:${f.firstDue}`,
  };
}

/** The whole picture for one property, given the portfolio's funding checks. */
export function assessPassport(input: PassportInput, fundingChecks: FundingCheck[]): PassportAssessment {
  const next30 = forecast(input, 30);
  if (input.monitoring !== "monitor" || input.status === "sold") {
    return { passportId: input.passportId, label: input.label, status: "not_monitored", headline: input.status === "sold" ? "Sold. The record is kept as ownership history." : "Monitoring is off.", reasons: [], checklist: [], decisions: [], attention: [], funding: [], next30 };
  }
  const obById = new Map(input.obligations.map((o) => [o.id, o]));
  const billDecisions = input.bills
    .filter((b) => b.status !== "cancelled")
    .map((b) => {
      const ob = obById.get(b.obligationId);
      return ob ? evaluateBill(b, ob, input) : null;
    })
    .filter((d): d is Decision => d !== null);
  const funding = fundingChecks.filter((f) => f.passportIds.includes(input.passportId));
  const decisions = [...billDecisions, ...obligationDecisions(input), ...funding.map((f) => fundingDecision(input, f)).filter((d): d is Decision => d !== null)];
  const attention = decisions
    .map((d) => toAttention(input, d))
    .filter((a): a is AttentionItem => a !== null)
    .sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));

  // Checklist: every kind present, plus required kinds that are missing.
  const kinds = new Set<ObligationKind>([...input.obligations.filter((o) => o.status !== "ended").map((o) => o.kind), ...REQUIRED_KINDS]);
  const checklist: ChecklistItem[] = [...kinds].map((kind) => {
    const obs = input.obligations.filter((o) => o.kind === kind && o.status !== "ended");
    const label = obs[0]?.label ?? OBLIGATION_KIND_LABELS[kind];
    if (!obs.length) return { kind, label, state: "missing", detail: "Not set up yet." };
    if (obs.every((o) => o.status === "suggested")) return { kind, label, state: "to_confirm", detail: "Suggested; confirm to start monitoring." };
    const ids = new Set(obs.map((o) => o.id));
    const worst = attention.filter((a) => a.obligationId && ids.has(a.obligationId)).sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity])[0];
    if (worst) return { kind, label, state: worst.severity === "critical" ? "at_risk" : "attention", detail: worst.title };
    if (obs.some((o) => isEscrowCovered(o))) return { kind, label, state: "escrow", detail: "Covered through mortgage escrow." };
    const next = next30.lines.find((l) => ids.has(l.obligationId));
    return { kind, label, state: "ok", detail: next ? `Next: ${next.amount !== null ? formatAmount(next.amount, input.currency) : "amount to come"}, ${formatDay(next.dueOn)}` : "Nothing due in the next 30 days." };
  });

  const critical = attention.filter((a) => a.severity === "critical");
  const missingRequired = checklist.filter((c) => c.state === "missing" && REQUIRED_KINDS.includes(c.kind));
  const status: ContinuityStatus = critical.length ? "at_risk" : attention.length || missingRequired.length ? "attention" : "protected";
  const cur = input.currency;
  const reasons =
    status === "protected"
      ? [
          `${checklist.filter((c) => c.state === "ok" || c.state === "escrow").length} costs monitored, none overdue.`,
          ...funding.filter((f) => f.status === "covered").map((f) => `${f.accountLabel} covers the ${formatAmount(f.needed, cur)} due in the next ${f.horizonDays} days.`),
          ...(next30.unknown ? [`${next30.unknown} upcoming ${next30.unknown === 1 ? "amount isn't" : "amounts aren't"} known yet.`] : []),
        ]
      : [...critical, ...attention.filter((a) => a.severity !== "critical")].slice(0, 5).map((a) => a.title).concat(missingRequired.map((c) => `${c.label} isn't set up yet.`));
  const headline =
    status === "protected" ? "All critical costs are covered for the next 30 days." : status === "at_risk" ? "Something could lapse without action." : `${attention.length + missingRequired.length} ${attention.length + missingRequired.length === 1 ? "thing needs" : "things need"} your attention.`;
  return { passportId: input.passportId, label: input.label, status, headline, reasons, checklist, decisions, attention, funding, next30 };
}

// ---------------------------------------------------------------- portfolio

export interface PortfolioSummary {
  properties: number;
  protected: number;
  attention: number;
  atRisk: number;
  notMonitored: number;
  next7: number;
  next30: number;
  /** Sum of available balances of the paying accounts (each counted once). */
  operatingAvailable: number;
  reserveAvailable: number;
  suggestedTransfers: number;
  /** Share of the next 30 days' costs covered by usable funds, 0–1 (null when nothing is due or balances are unknown). */
  coverage: number | null;
  attentionItems: AttentionItem[];
  assessments: PassportAssessment[];
}

/** A shared paying account's shortfall shows once in the portfolio queue, naming every property. */
function dedupeShared(items: AttentionItem[]): AttentionItem[] {
  const out: AttentionItem[] = [];
  const shared = new Map<string, AttentionItem>();
  for (const item of items) {
    const suffix = item.id.slice(item.passportId.length + 1);
    if (!suffix.startsWith("funding:")) {
      out.push(item);
      continue;
    }
    const seen = shared.get(suffix);
    if (seen) seen.passportLabel = `${seen.passportLabel}, ${item.passportLabel}`;
    else {
      const copy = { ...item };
      shared.set(suffix, copy);
      out.push(copy);
    }
  }
  return out;
}

export function assessPortfolio(inputs: PassportInput[]): PortfolioSummary {
  const funding = checkFunding(inputs);
  const assessments = inputs.map((i) => assessPassport(i, funding));
  const monitored = inputs.filter((i) => i.monitoring === "monitor");
  const operatingIds = new Set(monitored.map((i) => i.funding?.operatingAccountId).filter((x): x is string => !!x));
  const reserveIds = new Set(monitored.map((i) => i.funding?.reserveAccountId).filter((x): x is string => !!x));
  const accounts = new Map(inputs.flatMap((i) => i.accounts).map((a) => [a.id, a]));
  const sum = (ids: Set<string>) => [...ids].reduce((s, id) => s + (accounts.get(id)?.available ?? 0), 0);
  const withBalance = funding.filter((f) => f.usable !== null);
  const needed = withBalance.reduce((s, f) => s + f.needed, 0);
  const coveredAmount = withBalance.reduce((s, f) => s + Math.min(f.needed, Math.max(0, f.usable!)), 0);
  return {
    properties: inputs.length,
    protected: assessments.filter((a) => a.status === "protected").length,
    attention: assessments.filter((a) => a.status === "attention").length,
    atRisk: assessments.filter((a) => a.status === "at_risk").length,
    notMonitored: assessments.filter((a) => a.status === "not_monitored").length,
    next7: monitored.reduce((s, i) => s + forecast(i, 7).total, 0),
    next30: assessments.filter((a) => a.status !== "not_monitored").reduce((s, a) => s + a.next30.total, 0),
    operatingAvailable: sum(operatingIds),
    reserveAvailable: sum(reserveIds),
    suggestedTransfers: funding.reduce((s, f) => s + f.suggestedTransfer, 0),
    coverage: needed > 0 ? coveredAmount / needed : null,
    attentionItems: dedupeShared(assessments.flatMap((a) => a.attention)).sort(
      (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"),
    ),
    assessments,
  };
}

// ---------------------------------------------------------------- setup helpers

/**
 * Monthly principal-and-interest for a fixed-rate loan, rounded to the cent.
 * An estimate from the closing's loan terms: the real payment (which may
 * include escrow for taxes and insurance) comes from the servicer.
 */
export function estimateMonthlyPayment(principal: number, rateBps: number, termMonths: number): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  const r = rateBps / 10_000 / 12;
  if (r === 0) return Math.round(principal / termMonths);
  return Math.round((principal * r) / (1 - Math.pow(1 + r, -termMonths)));
}

/** US mortgages: the first payment is due on the 1st of the second month after closing. */
export function firstMortgagePaymentDate(closedOn: string): string {
  const d = addMonths(closedOn, 2);
  return `${d.slice(0, 7)}-01`;
}
