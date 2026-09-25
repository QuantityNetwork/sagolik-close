/**
 * View models. The UI renders these; they translate infrastructure state
 * into human language ("Your transfer has been received and is being
 * finalized", not PAYMENT_SETTLEMENT_PENDING).
 */
import { type Actor, can, isPrincipal, permissionsFor } from "@sagolik/auth";
import type {
  BankAccount,
  BankConnectionStatus,
  IdentityStatus,
  ParticipantRole,
  PaymentStatus,
  Task,
  TransactionParticipant,
  TransactionState,
} from "@sagolik/types";
import {
  buildTimeline,
  capabilityEnabled,
  closingBlockers,
  currentPhase,
  documentSummary,
  isTaskActionable,
  latestInstruction,
  nextActionFor,
  progressPercent,
  recordingReadiness,
  sortTasks,
  type TransactionSnapshot,
  dealSubject,
  JURISDICTIONS,
} from "@sagolik/workflow";
import { type ServiceContext, requireUser } from "../context";
import { accessContext } from "../snapshot";
import { today } from "../util";
import { visibleDocuments } from "./documents";
import { listTransactionsForActor } from "./transactions";

export const STATE_LABELS: Record<TransactionState, { label: string; tone: "neutral" | "progress" | "attention" | "done" | "stopped" }> = {
  draft: { label: "Getting started", tone: "neutral" },
  invited: { label: "Parties invited", tone: "progress" },
  identity_pending: { label: "Verifying identities", tone: "progress" },
  documents_pending: { label: "Collecting documents", tone: "progress" },
  financing_pending: { label: "Financing", tone: "progress" },
  conditions_pending: { label: "Clearing conditions", tone: "progress" },
  ready_for_signing: { label: "Ready for signing", tone: "progress" },
  signing: { label: "Signing", tone: "progress" },
  escrow_pending: { label: "Funding escrow", tone: "progress" },
  funding_pending: { label: "Lender funding", tone: "progress" },
  recording_pending: { label: "Recording the deed", tone: "progress" },
  ownership_transfer: { label: "Ownership transferred", tone: "done" },
  closed: { label: "Closed", tone: "done" },
  cancelled: { label: "Cancelled", tone: "stopped" },
  disputed: { label: "Paused — disputed", tone: "attention" },
};

export const ROLE_LABELS: Record<ParticipantRole, string> = {
  buyer: "Buyer",
  co_buyer: "Co-buyer",
  seller: "Seller",
  co_seller: "Co-seller",
  agent: "Agent",
  buyer_agent: "Buyer's agent",
  seller_agent: "Seller's agent",
  broker: "Broker",
  loan_officer: "Loan officer",
  mortgage_processor: "Mortgage processor",
  title_officer: "Title officer",
  escrow_officer: "Escrow officer",
  attorney: "Attorney",
  notary: "Notary",
  insurance_agent: "Insurance agent",
  transaction_coordinator: "Transaction coordinator",
  auditor: "Auditor",
  accountant: "Accountant",
};

const BUSINESS_ROLE_LABELS: Partial<Record<ParticipantRole, string>> = {
  broker: "M&A advisor",
  attorney: "Counsel",
  loan_officer: "Lender",
  escrow_officer: "Escrow agent",
  transaction_coordinator: "Deal coordinator",
};

/** Role name as people in this kind of deal say it. */
export function roleLabel(role: ParticipantRole, jurisdiction?: string): string {
  const business = jurisdiction ? JURISDICTIONS[jurisdiction]?.vertical === "business" : false;
  return (business ? BUSINESS_ROLE_LABELS[role] : undefined) ?? ROLE_LABELS[role];
}

export const PAYMENT_STATUS_TEXT: Record<PaymentStatus, string> = {
  created: "Being prepared.",
  authorization_required: "Waiting for a second approval from escrow before it's sent.",
  authorized: "Approved and about to be sent.",
  initiated: "Your transfer has been sent and is on its way.",
  processing: "Your bank is processing the transfer.",
  received: "Your transfer has been received and is being finalized.",
  settled: "Complete — the funds are in escrow.",
  failed: "The transfer didn't go through. No money has moved.",
  returned: "The transfer was returned. Please contact your escrow officer.",
  cancelled: "Cancelled.",
};

export const IDENTITY_STATUS_TEXT: Record<IdentityStatus, string> = {
  not_started: "Not started yet.",
  pending: "Waiting for you to finish the identity check.",
  processing: "We're verifying your identity. Usually this takes less than a few minutes.",
  verified: "Verified.",
  failed: "We couldn't verify this identity. You can try again.",
  review_required: "A specialist is reviewing this verification.",
  expired: "This verification expired. Please verify again.",
};

/** What the buyer still has to send for closing: what escrow still expects, or the estimate before escrow opens. */
export function fundsStillNeeded(s: TransactionSnapshot, nowIso: string): number {
  if (s.escrow) return Math.max(0, s.escrow.requiredAmount - s.escrow.receivedAmount);
  return moneyView(s, [], nowIso).remainingAtClosing;
}

export const BANK_STATUS_TEXT: Record<BankConnectionStatus, string> = {
  not_connected: "Not connected.",
  connecting: "Waiting for your bank to confirm.",
  consent_required: "Your bank needs your permission to continue.",
  connected: "Connected.",
  reauthentication_required: "Your bank needs you to reconnect before we can refresh the account.",
  expired: "Your bank permission expired. Reconnect to continue.",
  revoked: "Disconnected.",
  error: "Something went wrong connecting to your bank. Please try again.",
};

export interface PersonView {
  participant: TransactionParticipant;
  roleLabel: string;
  identity: IdentityStatus | null;
  isMe: boolean;
}

export interface MoneyView {
  currency: string;
  purchasePrice: number;
  loanAmount: number | null;
  depositSettled: number;
  remainingAtClosing: number;
  escrow: TransactionSnapshot["escrow"];
  instruction: { beneficiaryName: string; bankName: string; accountMask: string; version: number; status: string; verified: boolean; coolingOffUntil: string | null } | null;
  payments: Array<TransactionSnapshot["payments"][number] & { statusText: string }>;
  canSendDeposit: boolean;
  canSendClosingFunds: boolean;
  myAccounts: BankAccount[];
}

export function moneyView(s: TransactionSnapshot, myAccounts: BankAccount[], nowIso: string): MoneyView {
  const depositSettled = s.payments.filter((p) => (p.type === "earnest_money" || p.type === "deposit") && p.status === "settled").reduce((a, p) => a + p.amount, 0);
  const loan = s.mortgage?.loanAmount ?? null;
  const ins = latestInstruction(s, "closing_funds_to_escrow") ?? null;
  return {
    currency: s.transaction.currency,
    purchasePrice: s.transaction.salePrice,
    loanAmount: loan,
    depositSettled,
    remainingAtClosing: Math.max(0, s.transaction.salePrice - (loan ?? 0) - depositSettled),
    escrow: s.escrow,
    instruction: ins
      ? {
          beneficiaryName: ins.beneficiaryName,
          bankName: ins.bankName,
          accountMask: ins.accountMask,
          version: ins.version,
          status: ins.status,
          verified: ins.status === "verified" || ins.status === "locked",
          coolingOffUntil: ins.effectiveAfter && ins.effectiveAfter > nowIso ? ins.effectiveAfter : null,
        }
      : null,
    payments: s.payments.map((p) => ({ ...p, statusText: PAYMENT_STATUS_TEXT[p.status] })),
    canSendDeposit: capabilityEnabled(s, "escrow_deposit"),
    canSendClosingFunds: capabilityEnabled(s, "closing_funds"),
    myAccounts,
  };
}

export interface TransactionView {
  snapshot: TransactionSnapshot;
  stateLabel: (typeof STATE_LABELS)[TransactionState];
  timeline: ReturnType<typeof buildTimeline>;
  progress: number;
  phase: ReturnType<typeof currentPhase>;
  nextAction: Task | null;
  myTasks: Task[];
  openTasks: Task[];
  blockers: ReturnType<typeof closingBlockers>;
  recording: ReturnType<typeof recordingReadiness>;
  documents: ReturnType<typeof documentSummary>;
  people: PersonView[];
  myRoles: ParticipantRole[];
  permissions: string[];
  coordinator: TransactionParticipant | null;
  isPrincipal: boolean;
}

export function transactionView(ctx: ServiceContext, s: TransactionSnapshot): TransactionView {
  const actor = requireUser(ctx);
  const timeline = buildTimeline(s, today(ctx));
  const mine = new Set(s.participants.filter((p) => p.userId === actor.userId && p.status !== "removed").map((p) => p.id));
  const visibleDocs = visibleDocuments(ctx, s);
  const docsSnapshot = { ...s, documents: visibleDocs };
  const perms = permissionsFor(actor, accessContext(s));
  const myRoles = s.participants.filter((p) => mine.has(p.id)).map((p) => p.role);
  return {
    snapshot: s,
    stateLabel: STATE_LABELS[s.transaction.state],
    timeline,
    progress: progressPercent(timeline),
    phase: currentPhase(timeline),
    nextAction: nextActionFor(s, actor.userId),
    myTasks: sortTasks(s.tasks.filter((t) => t.assigneeParticipantId && mine.has(t.assigneeParticipantId) && isTaskActionable(t, s))),
    openTasks: sortTasks(s.tasks.filter((t) => t.status !== "complete" && t.status !== "waived")),
    blockers: closingBlockers(s),
    recording: recordingReadiness(s),
    documents: documentSummary(docsSnapshot),
    people: s.participants
      .filter((p) => p.status !== "removed")
      .map((p) => ({
        participant: p,
        roleLabel: roleLabel(p.role, s.transaction.jurisdiction),
        identity: isPrincipal(p.role) ? (s.identityVerifications.filter((v) => v.participantId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.status ?? "not_started") : null,
        isMe: mine.has(p.id),
      })),
    myRoles,
    permissions: [...perms],
    coordinator: s.participants.find((p) => p.role === "transaction_coordinator" && p.status !== "removed") ?? s.participants.find((p) => p.userId === s.transaction.coordinatorId) ?? null,
    isPrincipal: myRoles.some(isPrincipal),
  };
}

// ----------------------------------------------------------------------------- professional portfolio & command center

export type PortfolioFilter = "all" | "closing_this_week" | "blocked" | "awaiting_buyer" | "awaiting_lender" | "awaiting_title" | "awaiting_escrow";

const AWAITING: Record<Exclude<PortfolioFilter, "all" | "closing_this_week" | "blocked">, ParticipantRole[]> = {
  awaiting_buyer: ["buyer", "co_buyer", "buyer_agent"],
  awaiting_lender: ["loan_officer", "mortgage_processor"],
  awaiting_title: ["title_officer"],
  awaiting_escrow: ["escrow_officer"],
};

export interface PortfolioRow {
  id: string;
  reference: string;
  property: string;
  city: string;
  buyer: string;
  seller: string;
  closingDate: string | null;
  stage: string;
  stateTone: string;
  progress: number;
  attention: string[];
  blocked: boolean;
  coordinator: string | null;
  awaitingRole: string | null;
}

function daysBetween(a: string, b: string) {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

export async function portfolio(ctx: ServiceContext, filter: PortfolioFilter = "all") {
  const actor = requireUser(ctx);
  const items = await listTransactionsForActor(ctx);
  const t = today(ctx);
  const rows: PortfolioRow[] = [];
  for (const { snapshot: s } of items) {
    const timeline = buildTimeline(s, t);
    const phase = currentPhase(timeline);
    const attention = [
      ...timeline.filter((m) => m.health === "blocked").map((m) => `${m.label}: ${m.exceptions[0] ?? "blocked"}`),
      ...timeline.filter((m) => m.health === "needs_attention").map((m) => `${m.label} is overdue`),
      ...(s.transaction.state === "disputed" ? ["Disputed"] : []),
    ];
    const buyer = s.participants.find((p) => p.role === "buyer");
    const seller = s.participants.find((p) => p.role === "seller");
    const coordinator = s.participants.find((p) => p.role === "transaction_coordinator");
    rows.push({
      id: s.transaction.id,
      reference: s.transaction.reference,
      property: dealSubject(s).title,
      city: [s.property.city, s.property.region].filter(Boolean).join(", "),
      // Principals' names only; no financial data in the bulk view.
      buyer: buyer?.displayName ?? "—",
      seller: seller?.displayName ?? "—",
      closingDate: s.transaction.expectedClosingDate,
      stage: STATE_LABELS[s.transaction.state].label,
      stateTone: STATE_LABELS[s.transaction.state].tone,
      progress: progressPercent(timeline),
      attention,
      blocked: timeline.some((m) => m.health === "blocked") || s.transaction.state === "disputed",
      coordinator: coordinator?.displayName ?? null,
      awaitingRole: phase?.ownerRole ?? null,
    });
  }
  const filtered = rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "blocked") return r.blocked;
    if (filter === "closing_this_week") return !!r.closingDate && daysBetween(t, r.closingDate) >= 0 && daysBetween(t, r.closingDate) <= 7;
    return !!r.awaitingRole && AWAITING[filter].includes(r.awaitingRole as ParticipantRole);
  });
  return { rows: filtered, total: rows.length, actor };
}

export interface CommandCenterKpis {
  openTransactions: number;
  closingThisWeek: number;
  blocked: number;
  pendingSignatures: number;
  pendingPayments: number;
  titleIssues: number;
  identityReviews: number;
  delayed: number;
}

/** Real counts over the transactions this person can see. No synthetic analytics. */
export async function commandCenter(ctx: ServiceContext): Promise<{ kpis: CommandCenterKpis; rows: PortfolioRow[] }> {
  const items = await listTransactionsForActor(ctx);
  const { rows } = await portfolio(ctx, "all");
  const t = today(ctx);
  const open = items.filter(({ snapshot: s }) => !["closed", "cancelled"].includes(s.transaction.state));
  const kpis: CommandCenterKpis = {
    openTransactions: open.length,
    closingThisWeek: open.filter(({ snapshot: s }) => s.transaction.expectedClosingDate && daysBetween(t, s.transaction.expectedClosingDate) >= 0 && daysBetween(t, s.transaction.expectedClosingDate) <= 7).length,
    blocked: rows.filter((r) => r.blocked && open.some((o) => o.snapshot.transaction.id === r.id)).length,
    pendingSignatures: open.reduce((n, { snapshot: s }) => n + s.documents.filter((d) => ["sent", "viewed", "signed"].includes(d.signatureStatus)).length, 0),
    pendingPayments: open.reduce((n, { snapshot: s }) => n + s.payments.filter((p) => ["authorization_required", "authorized", "initiated", "processing", "received"].includes(p.status)).length, 0),
    titleIssues: open.reduce((n, { snapshot: s }) => n + s.titleIssues.filter((i) => !i.resolved).length, 0),
    identityReviews: open.reduce((n, { snapshot: s }) => n + s.identityVerifications.filter((v) => v.status === "review_required").length + s.complianceCases.filter((c) => c.status === "review_required" || c.status === "escalated").length, 0),
    delayed: open.filter(({ snapshot: s }) => s.transaction.expectedClosingDate && s.transaction.expectedClosingDate < t).length,
  };
  return { kpis, rows };
}

export function canDo(actor: Actor, s: TransactionSnapshot, permission: Parameters<typeof can>[1]) {
  return can(actor, permission, accessContext(s));
}
