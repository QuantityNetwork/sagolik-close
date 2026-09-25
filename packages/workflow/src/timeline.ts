/**
 * Timeline, progress, next actions and blockers — the "understand my closing
 * in ten seconds" layer. Pure functions over a snapshot.
 */
import type {
  DocumentCategory,
  MilestoneKey,
  StageHealth,
  Task,
  TransactionParticipant,
} from "@sagolik/types";
import { type FactKey, type FactResult, evaluateAllFacts } from "./facts";
import { getJurisdiction } from "./jurisdictions";
import { recordingReadiness } from "./rules";
import type { TransactionSnapshot } from "./snapshot";

export const MILESTONE_LABELS: Record<MilestoneKey, string> = {
  offer_accepted: "Offer accepted",
  transaction_opened: "Transaction opened",
  identity_verified: "Identity verified",
  documents_received: "Documents received",
  financing_approved: "Financing approved",
  inspection_completed: "Inspection completed",
  title_cleared: "Title cleared",
  signing_complete: "Signing complete",
  funds_received: "Funds received",
  recording_submitted: "Recording submitted",
  ownership_transferred: "Ownership transferred",
};

/** Short labels for compact steppers ("✓ Agreement ● Signing ○ Funds"). */
export const MILESTONE_SHORT_LABELS: Record<MilestoneKey, string> = {
  offer_accepted: "Agreement",
  transaction_opened: "Opened",
  identity_verified: "Identity",
  documents_received: "Documents",
  financing_approved: "Financing",
  inspection_completed: "Inspection",
  title_cleared: "Title",
  signing_complete: "Signing",
  funds_received: "Funds",
  recording_submitted: "Recording",
  ownership_transferred: "Ownership",
};

const MILESTONE_FACT: Record<MilestoneKey, FactKey | "offer" | "opened"> = {
  offer_accepted: "offer",
  transaction_opened: "opened",
  identity_verified: "identity_verified",
  documents_received: "documents_received",
  financing_approved: "financing_approved",
  inspection_completed: "inspection_completed",
  title_cleared: "title_clear",
  signing_complete: "signing_complete",
  funds_received: "funds_settled",
  recording_submitted: "recording_submitted",
  ownership_transferred: "ownership_recorded",
};

const MILESTONE_DOCS: Partial<Record<MilestoneKey, DocumentCategory[]>> = {
  offer_accepted: ["purchase_agreement"],
  identity_verified: ["identity"],
  documents_received: ["disclosure", "purchase_agreement"],
  financing_approved: ["mortgage", "appraisal"],
  inspection_completed: ["inspection"],
  title_cleared: ["title", "insurance"],
  signing_complete: ["closing_statement", "deed"],
  funds_received: ["escrow"],
  recording_submitted: ["recording", "deed"],
  ownership_transferred: ["recording"],
};

const BUSINESS_MILESTONE_DOCS: Partial<Record<MilestoneKey, DocumentCategory[]>> = {
  offer_accepted: ["letter_of_intent"],
  identity_verified: ["identity"],
  documents_received: ["due_diligence_report", "disclosure_schedules"],
  financing_approved: ["mortgage"],
  inspection_completed: ["due_diligence_report"],
  title_cleared: ["lien_search"],
  signing_complete: ["definitive_agreement", "funds_flow_memo", "transfer_instrument"],
  funds_received: ["escrow"],
  recording_submitted: ["closing_certificate", "transfer_instrument"],
  ownership_transferred: ["closing_certificate"],
};

export interface MilestoneView {
  key: MilestoneKey;
  label: string;
  shortLabel: string;
  health: StageHealth;
  complete: boolean;
  current: boolean;
  detail: string;
  owner: TransactionParticipant | null;
  ownerRole: string | null;
  dueDate: string | null;
  overdue: boolean;
  tasks: Task[];
  documentIds: string[];
  exceptions: string[];
  dependsOn: MilestoneKey[];
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function evaluateMilestoneFact(key: MilestoneKey, s: TransactionSnapshot, facts: Record<FactKey, FactResult>): FactResult {
  const f = MILESTONE_FACT[key];
  if (f === "offer") {
    const j = getJurisdiction(s.transaction.jurisdiction);
    if (j.vertical === "business") {
      // A business deal starts with a signed letter of intent.
      const loi = s.documents.some((d) => d.category === "letter_of_intent" && d.status !== "rejected");
      return loi
        ? { value: true, detail: "Letter of intent signed and on file." }
        : { value: false, detail: "Upload the signed letter of intent.", responsibleRole: "broker" };
    }
    const has = s.documents.some((d) => d.category === "purchase_agreement" && d.status !== "rejected");
    return has
      ? { value: true, detail: "Offer accepted and purchase agreement on file." }
      : { value: false, detail: "Upload the accepted purchase agreement.", responsibleRole: "buyer_agent" };
  }
  if (f === "opened") {
    return s.transaction.state !== "draft"
      ? { value: true, detail: "Participants have been invited." }
      : { value: false, detail: "Invite the parties to open the transaction.", responsibleRole: "transaction_coordinator" };
  }
  return facts[f];
}

function exceptionsFor(key: MilestoneKey, s: TransactionSnapshot): string[] {
  const out: string[] = [];
  if (key === "identity_verified") {
    for (const v of s.identityVerifications) {
      if (v.status === "failed" || v.status === "review_required") out.push(v.failureReason ?? "An identity check needs manual review.");
    }
  }
  if (key === "title_cleared") {
    for (const i of s.titleIssues.filter((x) => !x.resolved)) out.push(i.description);
  }
  if (key === "financing_approved" && s.mortgage?.appraisalStatus === "issue") out.push("The appraisal flagged an issue.");
  if (key === "signing_complete") {
    for (const sig of s.signatures.filter((x) => x.status === "declined" || x.status === "expired")) {
      const doc = s.documents.find((d) => d.id === sig.documentId);
      out.push(`${doc?.name ?? "A document"}: signature ${sig.status}.`);
    }
  }
  if (key === "funds_received") {
    for (const p of s.payments.filter((x) => x.status === "failed" || x.status === "returned")) {
      out.push(`A ${p.type.replace(/_/g, " ")} transfer ${p.status}.`);
    }
  }
  return out;
}

export function buildTimeline(s: TransactionSnapshot, today: string = isoDate(new Date())): MilestoneView[] {
  const facts = evaluateAllFacts(s);
  const jurisdiction = getJurisdiction(s.transaction.jurisdiction);
  let currentAssigned = false;
  const keys = jurisdiction.milestones;
  return keys.map((key, index) => {
    const result = evaluateMilestoneFact(key, s, facts);
    const row = s.milestones.find((m) => m.key === key);
    const ownerRole = row?.ownerRole ?? result.responsibleRole ?? null;
    const owner = ownerRole ? (s.participants.find((p) => p.role === ownerRole && p.status !== "removed") ?? null) : null;
    const tasks = s.tasks.filter((t) => t.milestoneKey === key);
    const categories = (jurisdiction.vertical === "business" ? BUSINESS_MILESTONE_DOCS : MILESTONE_DOCS)[key] ?? [];
    const documentIds = s.documents.filter((d) => categories.includes(d.category)).map((d) => d.id);
    const exceptions = result.value ? [] : exceptionsFor(key, s);
    const dueDate = row?.dueDate ?? null;
    const overdue = !result.value && !!dueDate && dueDate < today;
    const blockedTask = tasks.some((t) => t.status === "blocked");

    let health: StageHealth;
    if (result.value) health = "complete";
    else if (exceptions.length > 0 || blockedTask) health = "blocked";
    else if (overdue || tasks.some((t) => t.priority === "urgent" && t.status !== "complete" && t.status !== "waived"))
      health = "needs_attention";
    else health = "normal";

    const current = !result.value && !currentAssigned;
    if (current) currentAssigned = true;

    return {
      key,
      label: jurisdiction.milestoneLabels?.[key] ?? MILESTONE_LABELS[key],
      shortLabel: MILESTONE_SHORT_LABELS[key],
      health,
      complete: result.value,
      current,
      detail: result.detail,
      owner,
      ownerRole,
      dueDate,
      overdue,
      tasks,
      documentIds,
      exceptions,
      dependsOn: index > 0 ? [keys[index - 1]!] : [],
    };
  });
}

/** Completion percentage: completed milestones over total, rounded. */
export function progressPercent(timeline: MilestoneView[]): number {
  if (timeline.length === 0) return 0;
  return Math.round((timeline.filter((m) => m.complete).length / timeline.length) * 100);
}

export function currentPhase(timeline: MilestoneView[]): MilestoneView | null {
  return timeline.find((m) => m.current) ?? null;
}

const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
const OPEN = new Set(["todo", "in_progress", "waiting", "blocked"]);

export function isTaskOpen(t: Task): boolean {
  return OPEN.has(t.status);
}

/** A task is actionable when it's open and every dependency is complete or waived. */
export function isTaskActionable(t: Task, s: TransactionSnapshot): boolean {
  if (!isTaskOpen(t) || t.status === "blocked") return false;
  const deps = s.taskDependencies.filter((d) => d.taskId === t.id);
  return deps.every((d) => {
    const dep = s.tasks.find((x) => x.id === d.dependsOnTaskId);
    return !dep || dep.status === "complete" || dep.status === "waived";
  });
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  });
}

/** The single most important thing this user should do next on this transaction. */
export function nextActionFor(s: TransactionSnapshot, userId: string): Task | null {
  const mine = new Set(s.participants.filter((p) => p.userId === userId).map((p) => p.id));
  const candidates = s.tasks.filter((t) => t.assigneeParticipantId && mine.has(t.assigneeParticipantId) && isTaskActionable(t, s));
  return sortTasks(candidates)[0] ?? null;
}

export interface Blocker {
  label: string;
  detail: string;
  responsibleRole: string | null;
  responsible: TransactionParticipant | null;
}

/** What stands between this transaction and closing, in plain language. */
export function closingBlockers(s: TransactionSnapshot): Blocker[] {
  const { items } = recordingReadiness(s);
  return items
    .filter((i) => !i.value)
    .map((i) => ({
      label: i.label,
      detail: i.detail,
      responsibleRole: i.responsibleRole ?? null,
      responsible: i.responsibleRole ? (s.participants.find((p) => p.role === i.responsibleRole) ?? null) : null,
    }));
}

export interface DocumentSummary {
  complete: number;
  needsAttention: number;
  total: number;
}

export function documentSummary(s: TransactionSnapshot): DocumentSummary {
  const live = s.documents.filter((d) => d.status !== "superseded");
  const attention = live.filter(
    (d) => d.status === "needs_attention" || d.status === "rejected" || ["sent", "viewed", "declined", "expired"].includes(d.signatureStatus),
  );
  const complete = live.filter(
    (d) => d.status === "approved" && (d.signatureStatus === "completed" || d.signatureStatus === "not_required"),
  );
  return { complete: complete.length, needsAttention: attention.length, total: live.length };
}
