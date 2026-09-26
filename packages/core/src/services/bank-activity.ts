/**
 * Property Autopilot — reading the owner's bank activity.
 *
 * Read-only: Sagolik looks at posted transactions on the accounts the owner
 * linked to a property, and at the lender's mortgage figures, to
 *  - confirm bills as "paid (verified)" (exact amount, payee, plausible date),
 *  - suggest recurring costs nobody has added yet (never activated on its own),
 *  - keep the mortgage's next payment in line with what the servicer reports.
 * Raw transactions are never stored: only the conclusions (a bill's payment
 * reference, a suggested cost) and an audit entry with counts.
 *
 * Direct mode reads through the banking provider with the stored token. With
 * the money service, only the connection's owner can read (the money service
 * re-checks that), so the background pass runs in direct mode only.
 */
import { ProviderError } from "@sagolik/integrations";
import type { BankAccount, BankConnection, PropertyPassport } from "@sagolik/types";
import { addDays, type BankActivity, detectRecurring, type LenderMortgage, lenderUpdates, matchPayments } from "@sagolik/workflow";
import { isUser, type ServiceContext } from "../context";
import { audit } from "../events";
import { moneyCaller } from "../money/bridge";
import { MoneyServiceError } from "../money/client";
import { loadAuthorized } from "../snapshot";
import { newId, nowIso, today } from "../util";
import { passportInScope, recordDecisions } from "./autopilot";
import { accessTokenFor, moneyConnectionId } from "./banking";

/** How far back to read. Enough for three monthly payments plus a late one. */
export const BANK_ACTIVITY_DAYS = 120;

export interface BankActivityResult {
  verified: number;
  suggested: number;
  lenderUpdates: number;
  accountsRead: number;
  /** People-facing reasons some data couldn't be read (nothing is guessed in its place). */
  notes: string[];
}

interface Fetched {
  activity: BankActivity[];
  mortgages: LenderMortgage[];
  accountsRead: number;
  notes: string[];
}

const label = (a: BankAccount) => `${a.name} •••• ${a.mask}`;

/** Reads one connection's activity for the given accounts (and its lender data). */
async function readConnection(ctx: ServiceContext, conn: BankConnection, accounts: BankAccount[], from: string, to: string): Promise<Fetched> {
  const out: Fetched = { activity: [], mortgages: [], accountsRead: 0, notes: [] };
  const byExternal = new Map(accounts.map((a) => [a.externalAccountId, a]));
  const keep = (externalAccountId: string, t: { id: string; date: string; description: string; amount: number }) => {
    const a = byExternal.get(externalAccountId);
    if (a) out.activity.push({ id: t.id, accountId: a.id, accountLabel: label(a), date: t.date, description: t.description, amount: t.amount });
  };
  const moneyId = moneyConnectionId(conn);
  if (moneyId) {
    if (!ctx.money || !isUser(ctx.actor) || ctx.actor.userId !== conn.userId || !conn.transactionId) {
      out.notes.push(`${conn.institutionName}: only the person who connected it can check its activity.`);
      return out;
    }
    const s = await loadAuthorized(ctx, conn.transactionId, "transaction.view");
    const caller = moneyCaller(ctx, s, "payment.initiate");
    try {
      const { transactions } = await ctx.money.bankTransactions(caller, moneyId, BANK_ACTIVITY_DAYS);
      for (const t of transactions) keep(t.accountId, t);
      out.accountsRead = accounts.length;
    } catch (e) {
      if (!(e instanceof MoneyServiceError)) throw e;
      out.notes.push(`${conn.institutionName}: ${e.userMessage}`);
      return out;
    }
    try {
      const { mortgages } = await ctx.money.bankMortgages(caller, moneyId);
      for (const m of mortgages) out.mortgages.push({ accountId: "", lenderName: m.lenderName ?? conn.institutionName, nextPaymentDueOn: m.nextPaymentDueOn, nextMonthlyPayment: m.nextMonthlyPayment, escrowBalance: m.escrowBalance, propertyStreet: m.propertyStreet });
    } catch (e) {
      if (!(e instanceof MoneyServiceError)) throw e; // lender data is optional: not enabled or no mortgage here
    }
    return out;
  }

  const bank = ctx.providers.banking;
  const data = bank.activityData ?? { transactions: false, mortgages: false };
  if (!data.transactions) {
    out.notes.push("Reading bank transactions isn't switched on for this deployment.");
    return out;
  }
  let token: string;
  try {
    token = await accessTokenFor(ctx, conn.id);
  } catch {
    out.notes.push(`${conn.institutionName} needs to be reconnected.`);
    return out;
  }
  try {
    for (const t of await bank.getTransactions(token, { from, to })) keep(t.externalAccountId, t);
    out.accountsRead = accounts.length;
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    out.notes.push(`${conn.institutionName}: ${e.userMessage}`);
    return out;
  }
  if (data.mortgages && bank.getMortgages) {
    try {
      for (const m of await bank.getMortgages(token)) out.mortgages.push({ ...m, accountId: m.externalAccountId });
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      ctx.log.info("lender data unavailable", { connectionId: conn.id, code: e.code });
    }
  }
  return out;
}

/** Accounts that fund exactly this property (a shared account's payments can't be told apart). */
async function dedicatedAccountIds(ctx: ServiceContext, passport: PropertyPassport, accountIds: string[]): Promise<Set<string>> {
  const [funding, obligations] = await Promise.all([
    ctx.writer.funding_rules.find({ organizationId: passport.organizationId }),
    ctx.writer.obligations.find({ organizationId: passport.organizationId }),
  ]);
  const users = new Map<string, Set<string>>();
  const use = (accountId: string | null, passportId: string) => {
    if (accountId) users.set(accountId, (users.get(accountId) ?? new Set()).add(passportId));
  };
  for (const f of funding) {
    use(f.operatingAccountId, f.passportId);
    use(f.reserveAccountId, f.passportId);
  }
  for (const o of obligations) if (o.status !== "ended") use(o.fundingAccountId, o.passportId);
  return new Set(accountIds.filter((id) => users.get(id)?.size === 1));
}

/** The work itself; the caller has authorized access to the passport. */
async function syncPassport(ctx: ServiceContext, passport: PropertyPassport): Promise<BankActivityResult> {
  const w = ctx.writer;
  const [funding, obligations, bills, vendors, property] = await Promise.all([
    w.funding_rules.findOne({ passportId: passport.id }),
    w.obligations.find({ passportId: passport.id }),
    w.bills.find({ passportId: passport.id }),
    w.vendors.find({ organizationId: passport.organizationId }),
    w.properties.get(passport.propertyId),
  ]);
  const result: BankActivityResult = { verified: 0, suggested: 0, lenderUpdates: 0, accountsRead: 0, notes: [] };
  const accountIds = [...new Set([funding?.operatingAccountId, funding?.reserveAccountId, ...obligations.filter((o) => o.status !== "ended").map((o) => o.fundingAccountId)].filter((x): x is string => !!x))];
  if (!accountIds.length) {
    result.notes.push("Link a bank account to this property (Cash flow tab) so Sagolik can confirm payments.");
    return result;
  }
  const accounts = await w.bank_accounts.find({ id: accountIds });
  const conns = await w.bank_connections.find({ id: [...new Set(accounts.map((a) => a.connectionId))] });
  const t = today(ctx);
  const from = addDays(t, -BANK_ACTIVITY_DAYS);
  const activity: BankActivity[] = [];
  const mortgages: LenderMortgage[] = [];
  for (const conn of conns) {
    if (conn.status !== "connected") {
      result.notes.push(`${conn.institutionName} needs to be reconnected.`);
      continue;
    }
    const got = await readConnection(ctx, conn, accounts.filter((a) => a.connectionId === conn.id), from, t);
    activity.push(...got.activity);
    mortgages.push(...got.mortgages);
    result.accountsRead += got.accountsRead;
    result.notes.push(...got.notes);
  }
  const vendorNames = Object.fromEntries(vendors.map((v) => [v.id, v.name]));
  const now = nowIso(ctx);

  // 1. Payments the bank confirms.
  for (const m of matchPayments(bills, obligations, activity, vendorNames)) {
    await w.bills.update(m.billId, { status: "paid_verified", paidOn: m.paidOn, paymentReference: m.reference, verifiedAt: now });
    await audit(ctx, { action: "autopilot.bill_paid_verified", resourceType: "bill", resourceId: m.billId, organizationId: passport.organizationId, metadata: { via: "bank_activity" } });
    result.verified++;
  }

  // 2. Recurring costs nobody added, only from accounts dedicated to this property.
  const dedicated = await dedicatedAccountIds(ctx, passport, accountIds);
  const dismissed = new Set(obligations.map((o) => o.payeeMatch?.toLowerCase()).filter(Boolean));
  for (const s of detectRecurring(activity.filter((a) => dedicated.has(a.accountId)), obligations, vendorNames)) {
    if (dismissed.has(s.payeeMatch)) continue; // already suggested once (kept, confirmed or ended)
    const variable = s.min !== s.max;
    const ob = await w.obligations.insert({
      id: newId(),
      organizationId: passport.organizationId,
      passportId: passport.id,
      vendorId: null,
      kind: s.kind,
      label: s.label,
      priority: "important",
      amountType: variable ? "variable" : "fixed",
      expectedAmount: s.typical,
      expectedMin: variable ? s.min : null,
      expectedMax: variable ? s.max : null,
      currency: property?.currency ?? "USD",
      frequency: "monthly",
      nextDueOn: s.nextDueOn,
      graceDays: 0,
      payMethod: "unknown",
      escrowStatus: "not_applicable",
      fundingAccountId: s.accountId,
      referenceLast4: null,
      payeeMatch: s.payeeMatch,
      source: "bank_history",
      confidence: Math.min(90, 50 + s.occurrences * 10),
      status: "suggested",
      endedOn: null,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, { action: "autopilot.obligation_suggested", resourceType: "obligation", resourceId: ob.id, organizationId: passport.organizationId, metadata: { kind: ob.kind, via: "bank_activity", occurrences: s.occurrences } });
    result.suggested++;
  }

  // 3. The lender's figures for this property's mortgage.
  if (property && mortgages.length) {
    for (const u of lenderUpdates(mortgages, property.addressLine1, obligations)) {
      let obligationId = u.obligationId;
      if (obligationId && Object.keys(u.patch).length) await w.obligations.update(obligationId, u.patch);
      if (!obligationId) {
        const created = await w.obligations.insert({
          id: newId(),
          organizationId: passport.organizationId,
          passportId: passport.id,
          vendorId: null,
          kind: "mortgage",
          label: `Mortgage (${u.lenderName})`.slice(0, 120),
          priority: "critical",
          amountType: "fixed",
          expectedAmount: u.patch.expectedAmount ?? null,
          expectedMin: null,
          expectedMax: null,
          currency: property.currency,
          frequency: "monthly",
          nextDueOn: u.patch.nextDueOn ?? null,
          graceDays: 15,
          payMethod: "unknown",
          escrowStatus: "not_applicable",
          fundingAccountId: null,
          referenceLast4: null,
          payeeMatch: null,
          source: "bank_history",
          confidence: 90,
          status: "suggested",
          endedOn: null,
          createdBy: null,
          createdAt: now,
          updatedAt: now,
        });
        obligationId = created.id;
        result.suggested++;
      }
      for (const id of u.escrowHintFor) await w.obligations.update(id, { escrowStatus: "possibly_escrowed" });
      await audit(ctx, { action: "autopilot.lender_data_applied", resourceType: "obligation", resourceId: obligationId, organizationId: passport.organizationId, metadata: { summary: u.summary, escrowHints: u.escrowHintFor.length } });
      result.lenderUpdates++;
    }
  }

  await audit(ctx, {
    action: "autopilot.bank_checked",
    resourceType: "property_passport",
    resourceId: passport.id,
    organizationId: passport.organizationId,
    metadata: { accounts: result.accountsRead, transactions: activity.length, verified: result.verified, suggested: result.suggested, lenderUpdates: result.lenderUpdates },
  });
  await recordDecisions(ctx, [passport.organizationId]);
  return result;
}

/** "Check bank activity" on a property (members who manage it). */
export async function syncBankActivity(ctx: ServiceContext, passportId: string): Promise<BankActivityResult> {
  const { passport } = await passportInScope(ctx, passportId, "manage");
  if (passport.monitoring === "off") return { verified: 0, suggested: 0, lenderUpdates: 0, accountsRead: 0, notes: ["Monitoring is off for this property."] };
  return syncPassport(ctx, passport);
}

/**
 * Worker: check every monitored property (direct mode only; with the money
 * service, reads need the connection's owner and happen when they ask).
 */
export async function runBankActivityChecks(ctx: ServiceContext): Promise<number> {
  if (ctx.money) return 0;
  let n = 0;
  for (const p of await ctx.writer.property_passports.find({ monitoring: "monitor", status: "live" })) {
    try {
      const r = await syncPassport(ctx, p);
      n += r.verified + r.suggested + r.lenderUpdates;
    } catch (e) {
      ctx.log.warn("bank activity check failed", { passportId: p.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return n;
}
