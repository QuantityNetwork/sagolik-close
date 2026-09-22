/**
 * Document vault.
 *
 * Upload pipeline:
 *   1 virus scan → 2 MIME verification (magic bytes) → 3 SHA-256 →
 *   4 immutable content-addressed storage → 5/6/7 text layer, classification,
 *   metadata extraction → 8 suggestions only → 9 human verification.
 *
 * Signed versions are never overwritten: every change is a new version row
 * (append-only table) with its own hash.
 */
import { assertCan, canViewDocument } from "@sagolik/auth";
import { checkUpload, MockVirusScanner, sha256Hex, type VirusScanner } from "@sagolik/security";
import {
  type AccessLevel,
  type Document,
  type DocumentCategory,
  type DocumentVersion,
  RegisterDocumentInput,
} from "@sagolik/types";
import type { TransactionSnapshot } from "@sagolik/workflow";
import { type ServiceContext, isUser, requireUser } from "../context";
import { AppError, badRequest, conflict, notFound } from "../errors";
import { audit, emit } from "../events";
import { accessContext, loadAuthorized } from "../snapshot";
import { objectKey } from "../storage";
import { newId, nowIso } from "../util";
import { reconcile } from "./engine";
import { RuleBasedExtractor, type DocumentExtractor } from "./extraction";
import { postSystemMessage } from "./messaging";
import { completeTasksFor } from "./transactions";

let scanner: VirusScanner = new MockVirusScanner();
let extractor: DocumentExtractor = new RuleBasedExtractor();
export function configureDocumentPipeline(opts: { scanner?: VirusScanner; extractor?: DocumentExtractor }) {
  if (opts.scanner) scanner = opts.scanner;
  if (opts.extractor) extractor = opts.extractor;
}

const UPLOAD_REJECTIONS: Record<string, string> = {
  too_large: "That file is larger than 25 MB. Please upload a smaller copy.",
  empty: "That file is empty.",
  unsupported_type: "We accept PDF, Word (.docx), PNG, JPEG, WebP and HEIC files.",
  active_content: "This PDF contains scripts or embedded files, which we don't accept for security reasons. Please export it again as a plain PDF.",
};

export interface UploadInput {
  transactionId: string;
  documentId?: string;
  name: string;
  category: DocumentCategory;
  accessLevel?: AccessLevel;
  filename: string;
  bytes: Uint8Array;
}

export async function uploadDocument(ctx: ServiceContext, input: UploadInput): Promise<{ document: Document; version: DocumentVersion }> {
  const meta = RegisterDocumentInput.parse({
    transactionId: input.transactionId,
    documentId: input.documentId,
    name: input.name,
    category: input.category,
    accessLevel: input.accessLevel,
  });
  const s = await loadAuthorized(ctx, meta.transactionId, "document.upload");
  const uploaderId = isUser(ctx.actor) ? ctx.actor.userId : null;

  // 2. MIME verification + structural checks (never trust the declared type)
  const check = checkUpload(input.bytes, input.filename);
  if (!check.ok) throw badRequest(UPLOAD_REJECTIONS[check.reason] ?? "That file can't be accepted.");

  // 1. virus scan
  const scan = await scanner.scan(input.bytes);
  if (!scan.clean) {
    await audit(ctx, {
      action: "document.quarantined",
      resourceType: "document",
      transactionId: s.transaction.id,
      organizationId: s.transaction.organizationId,
      metadata: { filename: check.safeName, signature: scan.signature },
    });
    throw badRequest("This file failed our security scan and was not stored.");
  }

  // 3. hash
  const sha256 = sha256Hex(input.bytes);

  let existing: Document | null = null;
  if (meta.documentId) {
    existing = s.documents.find((d) => d.id === meta.documentId) ?? null;
    if (!existing) throw notFound("That document");
    if (isUser(ctx.actor) && !canViewDocument(ctx.actor, accessContext(s), existing)) throw notFound("That document");
    const versions = await ctx.db.document_versions.find({ documentId: existing.id });
    if (versions.some((v) => v.sha256 === sha256)) throw conflict("This exact file is already in the vault.");
  }

  const now = nowIso(ctx);
  const documentId = existing?.id ?? newId();
  const version = (existing?.currentVersion ?? 0) + 1;
  const key = objectKey(s.transaction.id, documentId, version, sha256);

  // 4. store (content-addressed; keys are never reused)
  await ctx.storage.put(key, input.bytes, check.mime);

  // 5–8. text layer, classification, extraction → suggestions only
  const extracted = await extractor.extract({ bytes: input.bytes, mimeType: check.mime, filename: check.safeName });

  let document: Document;
  if (existing) {
    document = await ctx.writer.documents.update(existing.id, {
      currentVersion: version,
      status: "pending_review",
      // A new version needs fresh signatures if the previous one required them.
      signatureStatus: existing.signatureStatus === "not_required" ? "not_required" : "draft",
    });
  } else {
    document = await ctx.writer.documents.insert({
      id: documentId,
      transactionId: s.transaction.id,
      name: meta.name,
      category: meta.category,
      currentVersion: version,
      status: "pending_review",
      signatureStatus: "not_required",
      accessLevel: meta.category === "identity" ? "restricted" : meta.accessLevel,
      retentionPolicy: meta.category === "identity" ? "identity_minimum" : "transaction_plus_10y",
      uploadedBy: uploaderId,
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  const versionRow = await ctx.writer.document_versions.insert({
    id: newId(),
    documentId,
    transactionId: s.transaction.id,
    version,
    storagePath: key,
    mimeType: check.mime,
    sizeBytes: input.bytes.length,
    sha256,
    uploadedBy: uploaderId,
    scanStatus: "clean",
    extractedFields: [
      ...(extracted.suggestedCategory && extracted.suggestedCategory !== meta.category
        ? [{ key: "suggested_category", value: extracted.suggestedCategory, confidence: 0.6, verified: false }]
        : []),
      ...extracted.fields,
    ],
    isSigned: false,
    createdAt: now,
  });

  await audit(ctx, {
    action: existing ? "document.version_added" : "document.uploaded",
    resourceType: "document",
    resourceId: documentId,
    transactionId: s.transaction.id,
    organizationId: s.transaction.organizationId,
    metadata: { version, sha256, category: document.category, sizeBytes: input.bytes.length },
  });
  await emit(ctx, { type: "document.uploaded", aggregateType: "document", aggregateId: documentId, transactionId: s.transaction.id, payload: { version } });
  await postSystemMessage(ctx, s.transaction.id, `${document.name} v${version} was added to the vault.`, { type: "document", id: documentId });
  // Upload tasks complete when the matching document arrives (not when anything is uploaded).
  const satisfied = s.tasks.filter(
    (t) =>
      t.actionKind === "upload_document" &&
      !["complete", "waived"].includes(t.status) &&
      (t.requiredEvidence === document.category || (t.milestoneKey === "offer_accepted" && document.category === "purchase_agreement")),
  );
  for (const t of satisfied) {
    await ctx.writer.tasks.update(t.id, { status: "complete", completedAt: now, completedBy: uploaderId, relatedEntityType: "document", relatedEntityId: documentId });
  }
  await reconcile(ctx, s.transaction.id);
  return { document, version: versionRow };
}

export function visibleDocuments(ctx: ServiceContext, s: TransactionSnapshot): Document[] {
  if (!isUser(ctx.actor)) return s.documents;
  const actor = ctx.actor;
  const access = accessContext(s);
  return s.documents.filter((d) => canViewDocument(actor, access, d));
}

export async function listDocuments(ctx: ServiceContext, transactionId: string) {
  const s = await loadAuthorized(ctx, transactionId, "document.view");
  const docs = visibleDocuments(ctx, s);
  const versions = docs.length ? await ctx.db.document_versions.find({ documentId: docs.map((d) => d.id) }, { orderBy: "version", ascending: false }) : [];
  return { snapshot: s, documents: docs.map((d) => ({ document: d, versions: versions.filter((v) => v.documentId === d.id) })) };
}

async function authorizedDocument(ctx: ServiceContext, documentId: string) {
  const doc = await ctx.db.documents.get(documentId);
  if (!doc) throw notFound("That document");
  const s = await loadAuthorized(ctx, doc.transactionId, "document.view");
  if (isUser(ctx.actor) && !canViewDocument(ctx.actor, accessContext(s), doc)) throw notFound("That document");
  return { doc, s };
}

/** Authorize + audit a download. Returns a signed URL, or the bytes to stream. */
export async function openDocument(ctx: ServiceContext, documentId: string, version?: number) {
  const { doc, s } = await authorizedDocument(ctx, documentId);
  const v = await ctx.db.document_versions.findOne({ documentId, version: version ?? doc.currentVersion });
  if (!v) throw notFound("That version");
  if (v.scanStatus !== "clean") throw new AppError("forbidden", "This file is quarantined.", 403);
  await audit(ctx, {
    action: "document.downloaded",
    resourceType: "document",
    resourceId: documentId,
    transactionId: s.transaction.id,
    organizationId: s.transaction.organizationId,
    metadata: { version: v.version, sha256: v.sha256 },
  });
  const filename = `${doc.name.replace(/[^\w .-]/g, "_")} v${v.version}${v.mimeType === "application/pdf" ? ".pdf" : ""}`;
  const url = await ctx.storage.signedUrl(v.storagePath, 60, filename);
  if (url) return { kind: "redirect" as const, url };
  const bytes = await ctx.storage.get(v.storagePath);
  if (!bytes) throw notFound("That file");
  if (sha256Hex(bytes) !== v.sha256) {
    ctx.log.error("document integrity check failed", { documentId, version: v.version });
    throw new AppError("internal", "This file failed an integrity check and can't be opened. Our team has been alerted.", 500);
  }
  return { kind: "bytes" as const, bytes, mimeType: v.mimeType, filename };
}

export async function reviewDocument(ctx: ServiceContext, documentId: string, decision: "approved" | "rejected" | "needs_attention", note?: string) {
  const { doc, s } = await authorizedDocument(ctx, documentId);
  const actor = requireUser(ctx);
  assertCan(actor, "document.approve", accessContext(s));
  const updated = await ctx.writer.documents.update(documentId, { status: decision });
  await audit(ctx, {
    action: decision === "approved" ? "document.approved" : "document.rejected",
    resourceType: "document",
    resourceId: documentId,
    transactionId: s.transaction.id,
    organizationId: s.transaction.organizationId,
    metadata: { decision, note: note ?? null, version: doc.currentVersion },
  });
  const verb = decision === "approved" ? "approved" : decision === "rejected" ? "rejected" : "flagged for attention";
  await postSystemMessage(ctx, s.transaction.id, `${doc.name} v${doc.currentVersion} was ${verb} by ${actor.displayName}${note ? `: “${note}”` : "."}`, { type: "document", id: documentId });
  await completeTasksFor(ctx, s.transaction.id, "review_document", null, documentId);
  if (decision === "approved" && doc.category === "closing_statement") await completeTasksFor(ctx, s.transaction.id, "approve_statement", null, documentId);
  await reconcile(ctx, s.transaction.id);
  return updated;
}

/** Confirm (or correct) an AI/rule-extracted value. Creates no new version; recorded in the audit trail. */
export async function verifyExtractedField(ctx: ServiceContext, documentId: string, key: string, value: string) {
  const { doc, s } = await authorizedDocument(ctx, documentId);
  requireUser(ctx);
  await audit(ctx, {
    action: "document.field_verified",
    resourceType: "document_field",
    resourceId: documentId,
    transactionId: s.transaction.id,
    organizationId: s.transaction.organizationId,
    metadata: { field: key, value, version: doc.currentVersion, verification: "human" },
  });
}
