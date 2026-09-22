/**
 * Identity verification + compliance review.
 *
 * Providers perform KYC/sanctions/PEP checks. Sagolik stores the minimum
 * result data. Anything short of a clean pass opens a compliance case for a
 * HUMAN reviewer — no automated system (AI included) makes an irreversible
 * compliance decision.
 */
import { assertCan, isPrincipal } from "@sagolik/auth";
import {
  type ComplianceCategory,
  ComplianceDecisionInput,
  type IdentityChecks,
  SourceOfFundsInput,
} from "@sagolik/types";
import { getJurisdiction } from "@sagolik/workflow";
import { type ServiceContext, requireUser } from "../context";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { audit, emit } from "../events";
import { accessContext, actorParticipantIds, loadAuthorized } from "../snapshot";
import { newId, nowIso } from "../util";
import { reconcile } from "./engine";
import { postSystemMessage } from "./messaging";
import { notify, participantUserIds } from "./notifications";
import { completeTasksFor } from "./transactions";

const NOT_STARTED: IdentityChecks = { document: "not_started", liveness: "not_started", address: "not_started", sanctions: "not_started", pep: "not_started" };

export async function startIdentityVerification(ctx: ServiceContext, transactionId: string, returnUrl: string) {
  const actor = requireUser(ctx);
  const s = await loadAuthorized(ctx, transactionId, "transaction.view");
  const participant = s.participants.find((p) => p.userId === actor.userId && isPrincipal(p.role) && p.status !== "removed");
  if (!participant) throw forbidden("Identity verification is for the buyers and sellers on this transaction.");
  const existing = s.identityVerifications.find((v) => v.participantId === participant.id && ["verified", "processing", "review_required"].includes(v.status));
  if (existing?.status === "verified") throw conflict("Your identity is already verified.");
  if (existing) throw conflict("Your verification is being reviewed. We'll let you know as soon as it's done.");

  const j = getJurisdiction(s.transaction.jurisdiction);
  const started = await ctx.providers.identity.startVerification({
    referenceId: participant.id,
    fullName: participant.displayName,
    email: participant.email,
    country: s.property.country,
    livenessRequired: j.identity.livenessRequired,
    redirectUri: returnUrl,
  });
  const now = nowIso(ctx);
  await ctx.writer.identity_verifications.insert({
    id: newId(),
    transactionId,
    participantId: participant.id,
    userId: actor.userId,
    provider: ctx.providers.identity.info.id,
    externalId: started.externalId,
    status: "pending",
    checks: NOT_STARTED,
    verifiedAt: null,
    expiresAt: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  });
  await audit(ctx, { action: "identity.started", resourceType: "identity_verification", resourceId: started.externalId, transactionId, organizationId: s.transaction.organizationId });
  return started.hostedUrl;
}

export async function handleIdentityEvent(ctx: ServiceContext, data: Record<string, unknown>) {
  const externalId = String(data.externalId ?? "");
  const row = await ctx.writer.identity_verifications.findOne({ provider: ctx.providers.identity.info.id, externalId });
  if (!row) throw new Error(`unknown verification ${externalId}`);
  // Authoritative result comes from the provider API, not the webhook body.
  const result = await ctx.providers.identity.getVerification(externalId);
  const now = nowIso(ctx);
  await ctx.writer.identity_verifications.update(row.id, {
    status: result.status,
    checks: result.checks,
    failureReason: result.failureReason,
    verifiedAt: result.status === "verified" ? now : null,
    expiresAt: result.status === "verified" ? new Date(ctx.now().getTime() + 180 * 86_400_000).toISOString() : null,
  });
  const tx = row.transactionId ? await ctx.writer.transactions.get(row.transactionId) : null;
  const participant = row.participantId ? await ctx.writer.transaction_participants.get(row.participantId) : null;
  await audit(ctx, {
    action: "identity.completed",
    resourceType: "identity_verification",
    resourceId: row.id,
    transactionId: row.transactionId,
    organizationId: tx?.organizationId ?? null,
    metadata: { status: result.status, provider: row.provider },
  });
  if (!row.transactionId || !participant) return;

  if (result.status === "verified") {
    await completeTasksFor(ctx, row.transactionId, "verify_identity", participant.id);
    await emit(ctx, { type: "identity.verified", aggregateType: "identity_verification", aggregateId: row.id, transactionId: row.transactionId, idempotencyKey: `identity.verified:${row.id}` });
    await postSystemMessage(ctx, row.transactionId, `${participant.displayName}'s identity is verified.`, { type: "participant", id: participant.id });
  } else if (result.status === "review_required") {
    await openComplianceCase(ctx, {
      transactionId: row.transactionId,
      organizationId: tx?.organizationId ?? null,
      participantId: participant.id,
      category: result.checks.pep === "review_required" ? "pep" : "kyc",
      reason: result.failureReason ?? "The identity provider asked for a manual review.",
      provider: row.provider,
      riskFlags: Object.entries(result.checks).filter(([, v]) => v === "review_required").map(([k]) => k),
    });
  } else if (result.status === "failed") {
    await emit(ctx, { type: "identity.failed", aggregateType: "identity_verification", aggregateId: row.id, transactionId: row.transactionId, idempotencyKey: `identity.failed:${row.id}` });
    if (participant.userId) {
      await notify(ctx, {
        userIds: [participant.userId],
        transactionId: row.transactionId,
        kind: "identity_incomplete",
        title: "We couldn't verify your identity",
        body: "The check didn't go through. You can try again with a clearer photo of your ID, or contact your coordinator.",
        linkPath: `/app/transactions/${row.transactionId}`,
      });
    }
  }
  await reconcile(ctx, row.transactionId);
}

export async function openComplianceCase(
  ctx: ServiceContext,
  input: { transactionId: string; organizationId: string | null; participantId: string | null; category: ComplianceCategory; reason: string; provider: string | null; riskFlags: string[] },
) {
  const now = nowIso(ctx);
  const c = await ctx.writer.compliance_cases.insert({
    id: newId(),
    transactionId: input.transactionId,
    organizationId: input.organizationId,
    participantId: input.participantId,
    category: input.category,
    reason: input.reason,
    provider: input.provider,
    status: "review_required",
    riskFlags: input.riskFlags,
    reviewerId: null,
    notes: null,
    decision: null,
    decidedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await audit(ctx, { action: "compliance.case_opened", resourceType: "compliance_case", resourceId: c.id, transactionId: input.transactionId, organizationId: input.organizationId, metadata: { category: input.category } });
  const participants = await ctx.writer.transaction_participants.find({ transactionId: input.transactionId });
  await notify(ctx, {
    userIds: participantUserIds(participants, ["escrow_officer", "attorney"]),
    transactionId: input.transactionId,
    kind: "status_update",
    title: "A compliance review needs your decision",
    body: `A ${input.category.replace(/_/g, " ")} review was opened and needs a human decision.`,
    linkPath: `/app/transactions/${input.transactionId}/compliance`,
  });
  return c;
}

export async function listComplianceCases(ctx: ServiceContext, transactionId: string) {
  const s = await loadAuthorized(ctx, transactionId, "compliance.review");
  const declarations = s.sourceOfFunds;
  return { snapshot: s, cases: s.complianceCases, declarations };
}

/** Human decision. The reviewer must hold compliance.review and cannot review their own case. */
export async function decideComplianceCase(ctx: ServiceContext, caseId: string, raw: unknown) {
  const actor = requireUser(ctx);
  const input = ComplianceDecisionInput.parse(raw);
  const c = await ctx.db.compliance_cases.get(caseId);
  if (!c || !c.transactionId) throw notFound("That review");
  const s = await loadAuthorized(ctx, c.transactionId, "compliance.review");
  if (c.status === "approved" || c.status === "rejected") throw conflict("This review has already been decided.");
  if (c.participantId && actorParticipantIds(actor, s).includes(c.participantId)) throw forbidden("You can't review your own case.");
  const now = nowIso(ctx);
  const updated = await ctx.writer.compliance_cases.update(caseId, {
    status: input.decision,
    reviewerId: actor.userId,
    notes: input.notes,
    decision: input.decision,
    decidedAt: now,
  });
  // A manual KYC/PEP approval completes the related identity verification.
  if (input.decision === "approved" && (c.category === "kyc" || c.category === "pep") && c.participantId) {
    const v = s.identityVerifications.find((x) => x.participantId === c.participantId && x.status === "review_required");
    if (v) {
      await ctx.writer.identity_verifications.update(v.id, { status: "verified", verifiedAt: now, failureReason: null });
      await completeTasksFor(ctx, c.transactionId, "verify_identity", c.participantId);
    }
  }
  if (c.category === "source_of_funds") {
    const d = s.sourceOfFunds.find((x) => x.complianceCaseId === c.id);
    if (d) await ctx.writer.source_of_funds_declarations.update(d.id, { status: input.decision });
  }
  await audit(ctx, {
    action: "compliance.decided",
    resourceType: "compliance_case",
    resourceId: caseId,
    transactionId: c.transactionId,
    organizationId: s.transaction.organizationId,
    metadata: { decision: input.decision, category: c.category, decidedBy: "human" },
  });
  await reconcile(ctx, c.transactionId);
  return updated;
}

export async function declareSourceOfFunds(ctx: ServiceContext, transactionId: string, raw: unknown) {
  const actor = requireUser(ctx);
  const input = SourceOfFundsInput.parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "transaction.view");
  const participant = s.participants.find((p) => p.userId === actor.userId && (p.role === "buyer" || p.role === "co_buyer"));
  if (!participant) throw forbidden("Only buyers declare the source of their funds.");
  assertCan(actor, "document.upload", accessContext(s));
  if (input.currency !== s.transaction.currency) throw badRequest(`Amounts on this transaction are in ${s.transaction.currency}.`);
  if (input.evidenceDocumentId && !s.documents.some((d) => d.id === input.evidenceDocumentId)) throw notFound("That supporting document");
  const c = await openComplianceCase(ctx, {
    transactionId,
    organizationId: s.transaction.organizationId,
    participantId: participant.id,
    category: "source_of_funds",
    reason: `Declared ${input.sourceType.replace(/_/g, " ")}`,
    provider: null,
    riskFlags: input.sourceType === "gift" ? ["gift_funds"] : [],
  });
  const now = nowIso(ctx);
  const d = await ctx.writer.source_of_funds_declarations.insert({
    id: newId(),
    transactionId,
    participantId: participant.id,
    sourceType: input.sourceType,
    amount: input.amount,
    currency: input.currency,
    description: input.description ?? null,
    evidenceDocumentId: input.evidenceDocumentId ?? null,
    status: "review_required",
    complianceCaseId: c.id,
    createdAt: now,
    updatedAt: now,
  });
  await audit(ctx, { action: "source_of_funds.declared", resourceType: "source_of_funds", resourceId: d.id, transactionId, organizationId: s.transaction.organizationId, metadata: { sourceType: input.sourceType } });
  await completeTasksFor(ctx, transactionId, "declare_source_of_funds", participant.id);
  await reconcile(ctx, transactionId);
  return d;
}
