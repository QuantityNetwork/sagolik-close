/**
 * Property Autopilot — reading bank activity (deterministic, provider-independent).
 *
 * Three jobs, all pure functions over data the caller fetched:
 *  1. Verify payments: a bill becomes "paid (verified)" only when a bank
 *     outflow matches it exactly (amount), plausibly (date window) and by
 *     payee (a distinctive word from the payee or vendor name).
 *  2. Discover recurring costs the owner hasn't added: repeating monthly
 *     payments to the same merchant become suggestions, never active costs.
 *  3. Apply the lender's mortgage data (next payment, escrow balance).
 *
 * Raw transactions are inputs only; callers keep the conclusions, not the data.
 */
import type { Bill, Obligation, ObligationKind } from "@sagolik/types";
import { addDays, addMonths, daysBetween, formatAmount, formatDay } from "./autopilot";

/** A bank transaction as the rules see it. Negative amounts are money leaving the account. */
export interface BankActivity {
  id: string;
  accountId: string;
  accountLabel: string;
  date: string;
  description: string;
  /** Minor units; negative = outflow. */
  amount: number;
}

// ---------------------------------------------------------------- payee words

const STOP_WORDS = new Set([
  "the", "and", "inc", "llc", "ltd", "co", "corp", "company", "demo", "payment", "pmt", "autopay", "auto", "online", "bill", "billpay", "ach", "debit", "web", "pos", "purchase",
  "services", "service", "of", "for", "to", "from", "via", "usa", "us",
]);

/** Distinctive lowercase words (3+ letters, not generic) used to recognise a payee on a statement. */
export function payeeWords(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set(text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w)))];
}

function mentions(description: string, words: string[]): boolean {
  if (!words.length) return false;
  const text = ` ${description.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ")} `;
  return words.some((w) => text.includes(` ${w} `));
}

/** The words that identify an obligation's payee: its bank-statement text, else the vendor's name. */
export function obligationPayeeWords(ob: Obligation, vendorName?: string | null): string[] {
  return payeeWords(ob.payeeMatch ?? vendorName ?? null);
}

// ---------------------------------------------------------------- 1. verify payments

export interface PaymentMatch {
  billId: string;
  activityId: string;
  paidOn: string;
  reference: string;
}

/** How early or late (days) a payment may be relative to the due date. */
export const PAYMENT_WINDOW = { before: 20, after: 10 } as const;

/**
 * Matches open or owner-reported bills to bank outflows. Requires the exact
 * amount, a date within the window (around the reported payment date if the
 * owner gave one), and the payee named on the statement. Each transaction
 * confirms at most one bill; the closest date wins.
 */
export function matchPayments(bills: Bill[], obligations: Obligation[], activity: BankActivity[], vendorNames: Record<string, string> = {}): PaymentMatch[] {
  const obById = new Map(obligations.map((o) => [o.id, o]));
  const used = new Set<string>();
  const out: PaymentMatch[] = [];
  const candidates = bills.filter((b) => (b.status === "received" || b.status === "paid_reported") && b.amount > 0).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  for (const bill of candidates) {
    const ob = obById.get(bill.obligationId);
    if (!ob) continue;
    const words = obligationPayeeWords(ob, ob.vendorId ? vendorNames[ob.vendorId] : null);
    const anchor = bill.paidOn ?? bill.dueOn;
    const from = addDays(anchor, bill.paidOn ? -5 : -PAYMENT_WINDOW.before);
    const to = addDays(anchor, bill.paidOn ? 5 : PAYMENT_WINDOW.after + ob.graceDays);
    const hit = activity
      .filter((t) => !used.has(t.id) && t.amount === -bill.amount && t.date >= from && t.date <= to && mentions(t.description, words))
      .sort((a, b) => Math.abs(daysBetween(a.date, anchor)) - Math.abs(daysBetween(b.date, anchor)))[0];
    if (!hit) continue;
    used.add(hit.id);
    out.push({ billId: bill.id, activityId: hit.id, paidOn: hit.date, reference: `Bank: ${hit.description.trim().slice(0, 60)}, ${formatDay(hit.date)} (${hit.accountLabel})`.slice(0, 120) });
  }
  return out;
}

// ---------------------------------------------------------------- 2. recurring costs

const NOT_A_COST = /\b(transfer|xfer|payroll|salary|deposit|atm|withdrawal|venmo|zelle|paypal|cash app|interest|refund|credit card payment|card payment)\b/i;

const KIND_HINTS: Array<[ObligationKind, RegExp]> = [
  ["mortgage", /\b(mortgage|home loans?|servicing|mtg)\b/i],
  ["property_tax", /\b(tax|treasurer|collector|assessor)\b/i],
  ["insurance", /\b(insur\w*|mutual|assurance|casualty)\b/i],
  ["hoa", /\b(hoa|homeowners? assoc\w*|association|condo\w*|commons)\b/i],
  ["electricity", /\b(electric\w*|power|energy|light)\b/i],
  ["gas", /\b(gas)\b/i],
  ["water", /\b(water|sewer|utilit\w*)\b/i],
  ["internet", /\b(internet|fiber|broadband|cable|wireless|telecom)\b/i],
  ["security", /\b(security|alarm|monitoring)\b/i],
  ["property_management", /\b(property management|management|realty)\b/i],
  ["maintenance", /\b(lawn|pool|landscap\w*|cleaning|pest|snow|plumb\w*|hvac|maintenance|gardening)\b/i],
];

export function guessKind(description: string): ObligationKind {
  return KIND_HINTS.find(([, re]) => re.test(description))?.[0] ?? "other";
}

/** Statement text → a stable merchant key ("GREENLEAF LAWN CARE #123 05/14" → "greenleaf lawn care"). */
export function merchantKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/[0-9#*/.:-]+/g, " ")
    .replace(/[^a-z&\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .slice(0, 4)
    .join(" ");
}

export interface RecurringSuggestion {
  key: string;
  label: string;
  kind: ObligationKind;
  accountId: string;
  occurrences: number;
  min: number;
  max: number;
  typical: number;
  lastDate: string;
  nextDueOn: string;
  payeeMatch: string;
  reason: string;
}

export const RECURRING_RULES = { minOccurrences: 3, minInterval: 25, maxInterval: 35 } as const;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Monthly payments to the same merchant (3+ times, 25–35 days apart) that no
 * existing cost already covers. Transfers, payroll, card payments and the
 * like are ignored.
 */
export function detectRecurring(activity: BankActivity[], obligations: Obligation[], vendorNames: Record<string, string> = {}): RecurringSuggestion[] {
  const known = obligations.filter((o) => o.status !== "ended").map((o) => obligationPayeeWords(o, o.vendorId ? vendorNames[o.vendorId] : null));
  const groups = new Map<string, BankActivity[]>();
  for (const t of activity) {
    if (t.amount >= 0 || NOT_A_COST.test(t.description)) continue;
    const key = merchantKey(t.description);
    if (!key) continue;
    const k = `${t.accountId}|${key}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: RecurringSuggestion[] = [];
  for (const [k, txns] of groups) {
    if (txns.length < RECURRING_RULES.minOccurrences) continue;
    const key = k.slice(k.indexOf("|") + 1);
    if (known.some((words) => words.length && mentions(key, words))) continue; // already a cost
    const dates = txns.map((t) => t.date).sort();
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d));
    const gap = median(gaps);
    if (gap < RECURRING_RULES.minInterval || gap > RECURRING_RULES.maxInterval) continue;
    const amounts = txns.map((t) => -t.amount);
    const last = dates[dates.length - 1]!;
    const lo = Math.min(...amounts);
    const hi = Math.max(...amounts);
    out.push({
      key,
      label: titleCase(key),
      kind: guessKind(key),
      accountId: txns[0]!.accountId,
      occurrences: txns.length,
      min: lo,
      max: hi,
      typical: median(amounts),
      lastDate: last,
      nextDueOn: addMonths(last, 1),
      payeeMatch: key.slice(0, 80),
      reason: `Paid ${txns.length} times, about monthly, ${lo === hi ? formatAmount(lo) : `${formatAmount(lo)}–${formatAmount(hi)}`}, most recently ${formatDay(last)} from ${txns[0]!.accountLabel}.`,
    });
  }
  return out.sort((a, b) => b.occurrences - a.occurrences || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------- 3. lender data

/** A mortgage as the lender reports it (Plaid Liabilities or a sandbox). */
export interface LenderMortgage {
  accountId: string;
  lenderName: string;
  nextPaymentDueOn: string | null;
  /** Minor units. */
  nextMonthlyPayment: number | null;
  /** Minor units; above zero means the servicer holds an escrow account. */
  escrowBalance: number | null;
  propertyStreet: string | null;
}

/** "412 Coral Shell Way, Apt 2" and "412 CORAL SHELL WY" → "412 coral". */
export function streetKey(street: string | null | undefined): string | null {
  if (!street) return null;
  const m = street.toLowerCase().match(/^\s*(\d+)\s+([a-z]+)/);
  return m ? `${m[1]} ${m[2]}` : null;
}

export interface MortgageUpdate {
  obligationId: string | null;
  lenderName: string;
  patch: Partial<Pick<Obligation, "expectedAmount" | "nextDueOn">>;
  /** Tax and insurance costs whose escrow status should become "possibly escrowed". */
  escrowHintFor: string[];
  summary: string;
}

/**
 * Applies the lender's figures to the property's mortgage cost (matched by the
 * property address the lender reports). The next due date and payment are
 * facts from the servicer; an escrow balance is only a hint that taxes and
 * insurance may be paid from escrow, so it never confirms that by itself.
 */
export function lenderUpdates(mortgages: LenderMortgage[], propertyStreet: string, obligations: Obligation[]): MortgageUpdate[] {
  const key = streetKey(propertyStreet);
  if (!key) return [];
  const out: MortgageUpdate[] = [];
  for (const m of mortgages.filter((x) => streetKey(x.propertyStreet) === key)) {
    const ob = obligations.find((o) => o.kind === "mortgage" && o.status !== "ended") ?? null;
    const patch: MortgageUpdate["patch"] = {};
    if (m.nextPaymentDueOn && m.nextPaymentDueOn !== ob?.nextDueOn) patch.nextDueOn = m.nextPaymentDueOn;
    if (m.nextMonthlyPayment !== null && m.nextMonthlyPayment !== ob?.expectedAmount) patch.expectedAmount = m.nextMonthlyPayment;
    const escrowHintFor =
      m.escrowBalance !== null && m.escrowBalance > 0
        ? obligations.filter((o) => (o.kind === "property_tax" || o.kind === "insurance") && o.escrowStatus === "unknown").map((o) => o.id)
        : [];
    if (!ob || Object.keys(patch).length || escrowHintFor.length) {
      out.push({
        obligationId: ob?.id ?? null,
        lenderName: m.lenderName,
        patch,
        escrowHintFor,
        summary: `${m.lenderName} reports ${m.nextMonthlyPayment !== null ? `the next payment of ${formatAmount(m.nextMonthlyPayment)}` : "the mortgage"}${m.nextPaymentDueOn ? ` due ${formatDay(m.nextPaymentDueOn)}` : ""}${m.escrowBalance ? `, with ${formatAmount(m.escrowBalance)} held in escrow` : ""}.`,
      });
    }
  }
  return out;
}
