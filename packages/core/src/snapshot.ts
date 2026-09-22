/**
 * Loading a transaction aggregate + access checks.
 *
 * Every read of a transaction goes through `loadAuthorized`, which returns
 * 404 (not 403) to people without access so transaction ids can't be probed.
 */
import { type Actor, type TransactionAccessContext, assertCan, can } from "@sagolik/auth";
import type { Permission } from "@sagolik/types";
import type { TransactionSnapshot } from "@sagolik/workflow";
import { type ServiceContext, isUser } from "./context";
import { notFound } from "./errors";

export async function loadSnapshot(ctx: ServiceContext, transactionId: string, db = ctx.db): Promise<TransactionSnapshot | null> {
  const transaction = await db.transactions.get(transactionId);
  if (!transaction) return null;
  const where = { transactionId };
  const [
    property,
    participants,
    milestones,
    tasks,
    documents,
    signatures,
    identityVerifications,
    complianceCases,
    sourceOfFunds,
    payments,
    bankInstructions,
    escrow,
    escrowConditions,
    mortgage,
    mortgageConditions,
    titleCase,
    titleIssues,
    recording,
  ] = await Promise.all([
    db.properties.get(transaction.propertyId),
    db.transaction_participants.find(where, { orderBy: "createdAt" }),
    db.transaction_milestones.find(where),
    db.tasks.find(where, { orderBy: "createdAt" }),
    db.documents.find(where, { orderBy: "createdAt" }),
    db.document_signatures.find(where),
    db.identity_verifications.find(where),
    db.compliance_cases.find(where),
    db.source_of_funds_declarations.find(where),
    db.payments.find(where, { orderBy: "createdAt" }),
    db.bank_instructions.find(where, { orderBy: "version" }),
    db.escrow_accounts.findOne(where),
    db.escrow_conditions.find(where),
    db.mortgages.findOne(where),
    db.mortgage_conditions.find(where),
    db.title_cases.findOne(where),
    db.title_issues.find(where),
    db.recordings.findOne(where),
  ]);
  if (!property) return null;
  const taskIds = tasks.map((t) => t.id);
  const taskDependencies = taskIds.length ? await db.task_dependencies.find({ taskId: taskIds }) : [];
  return {
    transaction,
    property,
    participants,
    milestones,
    tasks,
    taskDependencies,
    documents,
    signatures,
    identityVerifications,
    complianceCases,
    sourceOfFunds,
    payments,
    bankInstructions,
    escrow,
    escrowConditions,
    mortgage,
    mortgageConditions,
    titleCase,
    titleIssues,
    recording,
  };
}

export function accessContext(s: TransactionSnapshot): TransactionAccessContext {
  return {
    transactionId: s.transaction.id,
    organizationId: s.transaction.organizationId,
    participants: s.participants.map((p) => ({ id: p.id, userId: p.userId, role: p.role, status: p.status })),
  };
}

/**
 * Load + authorize. System actors (workflow, webhooks) skip the permission
 * check but still require the transaction to exist.
 */
export async function loadAuthorized(ctx: ServiceContext, transactionId: string, permission: Permission): Promise<TransactionSnapshot> {
  const s = await loadSnapshot(ctx, transactionId);
  if (!s) throw notFound("That transaction");
  if (isUser(ctx.actor)) {
    const access = accessContext(s);
    if (!can(ctx.actor, "transaction.view", access)) throw notFound("That transaction");
    assertCan(ctx.actor, permission, access);
  }
  return s;
}

export function actorParticipantIds(actor: Actor, s: TransactionSnapshot): string[] {
  return s.participants.filter((p) => p.userId === actor.userId && p.status !== "removed").map((p) => p.id);
}
