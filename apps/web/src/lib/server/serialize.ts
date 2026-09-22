import "server-only";
/**
 * API serializers. Anything leaving the server passes through here: secrets
 * are stripped and data is filtered by the caller's permissions, so the API
 * can never be more generous than the UI.
 */
import { can } from "@sagolik/auth";
import { accessContext, type ServiceContext, visibleDocuments } from "@sagolik/core";
import type { TransactionSnapshot } from "@sagolik/workflow";

export function serializeSnapshot(ctx: ServiceContext, s: TransactionSnapshot) {
  const actor = "userId" in ctx.actor ? ctx.actor : null;
  const access = accessContext(s);
  const financial = actor ? can(actor, "financial.view", access) : false;
  const compliance = actor ? can(actor, "compliance.review", access) : false;
  const identity = actor ? can(actor, "identity.view_result", access) : false;
  return {
    transaction: s.transaction,
    property: s.property,
    participants: s.participants.filter((p) => p.status !== "removed").map((p) => ({ id: p.id, role: p.role, displayName: p.displayName, status: p.status, joinedAt: p.joinedAt })),
    milestones: s.milestones,
    tasks: s.tasks,
    documents: visibleDocuments(ctx, s),
    signatures: s.signatures.filter((sig) => visibleDocuments(ctx, s).some((d) => d.id === sig.documentId)),
    identity: s.identityVerifications
      .filter((v) => identity || v.userId === actor?.userId)
      .map((v) => ({ participantId: v.participantId, status: v.status, verifiedAt: v.verifiedAt })),
    complianceCases: compliance ? s.complianceCases : [],
    payments: financial ? s.payments : [],
    bankInstructions: financial ? s.bankInstructions.map(({ encryptedAccountNumber: _secret, ...rest }) => rest) : [],
    escrow: financial ? s.escrow : null,
    escrowConditions: s.escrowConditions,
    mortgage: s.mortgage ? (financial ? s.mortgage : { lenderName: s.mortgage.lenderName, status: s.mortgage.status }) : null,
    mortgageConditions: s.mortgageConditions,
    title: s.titleCase,
    titleIssues: s.titleIssues,
    recording: s.recording,
  };
}
