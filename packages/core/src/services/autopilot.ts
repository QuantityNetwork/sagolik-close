/**
 * Property Autopilot — monitor and verify.
 *
 * After closing, Sagolik keeps each property's operating record and tells the
 * owner what needs attention. It never holds or moves money and never pays a
 * bill: the owner's bank, autopay and mortgage servicer do. Every conclusion
 * comes from the deterministic rules in @sagolik/workflow and is written to an
 * append-only decision log with its reasons.
 *
 * Access: properties belong to an owner organization (personal portfolio,
 * holding entity, family office, property manager). Members see them;
 * organization_admin and member can manage bills and costs; only
 * organization_admin changes rules and funding; auditors only read.
 */
import {
  addDays,
  addMonths,
  assessPortfolio,
  isEscrowCovered,
  defaultReviewPolicies,
  estimateMonthlyPayment,
  firstMortgagePaymentDate,
  forecast,
  formatAmount,
  type FundingAccountView,
  OBLIGATION_KIND_LABELS,
  type PassportAssessment,
  type PassportInput,
  type PortfolioSummary,
} from "@sagolik/workflow";
import { checkUpload } from "@sagolik/security";
import {
  AMOUNT_TYPES,
  type AutopilotDecision,
  type Bill,
  type Currency,
  ESCROW_STATUSES_AUTOPILOT,
  type FundingRule,
  OBLIGATION_FREQUENCIES,
  OBLIGATION_KINDS,
  OBLIGATION_PRIORITIES,
  type Obligation,
  type ObligationKind,
  type Organization,
  type OrganizationRole,
  PAY_METHODS,
  type Property,
  type PropertyPassport,
  REVIEW_ACTIONS,
  type ReviewPolicy,
  type Vendor,
  VENDOR_CATEGORIES,
} from "@sagolik/types";
import { z } from "zod";
import { type ServiceContext, isUser, requireUser } from "../context";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { audit } from "../events";
import { OWNER_ORGANIZATION_TYPES } from "../memberships";
import { newId, nowIso, today } from "../util";
import { notify } from "./notifications";

export const OWNER_ORG_TYPES = OWNER_ORGANIZATION_TYPES;
export const OWNER_ORG_TYPE_LABELS: Record<(typeof OWNER_ORG_TYPES)[number], string> = {
  personal_portfolio: "Personal",
  holding_entity: "Holding entity",
  family_office: "Family office",
  property_manager: "Property manager",
};
const isOwnerOrg = (o: Organization | null): o is Organization => !!o && (OWNER_ORG_TYPES as readonly string[]).includes(o.type);

// ----------------------------------------------------------------------------- access

type Level = "view" | "manage" | "admin";
const ROLE_RANK: Record<OrganizationRole, number> = { auditor: 1, member: 2, organization_admin: 3 };
const LEVEL_RANK: Record<Level, number> = { view: 1, manage: 2, admin: 3 };

async function roleIn(ctx: ServiceContext, organizationId: string): Promise<OrganizationRole | null> {
  const actor = requireUser(ctx);
  const [org, member] = await Promise.all([ctx.writer.organizations.get(organizationId), ctx.writer.organization_members.findOne({ organizationId, userId: actor.userId })]);
  return isOwnerOrg(org) && member ? member.role : null;
}

/** The caller's role in an owner organization, or not-found (no oracle). */
async function requireScope(ctx: ServiceContext, organizationId: string, level: Level, what = "That property"): Promise<OrganizationRole> {
  const role = await roleIn(ctx, organizationId);
  if (!role) throw notFound(what);
  if (ROLE_RANK[role] < LEVEL_RANK[level]) throw forbidden(level === "admin" ? "Only an owner of this portfolio can change its rules and accounts." : "You can view this portfolio but not change it.");
  return role;
}

async function myOwnerOrgs(ctx: ServiceContext): Promise<Array<{ org: Organization; role: OrganizationRole }>> {
  const actor = requireUser(ctx);
  const memberships = await ctx.writer.organization_members.find({ userId: actor.userId });
  if (!memberships.length) return [];
  const orgs = await ctx.writer.organizations.find({ id: memberships.map((m) => m.organizationId) });
  return orgs.filter(isOwnerOrg).map((org) => ({ org, role: memberships.find((m) => m.organizationId === org.id)!.role }));
}

export async function passportInScope(ctx: ServiceContext, passportId: string, level: Level) {
  const passport = await ctx.writer.property_passports.get(passportId);
  if (!passport) throw notFound("That property");
  const role = await requireScope(ctx, passport.organizationId, level);
  return { passport, role };
}

// ----------------------------------------------------------------------------- loading

interface Loaded {
  inputs: PassportInput[];
  passports: PropertyPassport[];
  properties: Map<string, Property>;
  orgs: Map<string, Organization>;
}

async function accountViews(ctx: ServiceContext, ids: string[]): Promise<FundingAccountView[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  // Balances are the owner's own data (RLS: owner only); read after scope authorization.
  const accounts = await ctx.writer.bank_accounts.find({ id: unique });
  const conns = await ctx.writer.bank_connections.find({ id: [...new Set(accounts.map((a) => a.connectionId))] });
  return accounts.map((a) => ({
    id: a.id,
    label: a.name,
    mask: a.mask,
    currency: a.currency,
    available: a.availableBalance,
    asOf: a.balanceAsOf,
    connectionOk: conns.find((c) => c.id === a.connectionId)?.status === "connected",
  }));
}

async function loadInputs(ctx: ServiceContext, organizationIds: string[]): Promise<Loaded> {
  const empty: Loaded = { inputs: [], passports: [], properties: new Map(), orgs: new Map() };
  if (!organizationIds.length) return empty;
  const w = ctx.writer;
  const passports = await w.property_passports.find({ organizationId: organizationIds }, { orderBy: "createdAt" });
  if (!passports.length) return { ...empty, orgs: new Map((await w.organizations.find({ id: organizationIds })).map((o) => [o.id, o])) };
  const ids = passports.map((p) => p.id);
  const [obligations, bills, policies, funding, properties, orgs] = await Promise.all([
    w.obligations.find({ passportId: ids }),
    w.bills.find({ passportId: ids }, { orderBy: "dueOn" }),
    w.review_policies.find({ organizationId: organizationIds }, { orderBy: "position" }),
    w.funding_rules.find({ passportId: ids }),
    w.properties.find({ id: passports.map((p) => p.propertyId) }),
    w.organizations.find({ id: organizationIds }),
  ]);
  const accounts = await accountViews(ctx, [
    ...funding.flatMap((f) => [f.operatingAccountId, f.reserveAccountId]),
    ...obligations.map((o) => o.fundingAccountId),
  ].filter((x): x is string => !!x));
  const t = today(ctx);
  const inputs: PassportInput[] = passports.map((p) => {
    const property = properties.find((x) => x.id === p.propertyId);
    return {
      passportId: p.id,
      label: p.label,
      status: p.status,
      monitoring: p.monitoring,
      currency: property?.currency ?? "USD",
      today: t,
      obligations: obligations.filter((o) => o.passportId === p.id),
      bills: bills.filter((b) => b.passportId === p.id),
      policies: policies.filter((r) => r.organizationId === p.organizationId && r.enabled && (r.passportId === null || r.passportId === p.id)),
      funding: funding.find((f) => f.passportId === p.id) ?? null,
      accounts,
    };
  });
  return { inputs, passports, properties: new Map(properties.map((x) => [x.id, x])), orgs: new Map(orgs.map((o) => [o.id, o])) };
}

// ----------------------------------------------------------------------------- decisions log

/**
 * Evaluates the given portfolios and appends any new conclusions to the
 * decision log (each situation once, by its dedupe key). New items that need a
 * person trigger one notification per portfolio; routine ones only appear in
 * the activity timeline.
 */
export async function recordDecisions(ctx: ServiceContext, organizationIds: string[]): Promise<number> {
  const { inputs, orgs } = await loadInputs(ctx, organizationIds);
  if (!inputs.length) return 0;
  const summary = assessPortfolio(inputs);
  const t = today(ctx);
  let created = 0;
  const alerts = new Map<string, AutopilotDecision[]>();
  for (const a of summary.assessments) {
    const passport = await ctx.writer.property_passports.get(a.passportId);
    if (!passport) continue;
    for (const d of a.decisions) {
      const dedupeKey = `${a.passportId}:${d.key}`.slice(0, 300);
      if (await ctx.writer.autopilot_decisions.findOne({ dedupeKey })) continue;
      try {
        const row = await ctx.writer.autopilot_decisions.insert({
          id: newId(),
          organizationId: passport.organizationId,
          passportId: a.passportId,
          obligationId: d.obligationId,
          billId: d.billId,
          outcome: d.outcome,
          severity: d.severity,
          summary: d.summary.slice(0, 300),
          reasons: d.reasons,
          rule: d.rule,
          amount: d.amount,
          currency: d.currency,
          evaluatedOn: t,
          dedupeKey,
          createdAt: nowIso(ctx),
        });
        created++;
        if (row.severity !== "info") alerts.set(row.organizationId, [...(alerts.get(row.organizationId) ?? []), row]);
      } catch (e) {
        if ((e as { code?: string }).code !== "conflict") throw e; // another worker recorded it first
      }
    }
  }
  for (const [organizationId, rows] of alerts) {
    const members = await ctx.writer.organization_members.find({ organizationId, role: ["organization_admin", "member"] });
    const critical = rows.some((r) => r.severity === "critical" || r.severity === "urgent");
    const first = rows[0]!;
    const passport = await ctx.writer.property_passports.get(first.passportId);
    await notify(ctx, {
      userIds: members.map((m) => m.userId),
      transactionId: null,
      kind: critical ? "autopilot_urgent" : "autopilot_attention",
      title: rows.length === 1 ? `${passport?.label ?? "Property"}: ${first.summary}` : `${rows.length} things need attention across ${orgs.get(organizationId)?.name ?? "your properties"}`,
      body: rows.length === 1 ? (first.reasons[0] ?? first.summary) : rows.slice(0, 3).map((r) => r.summary).join(" · "),
      linkPath: rows.length === 1 ? `/app/autopilot/${first.passportId}` : "/app/autopilot",
    });
  }
  return created;
}

/** Worker: re-evaluate every owner portfolio (idempotent; each situation is logged once). */
export async function runAutopilotChecks(ctx: ServiceContext): Promise<number> {
  const orgs = await ctx.writer.organizations.find({ type: [...OWNER_ORG_TYPES] });
  let n = 0;
  for (const o of orgs) n += await recordDecisions(ctx, [o.id]);
  return n;
}

// ----------------------------------------------------------------------------- views

export interface AutopilotProperty {
  passport: PropertyPassport;
  property: Property | null;
  scope: { id: string; name: string; type: string };
  assessment: PassportAssessment;
}

export interface AutopilotHome {
  summary: PortfolioSummary;
  properties: AutopilotProperty[];
  scopes: Array<{ id: string; name: string; type: string; role: OrganizationRole }>;
  /** Properties bought through Sagolik whose Autopilot isn't set up yet. */
  setup: Array<{ ownershipRecordId: string; address: string }>;
  recent: AutopilotDecision[];
}

export async function autopilotHome(ctx: ServiceContext): Promise<AutopilotHome> {
  const actor = requireUser(ctx);
  const scopes = await myOwnerOrgs(ctx);
  const loaded = await loadInputs(ctx, scopes.map((s) => s.org.id));
  const summary = assessPortfolio(loaded.inputs);
  const properties = loaded.passports.map((p) => ({
    passport: p,
    property: loaded.properties.get(p.propertyId) ?? null,
    scope: (() => {
      const o = loaded.orgs.get(p.organizationId)!;
      return { id: o.id, name: o.name, type: o.type };
    })(),
    assessment: summary.assessments.find((a) => a.passportId === p.id)!,
  }));
  const records = (await ctx.writer.ownership_records.find({})).filter((r) => r.ownerUserIds.includes(actor.userId));
  const linked = new Set(loaded.passports.map((p) => p.ownershipRecordId));
  const setup: AutopilotHome["setup"] = [];
  for (const r of records.filter((x) => !linked.has(x.id))) {
    const existing = await ctx.writer.property_passports.findOne({ ownershipRecordId: r.id });
    if (existing) continue; // set up in a portfolio this person isn't a member of
    const property = await ctx.writer.properties.get(r.propertyId);
    setup.push({ ownershipRecordId: r.id, address: property ? `${property.addressLine1}, ${property.city}` : "Your property" });
  }
  const recent = scopes.length ? await ctx.writer.autopilot_decisions.find({ organizationId: scopes.map((s) => s.org.id) }, { orderBy: "createdAt", ascending: false, limit: 12 }) : [];
  return { summary, properties, scopes: scopes.map((s) => ({ id: s.org.id, name: s.org.name, type: s.org.type, role: s.role })), setup, recent };
}

export interface LiveStep {
  key: string;
  label: string;
  state: "done" | "needs_you" | "not_applicable";
  detail: string;
}

export interface PassportView {
  passport: PropertyPassport;
  property: Property | null;
  scope: { id: string; name: string; type: string };
  role: OrganizationRole;
  canManage: boolean;
  canAdmin: boolean;
  assessment: PassportAssessment;
  forecasts: { 30: ReturnType<typeof forecast>; 60: ReturnType<typeof forecast>; 90: ReturnType<typeof forecast> };
  obligations: Obligation[];
  vendors: Vendor[];
  bills: Bill[];
  decisions: AutopilotDecision[];
  policies: ReviewPolicy[];
  funding: FundingRule | null;
  fundingAccounts: FundingAccountView[];
  /** Bank accounts the caller can assign (their own, connected). */
  myAccounts: Array<{ id: string; label: string }>;
  liveSteps: LiveStep[];
  reviewerNames: Record<string, string>;
}

export async function passportView(ctx: ServiceContext, passportId: string): Promise<PassportView> {
  const actor = requireUser(ctx);
  const { passport, role } = await passportInScope(ctx, passportId, "view");
  const loaded = await loadInputs(ctx, [passport.organizationId]);
  const summary = assessPortfolio(loaded.inputs);
  const input = loaded.inputs.find((i) => i.passportId === passportId)!;
  const org = loaded.orgs.get(passport.organizationId)!;
  const [vendors, decisions, policies, myConns] = await Promise.all([
    ctx.writer.vendors.find({ organizationId: passport.organizationId }, { orderBy: "name" }),
    ctx.writer.autopilot_decisions.find({ passportId }, { orderBy: "createdAt", ascending: false, limit: 60 }),
    ctx.writer.review_policies.find({ organizationId: passport.organizationId }, { orderBy: "position" }),
    ctx.writer.bank_connections.find({ userId: actor.userId, status: "connected" }),
  ]);
  const myAccounts = myConns.length ? (await ctx.writer.bank_accounts.find({ connectionId: myConns.map((c) => c.id) })).map((a) => ({ id: a.id, label: `${a.name} •••• ${a.mask}` })) : [];
  const reviewerIds = [...new Set(input.bills.flatMap((b) => [b.reviewedBy, b.secondReviewedBy]).filter((x): x is string => !!x))];
  const reviewers = reviewerIds.length ? await ctx.writer.profiles.find({ id: reviewerIds }) : [];
  const order = { critical: 0, important: 1, optional: 2 } as const;
  return {
    passport,
    property: loaded.properties.get(passport.propertyId) ?? null,
    scope: { id: org.id, name: org.name, type: org.type },
    role,
    canManage: ROLE_RANK[role] >= ROLE_RANK.member,
    canAdmin: role === "organization_admin",
    assessment: summary.assessments.find((a) => a.passportId === passportId)!,
    forecasts: { 30: forecast(input, 30), 60: forecast(input, 60), 90: forecast(input, 90) },
    obligations: [...input.obligations].sort((a, b) => order[a.priority] - order[b.priority] || OBLIGATION_KINDS.indexOf(a.kind) - OBLIGATION_KINDS.indexOf(b.kind)),
    vendors,
    bills: [...input.bills].sort((a, b) => b.dueOn.localeCompare(a.dueOn)),
    decisions,
    policies: policies.filter((p) => p.passportId === null || p.passportId === passportId),
    funding: input.funding,
    fundingAccounts: input.accounts.filter((a) => a.id === input.funding?.operatingAccountId || a.id === input.funding?.reserveAccountId),
    myAccounts,
    liveSteps: liveSteps(input.obligations, input.funding, policies.length),
    reviewerNames: Object.fromEntries(reviewers.map((p) => [p.id, p.fullName])),
  };
}

/** The Close → Live checklist, read back from what setup actually found. */
export function liveSteps(obligations: Obligation[], funding: FundingRule | null, ruleCount: number): LiveStep[] {
  const find = (kind: ObligationKind) => obligations.filter((o) => o.kind === kind);
  const describe = (obs: Obligation[], none: string) => {
    if (!obs.length) return { state: "needs_you" as const, detail: none };
    const o = obs[0]!;
    const amount = o.expectedAmount !== null ? formatAmount(o.expectedAmount, o.currency) : null;
    return { state: o.status === "suggested" ? ("needs_you" as const) : ("done" as const), detail: `${o.label}${amount ? `, ${amount}` : ""}${o.status === "suggested" ? " (please confirm)" : ""}` };
  };
  const mortgage = find("mortgage");
  const escrowed = obligations.filter((o) => (o.kind === "property_tax" || o.kind === "insurance") && o.escrowStatus !== "not_applicable");
  const utilities = obligations.filter((o) => ["electricity", "water", "gas", "internet"].includes(o.kind));
  return [
    { key: "passport", label: "Creating Property Passport", state: "done", detail: "Your ownership record and costs in one place." },
    { key: "mortgage", label: "Identifying mortgage", ...(mortgage.length ? describe(mortgage, "") : { state: "not_applicable" as const, detail: "No mortgage on this purchase." }) },
    {
      key: "escrow",
      label: "Checking mortgage escrow",
      ...(!mortgage.length
        ? { state: "not_applicable" as const, detail: "No mortgage, so taxes and insurance are paid directly." }
        : escrowed.some((o) => o.escrowStatus === "confirmed_escrowed" || o.escrowStatus === "confirmed_not_escrowed")
          ? { state: "done" as const, detail: escrowed.some((o) => o.escrowStatus === "confirmed_escrowed") ? "Taxes and insurance are paid from escrow." : "Taxes and insurance are paid directly." }
          : { state: "needs_you" as const, detail: escrowed.some((o) => o.escrowStatus === "possibly_escrowed") ? "Your loan terms suggest escrow; confirm with your servicer." : "Confirm with your servicer whether escrow pays taxes and insurance." }),
    },
    { key: "tax", label: "Locating property tax", ...describe(find("property_tax"), "Add your property tax bill or amount.") },
    { key: "insurance", label: "Detecting insurance", ...describe(find("insurance"), "No homeowners policy found. Add your policy so renewals are watched.") },
    { key: "hoa", label: "Identifying HOA", ...(find("hoa").length ? describe(find("hoa"), "") : { state: "not_applicable" as const, detail: "No HOA on the listing." }) },
    { key: "utilities", label: "Finding utilities", ...(utilities.length ? { state: utilities.every((u) => u.status === "active") ? ("done" as const) : ("needs_you" as const), detail: `${utilities.map((u) => u.label).join(", ")}${utilities.some((u) => u.status === "suggested") ? " (confirm providers and amounts)" : ""}` } : { state: "needs_you" as const, detail: "Add electricity and water." }) },
    { key: "account", label: "Connecting payment account", ...(funding?.operatingAccountId ? { state: "done" as const, detail: "Balances are checked before bills are due." } : { state: "needs_you" as const, detail: "Choose the account your bills are paid from." }) },
    { key: "funding", label: "Setting funding alerts", ...(funding?.operatingAccountId ? { state: "done" as const, detail: funding.minOperatingBalance ? `Warns before the balance drops below ${formatAmount(funding.minOperatingBalance)}.` : "Warns before bills exceed the balance." } : { state: "needs_you" as const, detail: "Starts once a paying account is chosen." }) },
    { key: "rules", label: "Configuring continuity rules", state: ruleCount ? "done" : "needs_you", detail: ruleCount ? `${ruleCount} review rules: routine bills stay quiet; large or unusual ones come to you.` : "No rules yet." },
  ];
}

// ----------------------------------------------------------------------------- Close → Live

const TAX_SCHEDULES: Record<string, { frequency: Obligation["frequency"]; next: (today: string) => string; note: string }> = {
  // Typical statutory deadlines; the owner confirms against the actual bill.
  TX: { frequency: "annual", next: (t) => nextOf(t, ["01-31"]), note: "Texas property tax is usually due January 31." },
  CA: { frequency: "semiannual", next: (t) => nextOf(t, ["12-10", "04-10"]), note: "California installments are usually due December 10 and April 10." },
  FL: { frequency: "annual", next: (t) => nextOf(t, ["03-31"]), note: "Florida property tax is usually due March 31 (discounts for paying from November)." },
};

function nextOf(t: string, monthDays: string[]): string {
  const year = Number(t.slice(0, 4));
  const candidates = [year, year + 1].flatMap((y) => monthDays.map((md) => `${y}-${md}`)).filter((d) => d > t).sort();
  return candidates[0]!;
}

async function vendorFor(ctx: ServiceContext, organizationId: string, name: string, category: Vendor["category"]): Promise<Vendor> {
  const existing = await ctx.writer.vendors.findOne({ organizationId, name });
  if (existing) return existing;
  const now = nowIso(ctx);
  return ctx.writer.vendors.insert({ id: newId(), organizationId, name: name.slice(0, 120), category, phone: null, website: null, createdAt: now, updatedAt: now });
}

async function ensureDefaultPolicies(ctx: ServiceContext, organizationId: string) {
  if (await ctx.writer.review_policies.count({ organizationId })) return;
  const now = nowIso(ctx);
  for (const p of defaultReviewPolicies()) {
    await ctx.writer.review_policies.insert({ id: newId(), organizationId, passportId: null, ...p, enabled: true, createdAt: now, updatedAt: now });
  }
}

/** The owners' personal portfolio (created on first use, all owners as admins). */
async function personalPortfolio(ctx: ServiceContext, ownerIds: string[], ownerNames: string[], jurisdiction: string): Promise<Organization> {
  const memberships = await ctx.writer.organization_members.find({ userId: ownerIds[0]!, role: "organization_admin" });
  if (memberships.length) {
    const orgs = await ctx.writer.organizations.find({ id: memberships.map((m) => m.organizationId), type: "personal_portfolio" });
    if (orgs[0]) return orgs[0];
  }
  const now = nowIso(ctx);
  const org = await ctx.writer.organizations.insert({
    id: newId(),
    name: `${ownerNames.join(" & ") || "My"} — properties`.slice(0, 120),
    slug: `personal-${ownerIds[0]!.slice(0, 8)}-${crypto.randomUUID().slice(0, 6)}`,
    type: "personal_portfolio",
    jurisdiction,
    createdAt: now,
    updatedAt: now,
  });
  for (const userId of ownerIds) await ctx.writer.organization_members.insert({ id: newId(), organizationId: org.id, userId, role: "organization_admin", createdAt: now, updatedAt: now });
  return org;
}

type NewObligation = Omit<Obligation, "id" | "organizationId" | "passportId" | "createdAt" | "updatedAt" | "createdBy" | "endedOn" | "referenceLast4" | "payeeMatch" | "graceDays" | "vendorId" | "fundingAccountId"> &
  Partial<Pick<Obligation, "graceDays" | "vendorId" | "fundingAccountId" | "payeeMatch">>;

/**
 * Close → Live. Builds the Property Passport from what the closing already
 * knows: the mortgage and its terms, the listing's tax and HOA amounts, the
 * insurance documents, the buyer's verified bank accounts. Anything inferred
 * is a suggestion the owner confirms. Idempotent: returns the existing
 * passport when it's already set up.
 */
export async function prepareFromOwnershipRecord(ctx: ServiceContext, ownershipRecordId: string): Promise<PropertyPassport | null> {
  const existing = await ctx.writer.property_passports.findOne({ ownershipRecordId });
  if (existing) return existing;
  const record = await ctx.writer.ownership_records.get(ownershipRecordId);
  if (!record) throw notFound("That home record");
  if (isUser(ctx.actor) && !record.ownerUserIds.includes(ctx.actor.userId)) throw notFound("That home record");
  if (!record.ownerUserIds.length) return null; // no owner with an account yet
  const [property, tx, mortgage, docs] = await Promise.all([
    ctx.writer.properties.get(record.propertyId),
    ctx.writer.transactions.get(record.transactionId),
    ctx.writer.mortgages.findOne({ transactionId: record.transactionId }),
    ctx.writer.documents.find({ transactionId: record.transactionId, category: "insurance" }),
  ]);
  if (!property || !tx) throw notFound("That property");

  const org = await personalPortfolio(ctx, record.ownerUserIds, record.ownerNames, tx.jurisdiction);
  await ensureDefaultPolicies(ctx, org.id);
  const now = nowIso(ctx);
  const t = today(ctx);
  const passport = await ctx.writer.property_passports.insert({
    id: newId(),
    organizationId: org.id,
    propertyId: property.id,
    ownershipRecordId: record.id,
    origin: "sagolik_closing",
    label: property.addressLine1,
    status: "live",
    monitoring: "monitor",
    acquiredOn: record.purchaseDate,
    activatedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const cur = property.currency;
  const add = async (o: NewObligation) =>
    ctx.writer.obligations.insert({
      id: newId(),
      organizationId: org.id,
      passportId: passport.id,
      vendorId: o.vendorId ?? null,
      graceDays: o.graceDays ?? 0,
      fundingAccountId: o.fundingAccountId ?? null,
      payeeMatch: o.payeeMatch ?? null,
      referenceLast4: null,
      endedOn: null,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
      ...o,
    });

  // Mortgage: lender known from the closing; payment estimated from the loan terms.
  const financed = !!mortgage && mortgage.loanAmount > 0;
  if (financed) {
    const lender = await vendorFor(ctx, org.id, mortgage.lenderName, "lender");
    const estimate = mortgage.interestRateBps !== null && mortgage.termMonths ? estimateMonthlyPayment(mortgage.loanAmount, mortgage.interestRateBps, mortgage.termMonths) : null;
    await add({ kind: "mortgage", label: `Mortgage — ${mortgage.lenderName}`, priority: "critical", amountType: "fixed", expectedAmount: estimate, expectedMin: null, expectedMax: null, currency: cur, frequency: "monthly", nextDueOn: firstMortgagePaymentDate(record.purchaseDate), graceDays: 15, payMethod: "unknown", escrowStatus: "not_applicable", source: "closing", confidence: estimate ? 60 : 40, status: "suggested", vendorId: lender.id });
  }
  // Lenders usually require escrow above 80% loan-to-value; below that it's the borrower's choice.
  const escrowStatus: Obligation["escrowStatus"] = !financed ? "confirmed_not_escrowed" : (mortgage!.ltvBps ?? 0) > 8000 ? "possibly_escrowed" : "unknown";
  const directPay: Obligation["payMethod"] = financed ? "unknown" : "manual";

  if (property.propertyTaxAnnual) {
    const schedule = property.region ? TAX_SCHEDULES[property.region] : undefined;
    const perInstallment = schedule?.frequency === "semiannual" ? Math.round(property.propertyTaxAnnual / 2) : property.propertyTaxAnnual;
    await add({ kind: "property_tax", label: "Property tax", priority: "critical", amountType: "periodic", expectedAmount: perInstallment, expectedMin: null, expectedMax: null, currency: cur, frequency: schedule?.frequency ?? "annual", nextDueOn: schedule?.next(t) ?? null, payMethod: directPay, escrowStatus, source: "closing", confidence: schedule ? 50 : 35, status: "suggested" });
  }
  if (docs.length || financed) {
    await add({ kind: "insurance", label: "Homeowners insurance", priority: "critical", amountType: "event", expectedAmount: null, expectedMin: null, expectedMax: null, currency: cur, frequency: "annual", nextDueOn: addDays(record.purchaseDate, 365), payMethod: directPay, escrowStatus, source: docs.length ? "document" : "closing", confidence: docs.length ? 55 : 30, status: "suggested" });
  }
  if (property.hoaMonthly) {
    await add({ kind: "hoa", label: "HOA dues", priority: "critical", amountType: "fixed", expectedAmount: property.hoaMonthly, expectedMin: null, expectedMax: null, currency: cur, frequency: "monthly", nextDueOn: addMonths(`${t.slice(0, 7)}-01`, 1), payMethod: "unknown", escrowStatus: "not_applicable", source: "closing", confidence: 60, status: "suggested" });
  }
  for (const [kind, label] of [["electricity", "Electricity"], ["water", "Water"]] as const) {
    await add({ kind, label, priority: "critical", amountType: "variable", expectedAmount: null, expectedMin: null, expectedMax: null, currency: cur, frequency: "monthly", nextDueOn: null, payMethod: "unknown", escrowStatus: "not_applicable", source: "closing", confidence: 20, status: "suggested" });
  }

  // Paying account: the buyer's own account whose ownership Plaid (or the sandbox) confirmed.
  const conns = await ctx.writer.bank_connections.find({ userId: record.ownerUserIds, status: "connected" });
  const accounts = conns.length ? await ctx.writer.bank_accounts.find({ connectionId: conns.map((c) => c.id) }) : [];
  const operating = accounts.filter((a) => a.ownershipVerified).sort((a, b) => Number(/check/i.test(b.name)) - Number(/check/i.test(a.name)))[0] ?? null;
  await ctx.writer.funding_rules.insert({ id: newId(), organizationId: org.id, passportId: passport.id, operatingAccountId: operating?.id ?? null, reserveAccountId: null, minOperatingBalance: 0, targetOperatingBalance: 0, createdAt: now, updatedAt: now });

  await audit(ctx, { action: "autopilot.prepared", resourceType: "property_passport", resourceId: passport.id, transactionId: record.transactionId, organizationId: org.id, metadata: { financed, operatingAccount: !!operating } });
  await notify(ctx, {
    userIds: record.ownerUserIds,
    transactionId: null,
    kind: "autopilot_live",
    title: `${property.addressLine1} is live on Property Autopilot`,
    body: "Sagolik now watches this property's costs and tells you what needs attention. It never pays or moves money for you. A few details need your confirmation.",
    linkPath: `/app/autopilot/${passport.id}/live`,
  });
  await recordDecisions(ctx, [org.id]);
  return passport;
}

/** The owner starts Autopilot for a property they closed on (same as the automatic path). */
export async function setUpFromHomeRecord(ctx: ServiceContext, ownershipRecordId: string): Promise<PropertyPassport> {
  const actor = requireUser(ctx);
  const record = await ctx.writer.ownership_records.get(ownershipRecordId);
  if (!record || !record.ownerUserIds.includes(actor.userId)) throw notFound("That home record");
  const passport = await prepareFromOwnershipRecord(ctx, ownershipRecordId);
  if (!passport) throw conflict("This property has no owner with an account yet.");
  return passport;
}

// ----------------------------------------------------------------------------- import a property

const ImportPropertyInput = z.object({
  organizationId: z.string().uuid().optional(),
  label: z.string().trim().min(2).max(120),
  addressLine1: z.string().trim().min(3).max(200),
  city: z.string().trim().min(2).max(120),
  region: z.string().trim().regex(/^[A-Z]{2}$/, "Use the two-letter state code"),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Use a US ZIP code"),
  propertyType: z.enum(["single_family", "condo", "townhouse", "multi_family", "land", "other"]),
  acquiredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** A property the owner didn't buy through Sagolik. It is marked as imported, not verified by us. */
export async function importProperty(ctx: ServiceContext, raw: unknown): Promise<PropertyPassport> {
  const actor = requireUser(ctx);
  const input = ImportPropertyInput.parse(raw);
  let org: Organization;
  if (input.organizationId) {
    await requireScope(ctx, input.organizationId, "admin");
    org = (await ctx.writer.organizations.get(input.organizationId))!;
  } else {
    org = await personalPortfolio(ctx, [actor.userId], [actor.displayName], "US");
  }
  await ensureDefaultPolicies(ctx, org.id);
  const now = nowIso(ctx);
  const property = await ctx.writer.properties.insert({
    id: newId(),
    organizationId: org.id,
    addressLine1: input.addressLine1,
    addressLine2: null,
    city: input.city,
    region: input.region,
    postalCode: input.postalCode,
    country: "US",
    latitude: null,
    longitude: null,
    parcelId: null,
    propertyType: input.propertyType,
    yearBuilt: null,
    livingArea: null,
    areaUnit: "sqft",
    bedrooms: null,
    bathrooms: null,
    lotSize: null,
    imageUrls: [],
    propertyTaxAnnual: null,
    hoaMonthly: null,
    energyRating: null,
    legalDescription: null,
    currency: "USD",
    createdAt: now,
    updatedAt: now,
  });
  const passport = await ctx.writer.property_passports.insert({ id: newId(), organizationId: org.id, propertyId: property.id, ownershipRecordId: null, origin: "imported", label: input.label, status: "live", monitoring: "monitor", acquiredOn: input.acquiredOn ?? null, activatedAt: now, createdAt: now, updatedAt: now });
  await ctx.writer.funding_rules.insert({ id: newId(), organizationId: org.id, passportId: passport.id, operatingAccountId: null, reserveAccountId: null, minOperatingBalance: 0, targetOperatingBalance: 0, createdAt: now, updatedAt: now });
  await audit(ctx, { action: "autopilot.property_imported", resourceType: "property_passport", resourceId: passport.id, organizationId: org.id });
  await recordDecisions(ctx, [org.id]);
  return passport;
}

// ----------------------------------------------------------------------------- costs (obligations)

const money = z.number().int().nonnegative().max(100_000_000_00);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ObligationFields = z.object({
  kind: z.enum(OBLIGATION_KINDS),
  label: z.string().trim().min(2).max(120),
  priority: z.enum(OBLIGATION_PRIORITIES),
  amountType: z.enum(AMOUNT_TYPES),
  expectedAmount: money.nullable(),
  expectedMin: money.nullable(),
  expectedMax: money.nullable(),
  frequency: z.enum(OBLIGATION_FREQUENCIES),
  nextDueOn: dateOnly.nullable(),
  graceDays: z.number().int().min(0).max(90),
  payMethod: z.enum(PAY_METHODS),
  escrowStatus: z.enum(ESCROW_STATUSES_AUTOPILOT),
  fundingAccountId: z.string().uuid().nullable(),
  referenceLast4: z.string().regex(/^[0-9A-Za-z]{2,4}$/).nullable(),
  payeeMatch: z.string().trim().min(2).max(80).nullable(),
  vendorName: z.string().trim().min(2).max(120).nullable(),
  vendorCategory: z.enum(VENDOR_CATEGORIES).nullable(),
});
const refineRange = <T extends { expectedMin: number | null; expectedMax: number | null }>(s: z.ZodType<T>) =>
  s.refine((v) => v.expectedMin === null || v.expectedMax === null || v.expectedMin <= v.expectedMax, { message: "The low end must not be above the high end.", path: ["expectedMin"] });

const DEFAULT_VENDOR_CATEGORY: Record<ObligationKind, Vendor["category"]> = {
  mortgage: "lender",
  property_tax: "tax_authority",
  insurance: "insurer",
  hoa: "hoa",
  electricity: "utility",
  water: "utility",
  gas: "utility",
  internet: "telecom",
  security: "security",
  property_management: "property_manager",
  maintenance: "maintenance",
  other: "other",
};

async function assertAccountUsable(ctx: ServiceContext, accountId: string | null) {
  if (!accountId) return;
  const actor = requireUser(ctx);
  const account = await ctx.writer.bank_accounts.get(accountId);
  // Only the account's owner can point a property at it.
  if (!account || account.userId !== actor.userId) throw badRequest("Choose one of your own connected accounts.");
}

export async function addObligation(ctx: ServiceContext, passportId: string, raw: unknown): Promise<Obligation> {
  const actor = requireUser(ctx);
  const { passport } = await passportInScope(ctx, passportId, "manage");
  const input = refineRange(ObligationFields).parse(raw);
  await assertAccountUsable(ctx, input.fundingAccountId);
  const property = await ctx.writer.properties.get(passport.propertyId);
  const vendor = input.vendorName ? await vendorFor(ctx, passport.organizationId, input.vendorName, input.vendorCategory ?? DEFAULT_VENDOR_CATEGORY[input.kind]) : null;
  const now = nowIso(ctx);
  const { vendorName: _n, vendorCategory: _c, ...fields } = input;
  const ob = await ctx.writer.obligations.insert({
    id: newId(),
    organizationId: passport.organizationId,
    passportId,
    vendorId: vendor?.id ?? null,
    ...fields,
    currency: property?.currency ?? "USD",
    source: "manual",
    confidence: 100,
    status: "active",
    endedOn: null,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  });
  await audit(ctx, { action: "autopilot.obligation_added", resourceType: "obligation", resourceId: ob.id, organizationId: passport.organizationId, metadata: { kind: ob.kind } });
  await recordDecisions(ctx, [passport.organizationId]);
  return ob;
}

const UpdateObligationInput = ObligationFields.partial().extend({ status: z.enum(["active", "paused", "ended"]).optional() });

/** Edit a cost; confirming a suggestion is `status: "active"`. */
export async function updateObligation(ctx: ServiceContext, obligationId: string, raw: unknown): Promise<Obligation> {
  const existing = await ctx.writer.obligations.get(obligationId);
  if (!existing) throw notFound("That cost");
  await requireScope(ctx, existing.organizationId, "manage");
  const input = UpdateObligationInput.parse(raw);
  const merged = { ...existing, ...input };
  if (merged.expectedMin !== null && merged.expectedMax !== null && merged.expectedMin > merged.expectedMax) throw badRequest("The low end must not be above the high end.");
  if (input.fundingAccountId !== undefined && input.fundingAccountId !== existing.fundingAccountId) await assertAccountUsable(ctx, input.fundingAccountId);
  let vendorId = existing.vendorId;
  if (input.vendorName) vendorId = (await vendorFor(ctx, existing.organizationId, input.vendorName, input.vendorCategory ?? DEFAULT_VENDOR_CATEGORY[merged.kind])).id;
  const { vendorName: _n, vendorCategory: _c, ...fields } = input;
  const patch: Partial<Obligation> = { ...fields, vendorId };
  if (input.status === "active" && existing.status === "suggested") patch.confidence = 100; // a person confirmed it
  if (input.status === "ended") patch.endedOn = today(ctx);
  const updated = await ctx.writer.obligations.update(obligationId, patch);
  await audit(ctx, {
    action: "autopilot.obligation_updated",
    resourceType: "obligation",
    resourceId: obligationId,
    organizationId: existing.organizationId,
    metadata: { fields: Object.keys(fields), confirmed: existing.status === "suggested" && input.status === "active" },
  });
  await recordDecisions(ctx, [existing.organizationId]);
  return updated;
}

// ----------------------------------------------------------------------------- bills

const AddBillInput = z.object({
  obligationId: z.string().uuid(),
  amount: money,
  dueOn: dateOnly,
  periodLabel: z.string().trim().max(60).nullable().optional(),
});

export async function addBill(ctx: ServiceContext, passportId: string, raw: unknown, file?: { bytes: Uint8Array; filename: string }): Promise<Bill> {
  const actor = requireUser(ctx);
  const { passport } = await passportInScope(ctx, passportId, "manage");
  const input = AddBillInput.parse(raw);
  const ob = await ctx.writer.obligations.get(input.obligationId);
  if (!ob || ob.passportId !== passportId) throw notFound("That cost");
  const id = newId();
  let fileKey: string | null = null;
  let fileName: string | null = null;
  if (file && file.bytes.length) {
    const check = checkUpload(file.bytes, file.filename);
    if (!check.ok) throw badRequest(check.reason === "too_large" ? "That file is too large." : check.reason === "active_content" ? "That PDF contains scripts or embedded files, which aren't allowed." : "Upload a PDF, PNG or JPEG.");
    fileKey = `autopilot/${passport.organizationId}/${id}/${check.safeName}`;
    fileName = check.safeName;
    await ctx.storage.put(fileKey, file.bytes, check.mime);
  }
  const now = nowIso(ctx);
  const bill = await ctx.writer.bills.insert({
    id,
    organizationId: passport.organizationId,
    passportId,
    obligationId: ob.id,
    amount: input.amount,
    currency: ob.currency,
    dueOn: input.dueOn,
    periodLabel: input.periodLabel ?? null,
    // A bill for a cost paid from escrow is recorded as covered, never as payable.
    status: isEscrowCovered(ob) ? "covered_by_escrow" : "received",
    source: fileKey ? "document" : "manual",
    fileKey,
    fileName,
    paidOn: null,
    paymentReference: null,
    verifiedAt: null,
    reviewedBy: null,
    reviewedAt: null,
    secondReviewedBy: null,
    secondReviewedAt: null,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  });
  if (ob.status === "suggested") await ctx.writer.obligations.update(ob.id, { status: "active", confidence: 100 }); // a real bill confirms the cost exists
  await audit(ctx, { action: "autopilot.bill_added", resourceType: "bill", resourceId: bill.id, organizationId: passport.organizationId, metadata: { obligation: ob.kind, amount: bill.amount, withFile: !!fileKey } });
  await recordDecisions(ctx, [passport.organizationId]);
  return bill;
}

async function billInScope(ctx: ServiceContext, billId: string, level: Level) {
  const bill = await ctx.writer.bills.get(billId);
  if (!bill) throw notFound("That bill");
  const role = await requireScope(ctx, bill.organizationId, level, "That bill");
  return { bill, role };
}

const MarkPaidInput = z.object({ paidOn: dateOnly, reference: z.string().trim().max(120).optional() });

/** The owner says it's paid. Sagolik records that as reported, not verified. */
export async function markBillPaid(ctx: ServiceContext, billId: string, raw: unknown): Promise<Bill> {
  const { bill } = await billInScope(ctx, billId, "manage");
  const input = MarkPaidInput.parse(raw);
  if (bill.status !== "received" && bill.status !== "disputed") throw conflict("This bill isn't waiting for payment.");
  if (input.paidOn > today(ctx)) throw badRequest("The payment date can't be in the future.");
  const updated = await ctx.writer.bills.update(billId, { status: "paid_reported", paidOn: input.paidOn, paymentReference: input.reference || null });
  await audit(ctx, { action: "autopilot.bill_paid_reported", resourceType: "bill", resourceId: billId, organizationId: bill.organizationId });
  await recordDecisions(ctx, [bill.organizationId]);
  return updated;
}

/**
 * A person checked a flagged bill and found it in order. For a two-person
 * rule, the second review must come from someone else.
 */
export async function reviewBill(ctx: ServiceContext, billId: string): Promise<Bill> {
  const actor = requireUser(ctx);
  const { bill } = await billInScope(ctx, billId, "manage");
  if (bill.status !== "received") throw conflict("Only unpaid bills can be reviewed.");
  const now = nowIso(ctx);
  let patch: Partial<Bill>;
  if (!bill.reviewedBy) patch = { reviewedBy: actor.userId, reviewedAt: now };
  else if (bill.reviewedBy === actor.userId) throw conflict("You've already reviewed this bill. A second review must come from someone else.");
  else if (!bill.secondReviewedBy) patch = { secondReviewedBy: actor.userId, secondReviewedAt: now };
  else throw conflict("This bill has already been reviewed by two people.");
  const updated = await ctx.writer.bills.update(billId, patch);
  await audit(ctx, { action: "autopilot.bill_reviewed", resourceType: "bill", resourceId: billId, organizationId: bill.organizationId, metadata: { second: !!patch.secondReviewedBy } });
  await recordDecisions(ctx, [bill.organizationId]);
  return updated;
}

const BillStatusInput = z.object({ status: z.enum(["disputed", "cancelled", "covered_by_escrow", "received"]) });

export async function setBillStatus(ctx: ServiceContext, billId: string, raw: unknown): Promise<Bill> {
  const { bill } = await billInScope(ctx, billId, "manage");
  const { status } = BillStatusInput.parse(raw);
  if (bill.status === "paid_verified") throw conflict("A verified payment can't be changed.");
  if (status === "received" && bill.status !== "disputed") throw conflict("Only a disputed bill can be reopened.");
  const updated = await ctx.writer.bills.update(billId, { status });
  await audit(ctx, { action: "autopilot.bill_status_changed", resourceType: "bill", resourceId: billId, organizationId: bill.organizationId, metadata: { from: bill.status, to: status } });
  await recordDecisions(ctx, [bill.organizationId]);
  return updated;
}

/** Streams an uploaded bill to a member of the owning portfolio. */
export async function billFile(ctx: ServiceContext, billId: string): Promise<{ bytes: Uint8Array; name: string }> {
  const { bill } = await billInScope(ctx, billId, "view");
  if (!bill.fileKey) throw notFound("That file");
  const bytes = await ctx.storage.get(bill.fileKey);
  if (!bytes) throw notFound("That file");
  await audit(ctx, { action: "autopilot.bill_file_viewed", resourceType: "bill", resourceId: billId, organizationId: bill.organizationId });
  return { bytes, name: bill.fileName ?? "bill" };
}

// ----------------------------------------------------------------------------- funding & rules (owners only)

const FundingInput = z.object({
  operatingAccountId: z.string().uuid().nullable(),
  reserveAccountId: z.string().uuid().nullable(),
  minOperatingBalance: money,
  targetOperatingBalance: money,
});

export async function updateFunding(ctx: ServiceContext, passportId: string, raw: unknown): Promise<FundingRule> {
  const { passport } = await passportInScope(ctx, passportId, "admin");
  const input = FundingInput.parse(raw);
  if (input.operatingAccountId && input.operatingAccountId === input.reserveAccountId) throw badRequest("The reserve must be a different account.");
  if (input.targetOperatingBalance && input.targetOperatingBalance < input.minOperatingBalance) throw badRequest("The target balance should be at least the minimum.");
  const existing = await ctx.writer.funding_rules.findOne({ passportId });
  for (const id of [input.operatingAccountId, input.reserveAccountId]) {
    if (id && id !== existing?.operatingAccountId && id !== existing?.reserveAccountId) await assertAccountUsable(ctx, id);
  }
  const now = nowIso(ctx);
  const rule = existing
    ? await ctx.writer.funding_rules.update(existing.id, input)
    : await ctx.writer.funding_rules.insert({ id: newId(), organizationId: passport.organizationId, passportId, ...input, createdAt: now, updatedAt: now });
  await audit(ctx, { action: "autopilot.funding_updated", resourceType: "funding_rule", resourceId: rule.id, organizationId: passport.organizationId });
  await recordDecisions(ctx, [passport.organizationId]);
  return rule;
}

const PolicyInput = z.object({
  name: z.string().trim().min(3).max(120),
  obligationKind: z.enum(OBLIGATION_KINDS).nullable(),
  minAmount: money,
  maxAmount: money.nullable(),
  action: z.enum(REVIEW_ACTIONS),
  enabled: z.boolean(),
});

export async function savePolicy(ctx: ServiceContext, organizationId: string, policyId: string | null, raw: unknown): Promise<ReviewPolicy> {
  await requireScope(ctx, organizationId, "admin");
  const input = PolicyInput.parse(raw);
  if (input.maxAmount !== null && input.maxAmount < input.minAmount) throw badRequest("The upper limit must be above the lower limit.");
  const now = nowIso(ctx);
  let policy: ReviewPolicy;
  if (policyId) {
    const existing = await ctx.writer.review_policies.get(policyId);
    if (!existing || existing.organizationId !== organizationId) throw notFound("That rule");
    policy = await ctx.writer.review_policies.update(policyId, input);
  } else {
    const position = (await ctx.writer.review_policies.count({ organizationId })) + 1;
    policy = await ctx.writer.review_policies.insert({ id: newId(), organizationId, passportId: null, ...input, position, createdAt: now, updatedAt: now });
  }
  await audit(ctx, { action: "autopilot.policy_updated", resourceType: "review_policy", resourceId: policy.id, organizationId, metadata: { action: policy.action, enabled: policy.enabled } });
  await recordDecisions(ctx, [organizationId]);
  return policy;
}

export async function setMonitoring(ctx: ServiceContext, passportId: string, monitoring: "off" | "monitor"): Promise<PropertyPassport> {
  const { passport } = await passportInScope(ctx, passportId, "admin");
  const updated = await ctx.writer.property_passports.update(passportId, { monitoring });
  await audit(ctx, { action: "autopilot.monitoring_changed", resourceType: "property_passport", resourceId: passportId, organizationId: passport.organizationId, metadata: { monitoring } });
  if (monitoring === "monitor") await recordDecisions(ctx, [passport.organizationId]);
  return updated;
}

// ----------------------------------------------------------------------------- wording shared with the UI

export const PAY_METHOD_LABELS: Record<Obligation["payMethod"], string> = {
  autopay: "Autopay",
  bank_bill_pay: "Bank bill pay",
  escrow: "Mortgage escrow",
  manual: "Paid by you",
  unknown: "Not set",
};

export const ESCROW_LABELS: Record<Obligation["escrowStatus"], string> = {
  confirmed_escrowed: "Paid from escrow",
  confirmed_not_escrowed: "Not in escrow",
  possibly_escrowed: "Possibly in escrow — verify",
  unknown: "Escrow unknown — verify",
  not_applicable: "—",
};

export const BILL_STATUS_LABELS: Record<Bill["status"], string> = {
  received: "To be paid",
  paid_reported: "Marked as paid",
  paid_verified: "Paid (verified)",
  covered_by_escrow: "Covered through escrow",
  disputed: "Disputed",
  cancelled: "Cancelled",
};

export function kindLabel(kind: ObligationKind): string {
  return OBLIGATION_KIND_LABELS[kind];
}

export function moneyText(minor: number | null, currency: Currency = "USD"): string {
  return minor === null ? "—" : formatAmount(minor, currency);
}

