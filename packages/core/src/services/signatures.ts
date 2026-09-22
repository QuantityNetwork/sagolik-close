/**
 * E-signatures. Sagolik prepares the envelope and owns the record; the
 * provider runs the signing ceremony. Completion arrives by verified webhook,
 * and the signed PDF + certificate are stored as a NEW immutable version.
 */
import { assertCan, assertStepUp, can } from "@sagolik/auth";
import { sha256Hex } from "@sagolik/security";
import { type DocumentSignature, type SignatureRecipient, type SignatureStatus, SignatureRequestInput } from "@sagolik/types";
import { type ServiceContext, isUser, requireUser } from "../context";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { audit, emit } from "../events";
import { accessContext, actorParticipantIds, loadAuthorized, loadSnapshot } from "../snapshot";
import { objectKey } from "../storage";
import { newId, nowIso } from "../util";
import { applyTransition, reconcile } from "./engine";
import { postSystemMessage } from "./messaging";
import { notify } from "./notifications";
import { createTaskRow } from "./transactions";

const CLOSING_CATEGORIES = new Set(["closing_statement", "deed"]);

export async function requestSignatures(ctx: ServiceContext, documentId: string, raw: unknown): Promise<DocumentSignature> {
  const actor = requireUser(ctx);
  const input = SignatureRequestInput.parse(raw);
  const doc = await ctx.db.documents.get(documentId);
  if (!doc) throw notFound("That document");
  const s = await loadAuthorized(ctx, doc.transactionId, "signature.request");
  if (["sent", "viewed", "signed"].includes(doc.signatureStatus)) throw conflict("This document is already out for signature.");
  if (doc.signatureStatus === "completed") throw conflict("This version is already fully signed. Upload a new version to sign again.");

  const signers = input.signerParticipantIds.map((id) => {
    const p = s.participants.find((x) => x.id === id && x.status !== "removed");
    if (!p) throw badRequest("Every signer must be a participant on this transaction.");
    return p;
  });
  const version = await ctx.db.document_versions.findOne({ documentId, version: doc.currentVersion });
  if (!version) throw notFound("That document version");

  const provider = ctx.providers.signatures;
  const { externalEnvelopeId } = await provider.createEnvelope({ documentName: doc.name, documentSha256: version.sha256, message: input.message });
  await provider.addRecipients(
    externalEnvelopeId,
    signers.map((p, i) => ({ recipientId: p.id, name: p.displayName, email: p.email, routingOrder: i + 1 })),
  );
  await provider.addFields(externalEnvelopeId, signers.map((p) => ({ recipientId: p.id, page: 1, x: 72, y: 700, kind: "signature" as const })));
  await provider.send(externalEnvelopeId);

  const now = nowIso(ctx);
  const recipients: SignatureRecipient[] = signers.map((p) => ({ participantId: p.id, name: p.displayName, email: p.email, status: "sent", signedAt: null }));
  const sig = await ctx.writer.document_signatures.insert({
    id: newId(),
    documentId,
    transactionId: s.transaction.id,
    documentVersion: doc.currentVersion,
    provider: provider.info.id,
    externalEnvelopeId,
    status: "sent",
    requestedBy: actor.userId,
    recipients,
    sentAt: now,
    completedAt: null,
    certificatePath: null,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.writer.documents.update(documentId, { signatureStatus: "sent" });

  for (const p of signers) {
    await createTaskRow(ctx, s.transaction.id, {
      title: `Review and sign ${doc.name}`,
      description: input.message ?? `Please review ${doc.name} and add your signature.`,
      assigneeParticipantId: p.id,
      actionKind: "sign_document",
      milestoneKey: doc.category === "purchase_agreement" ? "offer_accepted" : "signing_complete",
      priority: CLOSING_CATEGORIES.has(doc.category) ? "urgent" : "high",
      estimatedMinutes: 3,
      relatedEntityType: "document_signature",
      relatedEntityId: sig.id,
    });
  }
  await audit(ctx, {
    action: "signature.requested",
    resourceType: "document",
    resourceId: documentId,
    transactionId: s.transaction.id,
    organizationId: s.transaction.organizationId,
    metadata: { envelope: externalEnvelopeId, provider: provider.info.id, signers: signers.map((p) => p.id), version: doc.currentVersion },
  });
  await emit(ctx, { type: "signature.requested", aggregateType: "document", aggregateId: documentId, transactionId: s.transaction.id, payload: { signatureId: sig.id } });
  await postSystemMessage(ctx, s.transaction.id, `${doc.name} v${doc.currentVersion} was sent for signature to ${signers.map((p) => p.displayName).join(", ")}.`, { type: "document", id: documentId });
  await notify(ctx, {
    userIds: signers.filter((p) => p.userId).map((p) => p.userId!),
    transactionId: s.transaction.id,
    kind: "signature_requested",
    title: `${doc.name} is ready for your signature`,
    body: `Please review and sign ${doc.name}. It takes about three minutes.`,
    linkPath: `/app/transactions/${s.transaction.id}/documents`,
  });

  // Sending the closing package starts the signing stage.
  if (CLOSING_CATEGORIES.has(doc.category) && s.transaction.state === "ready_for_signing") {
    const fresh = await loadSnapshot(ctx, s.transaction.id, ctx.writer);
    if (fresh && can(actor, "transaction.transition", accessContext(fresh))) {
      await applyTransition(ctx, fresh, "signing", `${doc.name} sent for signature.`, "user");
    }
  }
  await reconcile(ctx, s.transaction.id);
  return sig;
}

/** Hosted signing session for the current person on one envelope. */
export async function startSigning(ctx: ServiceContext, signatureId: string, returnUrl: string): Promise<string> {
  const actor = requireUser(ctx);
  const sig = await ctx.db.document_signatures.get(signatureId);
  if (!sig) throw notFound("That signing request");
  const s = await loadAuthorized(ctx, sig.transactionId, "transaction.view");
  const mine = actorParticipantIds(actor, s);
  const recipient = sig.recipients.find((r) => mine.includes(r.participantId));
  if (!recipient) throw forbidden("You're not a signer on this document.");
  assertCan(actor, "signature.sign", accessContext(s));
  const doc = s.documents.find((d) => d.id === sig.documentId);
  if (doc && CLOSING_CATEGORIES.has(doc.category)) assertStepUp(actor, "signature.sign_closing_document", ctx.now().getTime());
  if (recipient.status === "signed") throw conflict("You've already signed this document.");
  return ctx.providers.signatures.signingUrl(sig.externalEnvelopeId, recipient.participantId, returnUrl);
}

/** Webhook handler (system actor). */
export async function handleSignatureEvent(ctx: ServiceContext, eventType: string, data: Record<string, unknown>) {
  const envelopeId = String(data.externalEnvelopeId ?? "");
  const sig = await ctx.writer.document_signatures.findOne({ externalEnvelopeId: envelopeId });
  if (!sig) throw new Error(`unknown envelope ${envelopeId}`);
  const doc = await ctx.writer.documents.get(sig.documentId);
  if (!doc) throw new Error(`document missing for envelope ${envelopeId}`);
  const tx = await ctx.writer.transactions.get(sig.transactionId);
  // Re-read authoritative state from the provider rather than trusting the payload.
  const status = await ctx.providers.signatures.getStatus(envelopeId);
  const recipients = sig.recipients.map((r) => {
    const live = status.recipients.find((x) => x.recipientId === r.participantId);
    return live ? { ...r, status: live.status, signedAt: live.signedAt } : r;
  });

  if (eventType === "recipient.signed") {
    const participantId = String(data.recipientId ?? "");
    await ctx.writer.document_signatures.update(sig.id, { recipients, status: "viewed" });
    if (doc.signatureStatus !== "completed") await ctx.writer.documents.update(doc.id, { signatureStatus: "signed" });
    const open = await ctx.writer.tasks.find({ transactionId: sig.transactionId, actionKind: "sign_document", relatedEntityId: sig.id, assigneeParticipantId: participantId });
    for (const t of open) if (t.status !== "complete") await ctx.writer.tasks.update(t.id, { status: "complete", completedAt: nowIso(ctx) });
    const who = recipients.find((r) => r.participantId === participantId);
    await postSystemMessage(ctx, sig.transactionId, `${who?.name ?? "A signer"} signed ${doc.name}.`, { type: "document", id: doc.id });
  } else if (eventType === "envelope.completed") {
    if (sig.status === "completed") return;
    const { bytes, certificate } = await ctx.providers.signatures.downloadCompletedDocument(envelopeId);
    const sha = sha256Hex(bytes);
    const version = doc.currentVersion + 1;
    const key = objectKey(sig.transactionId, doc.id, version, sha);
    await ctx.storage.put(key, bytes, "application/pdf");
    const certKey = `${key}-certificate`;
    await ctx.storage.put(certKey, certificate, "application/pdf");
    await ctx.writer.document_versions.insert({
      id: newId(),
      documentId: doc.id,
      transactionId: sig.transactionId,
      version,
      storagePath: key,
      mimeType: "application/pdf",
      sizeBytes: bytes.length,
      sha256: sha,
      uploadedBy: null,
      scanStatus: "clean",
      extractedFields: [],
      isSigned: true,
      createdAt: nowIso(ctx),
    });
    await ctx.writer.documents.update(doc.id, { currentVersion: version, signatureStatus: "completed", status: "approved" });
    await ctx.writer.document_signatures.update(sig.id, { recipients, status: "completed", completedAt: nowIso(ctx), certificatePath: certKey });
    for (const t of await ctx.writer.tasks.find({ transactionId: sig.transactionId, actionKind: "sign_document", relatedEntityId: sig.id })) {
      if (t.status !== "complete") await ctx.writer.tasks.update(t.id, { status: "complete", completedAt: nowIso(ctx) });
    }
    await audit(ctx, {
      action: "signature.completed",
      resourceType: "document",
      resourceId: doc.id,
      transactionId: sig.transactionId,
      organizationId: tx?.organizationId ?? null,
      metadata: { envelope: envelopeId, signedVersion: version, sha256: sha },
    });
    await emit(ctx, { type: "document.signed", aggregateType: "document", aggregateId: doc.id, transactionId: sig.transactionId, idempotencyKey: `document.signed:${sig.id}` });
    await postSystemMessage(ctx, sig.transactionId, `${doc.name} is fully signed. The signed copy is saved as v${version}.`, { type: "document", id: doc.id });
  } else if (eventType === "envelope.declined") {
    const who = recipients.find((r) => r.participantId === String(data.recipientId ?? ""));
    await ctx.writer.document_signatures.update(sig.id, { recipients, status: "declined" });
    await ctx.writer.documents.update(doc.id, { signatureStatus: "declined", status: "needs_attention" });
    await audit(ctx, { action: "signature.declined", resourceType: "document", resourceId: doc.id, transactionId: sig.transactionId, organizationId: tx?.organizationId ?? null });
    await postSystemMessage(ctx, sig.transactionId, `${who?.name ?? "A signer"} declined to sign ${doc.name}.`, { type: "document", id: doc.id });
    await notify(ctx, {
      userIds: [sig.requestedBy],
      transactionId: sig.transactionId,
      kind: "signature_requested",
      title: `${doc.name} was declined`,
      body: `${who?.name ?? "A signer"} declined to sign ${doc.name}. Follow up with them in the transaction room.`,
      linkPath: `/app/transactions/${sig.transactionId}/documents`,
    });
  } else if (eventType === "envelope.sent") {
    // Already reflected when we sent it.
  }
  await reconcile(ctx, sig.transactionId);
}

export function signatureStatusLabel(status: SignatureStatus): string {
  return {
    not_required: "No signature needed",
    draft: "Not sent yet",
    sent: "Waiting for signatures",
    viewed: "Partly signed",
    signed: "Partly signed",
    declined: "Declined",
    expired: "Expired",
    completed: "Fully signed",
  }[status];
}

export function isActorSystem(ctx: ServiceContext) {
  return !isUser(ctx.actor);
}
