/**
 * Sagolik Assistant.
 *
 * Answers questions from STRUCTURED transaction data only — the same facts,
 * timeline and permissions the UI uses — so it cannot hallucinate status.
 * Every answer links to its sources.
 *
 * Tool permissions are explicit and read-only. The assistant can never move
 * funds, change bank details, approve KYC/AML, sign, or transfer ownership;
 * such requests are declined with a link to where the person can do it.
 *
 * A language model can be layered on top for phrasing (ASSISTANT_TOOLS map
 * 1:1 to tool definitions), but it only ever receives the output of these
 * tools, filtered by the asking person's permissions.
 */
import { can } from "@sagolik/auth";
import { buildTimeline, closingBlockers, currentPhase, documentSummary, nextActionFor, progressPercent } from "@sagolik/workflow";
import { type ServiceContext, requireUser } from "../context";
import { audit } from "../events";
import { accessContext, loadAuthorized } from "../snapshot";
import { today } from "../util";
import { visibleDocuments } from "./documents";
import { ROLE_LABELS, STATE_LABELS } from "./views";

export const ASSISTANT_TOOLS = {
  read_status: { description: "Current stage, progress and timeline", permission: "transaction.view" },
  read_blockers: { description: "What stands between the transaction and closing", permission: "transaction.view" },
  read_my_tasks: { description: "The asking person's open tasks", permission: "transaction.view" },
  read_documents: { description: "Document names and statuses the person may see", permission: "document.view" },
  read_money_summary: { description: "Purchase price, loan, deposits and escrow status", permission: "financial.view" },
  read_people: { description: "Participants and their roles", permission: "transaction.view" },
} as const;

/** Things the assistant will never do, whatever it's asked. */
export const FORBIDDEN_ACTIONS = [
  "move or approve funds",
  "change bank or payout details",
  "approve identity, KYC or AML checks",
  "sign documents",
  "transfer ownership or confirm recording",
  "make legal decisions",
] as const;

export interface AssistantAnswer {
  intent: string;
  answer: string;
  bullets: string[];
  sources: Array<{ label: string; href: string }>;
  declined: boolean;
}

const INTENTS: Array<[string, RegExp]> = [
  ["action_request", /^(please\s+|can you\s+|could you\s+|would you\s+|go ahead and\s+)?(send|transfer|wire|move|pay|approve|sign|change|update|verify|mark|close|release|disburse|record)\b/i],
  ["blockers", /\b(hold(ing)?|block|stuck|waiting|delay|missing|left|remain|what'?s? (needed|outstanding))\b/i],
  ["next_step", /\b(next|what (do|should) i|my (task|to-?do)|to do)\b/i],
  ["money", /\b(money|funds?|deposit|escrow|how much|balance|cost|price|loan amount|cash)\b/i],
  ["closing_date", /\b(when|date|closing day|become (the )?owner|move in|keys)\b/i],
  ["documents", /\b(documents?|papers?|signatures?|disclosure|deed|contract)\b/i],
  ["people", /\b(who|contact|agent|lender|officer|attorney|notary|coordinator)\b/i],
];

function detectIntent(q: string): string {
  // An explicit request to act is checked first, so "send the deposit" is declined rather than answered as a money question.
  for (const [intent, re] of INTENTS) if (re.test(q)) return intent;
  return "status";
}

function fmtMoney(minor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);
}

export async function askAssistant(ctx: ServiceContext, transactionId: string, question: string): Promise<AssistantAnswer> {
  const actor = requireUser(ctx);
  const q = question.trim().slice(0, 500);
  const s = await loadAuthorized(ctx, transactionId, "transaction.view");
  const access = accessContext(s);
  const base = `/app/transactions/${transactionId}`;
  const timeline = buildTimeline(s, today(ctx));
  const intent = detectIntent(q);
  await audit(ctx, { action: "assistant.query", resourceType: "transaction", resourceId: transactionId, transactionId, organizationId: s.transaction.organizationId, metadata: { intent, length: q.length } });

  const answer = (a: Omit<AssistantAnswer, "intent" | "declined"> & { declined?: boolean }): AssistantAnswer => ({ intent, declined: false, ...a });

  switch (intent) {
    case "action_request":
      return answer({
        declined: true,
        answer: "I can explain what's happening, but I can't take that action for you. Moving money, changing bank details, signing and confirming ownership always have to be done by you or the responsible professional, with extra security checks.",
        bullets: [...FORBIDDEN_ACTIONS].map((a) => `I never ${a}.`),
        sources: [
          { label: "Money & payments", href: `${base}/money` },
          { label: "Documents to sign", href: `${base}/documents` },
        ],
      });

    case "blockers": {
      const blockers = closingBlockers(s);
      const phase = currentPhase(timeline);
      if (blockers.length === 0)
        return answer({ answer: "Nothing is blocking your closing — every requirement is met.", bullets: [], sources: [{ label: "Timeline", href: base }] });
      return answer({
        answer: `${blockers.length === 1 ? "One item remains" : `${blockers.length} items remain`} before closing${phase ? `. You're currently at “${phase.label}”` : ""}:`,
        bullets: blockers.map((b) => `${b.detail}${b.responsible ? ` (${b.responsible.displayName}, ${ROLE_LABELS[b.responsible.role]})` : b.responsibleRole ? ` (${b.responsibleRole.replace(/_/g, " ")})` : ""}`),
        sources: [
          { label: "View timeline", href: base },
          ...(blockers.some((b) => /lender|loan/i.test(b.detail)) ? [{ label: "View lender status", href: `${base}/mortgage` }] : []),
          ...(blockers.some((b) => /sign|deed|document/i.test(b.detail)) ? [{ label: "View documents", href: `${base}/documents` }] : []),
          ...(blockers.some((b) => /title/i.test(b.detail)) ? [{ label: "View title", href: `${base}/title` }] : []),
          ...(blockers.some((b) => /fund|escrow|deposit/i.test(b.detail)) ? [{ label: "View money", href: `${base}/money` }] : []),
        ],
      });
    }

    case "next_step": {
      const next = nextActionFor(s, actor.userId);
      if (!next) return answer({ answer: "There's nothing waiting on you right now. We'll let you know when there is.", bullets: [], sources: [{ label: "View tasks", href: `${base}/tasks` }] });
      return answer({
        answer: `Your next step: ${next.title}.${next.estimatedMinutes ? ` Estimated time: ${next.estimatedMinutes} minutes.` : ""}`,
        bullets: next.description ? [next.description] : [],
        sources: [{ label: "View task", href: `${base}/tasks#task-${next.id}` }],
      });
    }

    case "money": {
      if (!can(actor, "financial.view", access)) {
        return answer({ answer: "Financial details on this transaction are only visible to the buyers, sellers, lender, escrow and title officers.", bullets: [], sources: [] });
      }
      const deposit = s.payments.filter((p) => (p.type === "earnest_money" || p.type === "deposit") && p.status === "settled").reduce((a, p) => a + p.amount, 0);
      const loan = s.mortgage?.loanAmount ?? 0;
      const cur = s.transaction.currency;
      const bullets = [
        `Purchase price: ${fmtMoney(s.transaction.salePrice, cur)}`,
        ...(s.mortgage ? [`Mortgage: ${fmtMoney(loan, cur)} from ${s.mortgage.lenderName}`] : []),
        `Deposit received in escrow: ${fmtMoney(deposit, cur)}`,
        `Estimated remaining at closing: ${fmtMoney(Math.max(0, s.transaction.salePrice - loan - deposit), cur)} (the approved closing statement is final)`,
      ];
      if (s.escrow) bullets.push(`Escrow with ${s.escrow.providerName}: ${fmtMoney(s.escrow.receivedAmount, cur)} of ${fmtMoney(s.escrow.requiredAmount, cur)} received`);
      const inflight = s.payments.filter((p) => ["initiated", "processing", "received"].includes(p.status));
      if (inflight.length) bullets.push(`${inflight.length} transfer${inflight.length > 1 ? "s are" : " is"} on the way and being finalized.`);
      return answer({
        answer: "Here's where the money stands. Always confirm wire instructions by phone with your escrow officer before sending money.",
        bullets,
        sources: [{ label: "View money", href: `${base}/money` }],
      });
    }

    case "closing_date": {
      const remaining = timeline.filter((m) => !m.complete);
      return answer({
        answer: s.transaction.expectedClosingDate
          ? `Closing is expected on ${new Date(`${s.transaction.expectedClosingDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. You become the legal owner once the registry confirms the recording.`
          : "A closing date hasn't been set yet.",
        bullets: remaining.length ? [`Still to come: ${remaining.map((m) => m.label).join(" → ")}`] : ["Ownership has been recorded."],
        sources: [{ label: "View timeline", href: base }],
      });
    }

    case "documents": {
      const docs = visibleDocuments(ctx, s);
      const summary = documentSummary({ ...s, documents: docs });
      const attention = docs.filter((d) => d.status === "needs_attention" || ["sent", "viewed", "signed", "declined"].includes(d.signatureStatus));
      return answer({
        answer: `${summary.complete} document${summary.complete === 1 ? " is" : "s are"} complete and ${summary.needsAttention} need${summary.needsAttention === 1 ? "s" : ""} attention.`,
        bullets: attention.map((d) => `${d.name} v${d.currentVersion}: ${d.signatureStatus === "declined" ? "a signer declined" : d.status === "needs_attention" ? "needs attention" : "waiting for signatures"}`),
        sources: [{ label: "View documents", href: `${base}/documents` }],
      });
    }

    case "people":
      return answer({
        answer: "These are the people on your transaction:",
        bullets: s.participants.filter((p) => p.status !== "removed").map((p) => `${ROLE_LABELS[p.role]}: ${p.displayName}`),
        sources: [{ label: "View people", href: `${base}/people` }],
      });

    default: {
      const phase = currentPhase(timeline);
      return answer({
        answer: `${s.property.addressLine1} is ${progressPercent(timeline)}% complete. Current stage: ${STATE_LABELS[s.transaction.state].label}${phase ? ` — next milestone: ${phase.label}` : ""}.`,
        bullets: phase ? [phase.detail] : [],
        sources: [{ label: "View timeline", href: base }],
      });
    }
  }
}
