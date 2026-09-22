/**
 * Workflow engine: after any change, bring persisted workflow state in line
 * with the facts. Everything it does is explainable (rule id + fact details)
 * and recorded as transaction events.
 */
import type { TransactionState } from "@sagolik/types";
import {
  FACTS,
  type FactKey,
  type TransactionSnapshot,
  assertTransition,
  buildTimeline,
  evaluateAllFacts,
  evaluateRules,
  planAutomaticAdvance,
} from "@sagolik/workflow";
import { type ServiceContext, actorId, asSystem, isUser } from "../context";
import { conflict } from "../errors";
import { audit, emit } from "../events";
import { loadSnapshot } from "../snapshot";
import { newId, nowIso } from "../util";
import { postSystemMessage } from "./messaging";

const STATE_ANNOUNCEMENTS: Partial<Record<TransactionState, string>> = {
  invited: "Everyone has been invited. The transaction is open.",
  documents_pending: "All identities are verified. Next: collecting documents.",
  financing_pending: "The purchase agreement is fully signed. Next: financing.",
  conditions_pending: "Financing is approved. Next: clearing the remaining conditions.",
  ready_for_signing: "Title is clear, the lender has issued Clear to Close and the closing statement is approved. Ready for signing.",
  signing: "Closing documents have been sent for signature.",
  escrow_pending: "Every document is signed. Next: funds into escrow.",
  funding_pending: "Funds have settled in escrow. Next: lender funding.",
  recording_pending: "Every closing requirement is met. The deed can now be recorded.",
  ownership_transfer: "The registry has confirmed the recording. Ownership has transferred.",
  closed: "This transaction is closed. Congratulations!",
  cancelled: "This transaction was cancelled.",
  disputed: "This transaction has been marked as disputed and is paused.",
};

/** Persist one state change: optimistic concurrency + event + audit + domain event + room notice. */
export async function applyTransition(
  ctx: ServiceContext,
  s: TransactionSnapshot,
  to: TransactionState,
  reason: string,
  source: string,
): Promise<TransactionSnapshot> {
  const from = s.transaction.state;
  assertTransition(s, to);
  const updated = await ctx.writer.transactions.updateIf(
    s.transaction.id,
    { state: from, version: s.transaction.version },
    {
      state: to,
      version: s.transaction.version + 1,
      stateChangedAt: nowIso(ctx),
      ...(to === "closed" ? { closedAt: nowIso(ctx) } : {}),
    },
  );
  if (!updated) throw conflict("This transaction was just updated by someone else. Please refresh and try again.");
  await ctx.writer.transaction_events.insert({
    id: newId(),
    transactionId: s.transaction.id,
    eventType: "transaction.state_changed",
    fromState: from,
    toState: to,
    actorId: actorId(ctx),
    actorType: isUser(ctx.actor) ? "user" : "system",
    reason,
    source,
    relatedEntityType: null,
    relatedEntityId: null,
    ipAddress: isUser(ctx.actor) ? ctx.actor.ipAddress : null,
    correlationId: ctx.correlationId,
    payload: {},
    occurredAt: nowIso(ctx),
  });
  await audit(ctx, {
    action: "transaction.state_changed",
    resourceType: "transaction",
    resourceId: s.transaction.id,
    transactionId: s.transaction.id,
    organizationId: s.transaction.organizationId,
    metadata: { from, to, reason, source },
  });
  await emit(ctx, {
    type: "transaction.state_changed",
    aggregateType: "transaction",
    aggregateId: s.transaction.id,
    transactionId: s.transaction.id,
    payload: { from, to },
    idempotencyKey: `transaction.state_changed:${s.transaction.id}:${updated.version}`,
  });
  const notice = STATE_ANNOUNCEMENTS[to];
  if (notice) await postSystemMessage(ctx, s.transaction.id, notice, { type: "transaction", id: s.transaction.id });
  return { ...s, transaction: updated };
}

async function syncRequirements(ctx: ServiceContext, s: TransactionSnapshot) {
  const facts = evaluateAllFacts(s);
  const existing = await ctx.writer.transaction_requirements.find({ transactionId: s.transaction.id });
  for (const key of Object.keys(facts) as FactKey[]) {
    const f = facts[key];
    const row = existing.find((r) => r.key === key);
    if (!row) {
      await ctx.writer.transaction_requirements.insert({
        id: newId(),
        transactionId: s.transaction.id,
        key,
        label: FACTS[key].label,
        satisfied: f.value,
        satisfiedAt: f.value ? nowIso(ctx) : null,
        evidenceEntityType: null,
        evidenceEntityId: null,
        createdAt: nowIso(ctx),
        updatedAt: nowIso(ctx),
      });
    } else if (row.satisfied !== f.value) {
      await ctx.writer.transaction_requirements.update(row.id, { satisfied: f.value, satisfiedAt: f.value ? nowIso(ctx) : null });
    }
  }
}

async function syncMilestones(ctx: ServiceContext, s: TransactionSnapshot) {
  const timeline = buildTimeline(s, nowIso(ctx).slice(0, 10));
  for (const m of timeline) {
    const row = s.milestones.find((r) => r.key === m.key);
    if (!row) continue;
    if (m.complete && !row.completedAt) await ctx.writer.transaction_milestones.update(row.id, { completedAt: nowIso(ctx) });
    if (!m.complete && row.completedAt) await ctx.writer.transaction_milestones.update(row.id, { completedAt: null });
  }
}

/**
 * Re-evaluate rules and advance automatically where allowed. Safe to call
 * any number of times (idempotent). Returns the states entered.
 */
export async function reconcile(ctx: ServiceContext, transactionId: string): Promise<TransactionState[]> {
  const sys = asSystem(ctx, "workflow");
  let s = await loadSnapshot(sys, transactionId, ctx.writer);
  if (!s) return [];

  for (const ev of evaluateRules(s)) {
    if (!ev.satisfied) continue;
    if (ev.rule.then.kind === "mark_recording_ready" && s.recording?.status === "not_ready") {
      await ctx.writer.recordings.update(s.recording.id, { status: "ready_for_recording" });
      await audit(sys, {
        action: "recording.ready",
        resourceType: "recording",
        resourceId: s.recording.id,
        transactionId,
        organizationId: s.transaction.organizationId,
        metadata: { rule: ev.rule.id, because: ev.conditions.map((c) => c.detail) },
      });
      await postSystemMessage(sys, transactionId, "Funds have settled and the deed is signed — the deed is ready to be recorded.", {
        type: "recording",
        id: s.recording.id,
      });
      s = { ...s, recording: { ...s.recording, status: "ready_for_recording" } };
    }
  }

  await syncRequirements(sys, s);
  await syncMilestones(sys, s);

  const entered: TransactionState[] = [];
  for (const to of planAutomaticAdvance(s)) {
    const rule = evaluateRules(s).find((r) => r.rule.then.kind === "advance_state" && r.rule.then.to === to);
    const reason = rule ? `Rule ${rule.rule.id}: ${rule.rule.description}` : `Automatic: every requirement for "${to}" is met.`;
    s = await applyTransition(sys, s, to, reason, "workflow");
    entered.push(to);
  }
  if (entered.includes("ownership_transfer")) {
    await emit(sys, {
      type: "ownership.transferred",
      aggregateType: "transaction",
      aggregateId: transactionId,
      transactionId,
      idempotencyKey: `ownership.transferred:${transactionId}`,
    });
  }
  return entered;
}
