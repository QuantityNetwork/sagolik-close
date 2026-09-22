/**
 * Financing, title, recording, ownership and calendar.
 *
 * Status updates for regulated parties come only from those parties (or their
 * provider integrations) — buyers can't mark their own loan approved, and
 * nobody can mark ownership transferred without a confirmed recording.
 */
import { assertCan } from "@sagolik/auth";
import {
  CalendarEventInput,
  type MortgageStatus,
  RecordingConfirmationInput,
  type TitleStatus,
} from "@sagolik/types";
import { getJurisdiction, recordingReadiness } from "@sagolik/workflow";
import { z } from "zod";
import { type ServiceContext, isUser, requireUser } from "../context";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { audit, emit } from "../events";
import { accessContext, actorParticipantIds, loadAuthorized } from "../snapshot";
import { newId, nowIso } from "../util";
import { reconcile } from "./engine";
import { postSystemMessage } from "./messaging";
import { notify, participantUserIds } from "./notifications";

// ----------------------------------------------------------------------------- mortgage

const MortgageUpdate = z.object({
  status: z.enum(["not_started", "application", "document_collection", "underwriting", "conditional_approval", "clear_to_close", "funded"]).optional(),
  appraisalStatus: z.enum(["not_ordered", "ordered", "scheduled", "completed", "issue"]).optional(),
  underwritingStatus: z.enum(["not_started", "in_review", "conditions", "approved", "denied"]).optional(),
  note: z.string().trim().max(500).optional(),
});

const OpenMortgageInput = z.object({
  lenderName: z.string().trim().min(2).max(200),
  loanAmount: z.number().int().positive(),
  loanType: z.string().trim().min(2).max(80),
  termMonths: z.number().int().min(12).max(600).optional(),
  interestRateBps: z.number().int().min(0).max(5000).optional(),
  externalReference: z.string().trim().max(80).optional(),
});

/** The lender opens the loan file on the transaction (or an LOS integration does). */
export async function openMortgage(ctx: ServiceContext, transactionId: string, raw: unknown) {
  const actor = requireUser(ctx);
  const input = OpenMortgageInput.parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "mortgage.update");
  if (s.mortgage) throw conflict("A loan is already on this transaction.");
  if (input.loanAmount >= s.transaction.salePrice) throw badRequest("The loan amount must be less than the purchase price.");
  const officer = s.participants.find((p) => p.userId === actor.userId && (p.role === "loan_officer" || p.role === "mortgage_processor"));
  const now = nowIso(ctx);
  const m = await ctx.writer.mortgages.insert({
    id: newId(),
    transactionId,
    lenderName: input.lenderName,
    loanOfficerParticipantId: officer?.id ?? null,
    loanAmount: input.loanAmount,
    currency: s.transaction.currency,
    interestRateBps: input.interestRateBps ?? null,
    termMonths: input.termMonths ?? null,
    loanType: input.loanType,
    ltvBps: Math.round((input.loanAmount / s.transaction.salePrice) * 10_000),
    status: "application",
    appraisalStatus: "not_ordered",
    underwritingStatus: "not_started",
    clearToCloseAt: null,
    fundedAt: null,
    provider: ctx.providers.mortgage.info.id,
    externalReference: input.externalReference ?? null,
    createdAt: now,
    updatedAt: now,
  });
  await audit(ctx, { action: "mortgage.status_changed", resourceType: "mortgage", resourceId: m.id, transactionId, organizationId: s.transaction.organizationId, metadata: { opened: true, lender: input.lenderName } });
  await postSystemMessage(ctx, transactionId, `${input.lenderName} opened the loan file.`, { type: "mortgage", id: m.id });
  await reconcile(ctx, transactionId);
  return m;
}

const MORTGAGE_LABEL: Record<MortgageStatus, string> = {
  not_started: "not started",
  application: "application received",
  document_collection: "collecting documents",
  underwriting: "in underwriting",
  conditional_approval: "conditionally approved",
  clear_to_close: "clear to close",
  funded: "funded",
};

export async function updateMortgage(ctx: ServiceContext, transactionId: string, raw: unknown) {
  const input = MortgageUpdate.parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "mortgage.update");
  const m = s.mortgage;
  if (!m) throw badRequest("There's no mortgage on this transaction.");
  if (input.status === "clear_to_close" && s.mortgageConditions.some((c) => !c.satisfied)) {
    throw badRequest("Satisfy every open loan condition before issuing Clear to Close.");
  }
  if (input.status === "funded" && m.status !== "clear_to_close") throw badRequest("A loan must be clear to close before it's funded.");
  const now = nowIso(ctx);
  const updated = await ctx.writer.mortgages.update(m.id, {
    ...(input.status ? { status: input.status } : {}),
    ...(input.appraisalStatus ? { appraisalStatus: input.appraisalStatus } : {}),
    ...(input.underwritingStatus ? { underwritingStatus: input.underwritingStatus } : {}),
    ...(input.status === "clear_to_close" ? { clearToCloseAt: now } : {}),
    ...(input.status === "funded" ? { fundedAt: now } : {}),
  });
  await audit(ctx, {
    action: "mortgage.status_changed",
    resourceType: "mortgage",
    resourceId: m.id,
    transactionId,
    organizationId: s.transaction.organizationId,
    metadata: { from: { status: m.status, appraisal: m.appraisalStatus, underwriting: m.underwritingStatus }, to: input },
  });
  if (input.status && input.status !== m.status) {
    await postSystemMessage(ctx, transactionId, `${m.lenderName}: loan is ${MORTGAGE_LABEL[input.status]}.${input.note ? ` ${input.note}` : ""}`, { type: "mortgage", id: m.id });
    if (input.status === "clear_to_close") {
      await emit(ctx, { type: "mortgage.clear_to_close", aggregateType: "mortgage", aggregateId: m.id, transactionId, idempotencyKey: `mortgage.clear_to_close:${m.id}` });
    }
  }
  await reconcile(ctx, transactionId);
  return updated;
}

export async function addMortgageCondition(ctx: ServiceContext, transactionId: string, description: string) {
  const s = await loadAuthorized(ctx, transactionId, "mortgage.update");
  if (!s.mortgage) throw badRequest("There's no mortgage on this transaction.");
  const text = z.string().trim().min(3).max(300).parse(description);
  const now = nowIso(ctx);
  const c = await ctx.writer.mortgage_conditions.insert({ id: newId(), mortgageId: s.mortgage.id, transactionId, description: text, satisfied: false, satisfiedAt: null, createdAt: now, updatedAt: now });
  await postSystemMessage(ctx, transactionId, `New loan condition from ${s.mortgage.lenderName}: ${text}`, { type: "mortgage_condition", id: c.id });
  await reconcile(ctx, transactionId);
  return c;
}

export async function satisfyMortgageCondition(ctx: ServiceContext, conditionId: string) {
  const c = await ctx.db.mortgage_conditions.get(conditionId);
  if (!c) throw notFound("That condition");
  const s = await loadAuthorized(ctx, c.transactionId, "mortgage.update");
  if (c.satisfied) return c;
  const updated = await ctx.writer.mortgage_conditions.update(conditionId, { satisfied: true, satisfiedAt: nowIso(ctx) });
  await audit(ctx, { action: "mortgage.condition_satisfied", resourceType: "mortgage_condition", resourceId: conditionId, transactionId: c.transactionId, organizationId: s.transaction.organizationId, metadata: { description: c.description } });
  await reconcile(ctx, c.transactionId);
  return updated;
}

// ----------------------------------------------------------------------------- title

/** The title officer opens the title order (search + insurance). */
export async function orderTitle(ctx: ServiceContext, transactionId: string, raw: unknown) {
  const input = z.object({ titleCompany: z.string().trim().min(2).max(200) }).parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "title.update");
  if (s.titleCase) throw conflict("Title has already been ordered.");
  const order = await ctx.providers.title.orderSearch({ parcelId: s.property.parcelId, address: `${s.property.addressLine1}, ${s.property.city}` });
  const now = nowIso(ctx);
  const t = await ctx.writer.title_cases.insert({
    id: newId(),
    transactionId,
    titleCompany: input.titleCompany,
    status: "searching",
    currentOwner: null,
    searchCompletedAt: null,
    clearedAt: null,
    insurancePolicyNumber: null,
    provider: ctx.providers.title.info.id,
    externalReference: order?.externalReference ?? null,
    createdAt: now,
    updatedAt: now,
  });
  await audit(ctx, { action: "title.status_changed", resourceType: "title_case", resourceId: t.id, transactionId, organizationId: s.transaction.organizationId, metadata: { opened: true } });
  await postSystemMessage(ctx, transactionId, `${input.titleCompany} started the title search.`, { type: "title_case", id: t.id });
  await reconcile(ctx, transactionId);
  return t;
}

const TitleUpdate = z.object({
  status: z.enum(["not_started", "searching", "issues_found", "curing", "clear", "insured"]),
  insurancePolicyNumber: z.string().trim().max(80).optional(),
  currentOwner: z.string().trim().max(200).optional(),
});

export async function updateTitle(ctx: ServiceContext, transactionId: string, raw: unknown) {
  const input = TitleUpdate.parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "title.update");
  const t = s.titleCase;
  if (!t) throw badRequest("Title hasn't been ordered yet.");
  const open = s.titleIssues.filter((i) => !i.resolved);
  if ((input.status === "clear" || input.status === "insured") && open.length) throw badRequest(`Resolve ${open.length} open title issue${open.length > 1 ? "s" : ""} first.`);
  if (input.status === "insured" && !input.insurancePolicyNumber && !t.insurancePolicyNumber) throw badRequest("Add the title insurance policy number.");
  const now = nowIso(ctx);
  const updated = await ctx.writer.title_cases.update(t.id, {
    status: input.status,
    ...(input.insurancePolicyNumber ? { insurancePolicyNumber: input.insurancePolicyNumber } : {}),
    ...(input.currentOwner ? { currentOwner: input.currentOwner } : {}),
    ...(input.status === "clear" && !t.clearedAt ? { clearedAt: now } : {}),
    ...(["issues_found", "curing", "clear", "insured"].includes(input.status) && !t.searchCompletedAt ? { searchCompletedAt: now } : {}),
  });
  await audit(ctx, { action: "title.status_changed", resourceType: "title_case", resourceId: t.id, transactionId, organizationId: s.transaction.organizationId, metadata: { from: t.status, to: input.status } });
  if (input.status !== t.status) {
    const label: Record<TitleStatus, string> = { not_started: "not started", searching: "searching", issues_found: "issues found", curing: "resolving issues", clear: "clear", insured: "clear and insured" };
    await postSystemMessage(ctx, transactionId, `${t.titleCompany}: title is ${label[input.status]}.`, { type: "title_case", id: t.id });
    if (input.status === "clear") await emit(ctx, { type: "title.cleared", aggregateType: "title_case", aggregateId: t.id, transactionId, idempotencyKey: `title.cleared:${t.id}` });
  }
  await reconcile(ctx, transactionId);
  return updated;
}

const IssueInput = z.object({
  kind: z.enum(["lien", "mortgage", "judgment", "easement", "encumbrance", "tax", "other"]),
  description: z.string().trim().min(3).max(500),
  amount: z.number().int().nonnegative().optional(),
});

export async function addTitleIssue(ctx: ServiceContext, transactionId: string, raw: unknown) {
  const input = IssueInput.parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "title.update");
  if (!s.titleCase) throw badRequest("Title hasn't been ordered yet.");
  const now = nowIso(ctx);
  const issue = await ctx.writer.title_issues.insert({ id: newId(), titleCaseId: s.titleCase.id, transactionId, kind: input.kind, description: input.description, amount: input.amount ?? null, resolved: false, resolvedAt: null, createdAt: now, updatedAt: now });
  if (s.titleCase.status === "clear" || s.titleCase.status === "insured" || s.titleCase.status === "searching") {
    await ctx.writer.title_cases.update(s.titleCase.id, { status: "issues_found" });
  }
  await audit(ctx, { action: "title.status_changed", resourceType: "title_issue", resourceId: issue.id, transactionId, organizationId: s.transaction.organizationId, metadata: { kind: input.kind } });
  await postSystemMessage(ctx, transactionId, `Title issue found (${input.kind}): ${input.description}`, { type: "title_issue", id: issue.id });
  await notify(ctx, {
    userIds: participantUserIds(s.participants, ["buyer", "co_buyer", "seller", "co_seller", "buyer_agent", "seller_agent", "escrow_officer"]),
    transactionId,
    kind: "title_issue",
    title: "A title issue needs to be resolved",
    body: `${s.titleCase.titleCompany} found a ${input.kind} that must be resolved before closing. Your title officer is on it.`,
    linkPath: `/app/transactions/${transactionId}/title`,
  });
  await reconcile(ctx, transactionId);
  return issue;
}

export async function resolveTitleIssue(ctx: ServiceContext, issueId: string) {
  const issue = await ctx.db.title_issues.get(issueId);
  if (!issue) throw notFound("That title issue");
  const s = await loadAuthorized(ctx, issue.transactionId, "title.update");
  if (issue.resolved) return issue;
  const updated = await ctx.writer.title_issues.update(issueId, { resolved: true, resolvedAt: nowIso(ctx) });
  await audit(ctx, { action: "title.issue_resolved", resourceType: "title_issue", resourceId: issueId, transactionId: issue.transactionId, organizationId: s.transaction.organizationId });
  await postSystemMessage(ctx, issue.transactionId, `Title issue resolved: ${issue.description}`, { type: "title_issue", id: issueId });
  await reconcile(ctx, issue.transactionId);
  return updated;
}

// ----------------------------------------------------------------------------- recording & ownership

export async function submitForRecording(ctx: ServiceContext, transactionId: string) {
  const actor = requireUser(ctx);
  const s = await loadAuthorized(ctx, transactionId, "recording.submit");
  if (!s.recording) throw badRequest("There's no recording record for this transaction.");
  if (s.recording.status !== "ready_for_recording") throw conflict("The deed isn't ready to be recorded yet.");
  const readiness = recordingReadiness(s);
  if (!readiness.ready) throw badRequest(`Not ready to record: ${readiness.items.filter((i) => !i.value).map((i) => i.detail).join(" ")}`);
  const deed = s.documents.find((d) => d.category === "deed" && d.signatureStatus === "completed");
  const updated = await ctx.writer.recordings.update(s.recording.id, { status: "submitted_for_recording", submittedAt: nowIso(ctx), submittedBy: actor.userId, documentId: deed?.id ?? null });
  await audit(ctx, { action: "recording.submitted", resourceType: "recording", resourceId: s.recording.id, transactionId, organizationId: s.transaction.organizationId, metadata: { registry: s.recording.registry, deed: deed?.id } });
  await emit(ctx, { type: "recording.submitted", aggregateType: "recording", aggregateId: s.recording.id, transactionId, idempotencyKey: `recording.submitted:${s.recording.id}` });
  await postSystemMessage(ctx, transactionId, `The deed was submitted to ${s.recording.registry} for recording.`, { type: "recording", id: s.recording.id });
  await reconcile(ctx, transactionId);
  return updated;
}

/**
 * Authorized-professional confirmation of a completed recording. Requires the
 * registry reference, the recording date and an explicit attestation. When a
 * registry API is integrated, `confirmationSource` becomes "registry_api".
 */
export async function confirmRecording(ctx: ServiceContext, transactionId: string, raw: unknown) {
  const actor = requireUser(ctx);
  const input = RecordingConfirmationInput.parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "recording.confirm");
  const j = getJurisdiction(s.transaction.jurisdiction);
  const myRoles = s.participants.filter((p) => p.userId === actor.userId && p.status !== "removed").map((p) => p.role);
  if (!myRoles.some((r) => j.recording.confirmingRoles.includes(r))) {
    throw forbidden(`In ${j.name}, recording is confirmed by: ${j.recording.confirmingRoles.map((r) => r.replace(/_/g, " ")).join(", ")}.`);
  }
  if (!s.recording || s.recording.status !== "submitted_for_recording") throw conflict("The deed hasn't been submitted for recording.");
  if (new Date(input.recordedAt).getTime() > ctx.now().getTime() + 60_000) throw badRequest("The recording date can't be in the future.");
  const updated = await ctx.writer.recordings.update(s.recording.id, {
    status: "recorded",
    registry: input.registry,
    recordingReference: input.recordingReference,
    recordedAt: new Date(input.recordedAt).toISOString(),
    confirmationSource: "authorized_professional",
    confirmedBy: actor.userId,
  });
  await audit(ctx, {
    action: "ownership.recorded",
    resourceType: "recording",
    resourceId: s.recording.id,
    transactionId,
    organizationId: s.transaction.organizationId,
    metadata: { reference: input.recordingReference, registry: input.registry, recordedAt: input.recordedAt, attested: true, confirmationSource: "authorized_professional" },
  });
  await reconcile(ctx, transactionId);
  return updated;
}

/** Reaction to ownership.transferred: build the permanent Home Record. Idempotent. */
export async function createOwnershipRecord(ctx: ServiceContext, transactionId: string) {
  const existing = await ctx.writer.ownership_records.findOne({ transactionId });
  if (existing) return existing;
  const tx = await ctx.writer.transactions.get(transactionId);
  const recording = await ctx.writer.recordings.findOne({ transactionId });
  if (!tx || !recording || recording.status !== "recorded") throw new Error("ownership record requires a confirmed recording");
  const buyers = (await ctx.writer.transaction_participants.find({ transactionId, role: ["buyer", "co_buyer"] })).filter((p) => p.status !== "removed");
  const now = nowIso(ctx);
  const record = await ctx.writer.ownership_records.insert({
    id: newId(),
    transactionId,
    propertyId: tx.propertyId,
    ownerUserIds: buyers.filter((b) => b.userId).map((b) => b.userId!),
    ownerNames: buyers.map((b) => b.displayName),
    purchaseDate: (recording.recordedAt ?? now).slice(0, 10),
    purchaseAmount: tx.salePrice,
    currency: tx.currency,
    recordingId: recording.id,
    createdAt: now,
    updatedAt: now,
  });
  const signed = await ctx.writer.document_versions.find({ transactionId, isSigned: true });
  const docs = await ctx.writer.documents.find({ transactionId });
  for (const v of signed) {
    const d = docs.find((x) => x.id === v.documentId);
    if (!d) continue;
    await ctx.writer.ownership_record_items.insert({ id: newId(), ownershipRecordId: record.id, kind: "signed_document", title: `${d.name} (signed v${v.version})`, amount: null, occurredOn: v.createdAt.slice(0, 10), documentId: d.id, createdBy: null, createdAt: now });
  }
  const mortgage = await ctx.writer.mortgages.findOne({ transactionId });
  if (mortgage) {
    await ctx.writer.ownership_record_items.insert({ id: newId(), ownershipRecordId: record.id, kind: "mortgage", title: `${mortgage.lenderName} — ${mortgage.loanType}`, amount: mortgage.loanAmount, occurredOn: (mortgage.fundedAt ?? now).slice(0, 10), documentId: null, createdBy: null, createdAt: now });
  }
  await audit(ctx, { action: "ownership.record_created", resourceType: "ownership_record", resourceId: record.id, transactionId, organizationId: tx.organizationId });
  const participants = await ctx.writer.transaction_participants.find({ transactionId });
  await notify(ctx, {
    userIds: participantUserIds(participants),
    transactionId,
    kind: "ownership_transferred",
    title: "Ownership transferred",
    body: `The registry confirmed the recording (ref ${recording.recordingReference}). ${buyers.map((b) => b.displayName).join(" and ")} ${buyers.length > 1 ? "are" : "is"} now the legal owner${buyers.length > 1 ? "s" : ""}.`,
    linkPath: `/app/ownership/${record.id}`,
  });
  return record;
}

export async function getOwnershipBook(ctx: ServiceContext, recordId: string) {
  const actor = requireUser(ctx);
  const record = await ctx.db.ownership_records.get(recordId);
  if (!record) throw notFound("That home record");
  if (!record.ownerUserIds.includes(actor.userId)) await loadAuthorized(ctx, record.transactionId, "transaction.view");
  const [property, items, tx, recording] = await Promise.all([
    ctx.db.properties.get(record.propertyId),
    ctx.db.ownership_record_items.find({ ownershipRecordId: recordId }, { orderBy: "createdAt" }),
    ctx.db.transactions.get(record.transactionId),
    ctx.db.recordings.get(record.recordingId),
  ]);
  return { record, property, items, transaction: tx, recording };
}

export async function myOwnershipRecords(ctx: ServiceContext) {
  const actor = requireUser(ctx);
  const all = await ctx.db.ownership_records.find({}, { orderBy: "purchaseDate", ascending: false });
  return all.filter((r) => r.ownerUserIds.includes(actor.userId));
}

const OwnershipItemInput = z.object({
  kind: z.enum(["warranty", "renovation", "receipt", "maintenance", "tax", "insurance"]),
  title: z.string().trim().min(2).max(200),
  amount: z.number().int().nonnegative().optional(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function addOwnershipItem(ctx: ServiceContext, recordId: string, raw: unknown) {
  const actor = requireUser(ctx);
  const input = OwnershipItemInput.parse(raw);
  const record = await ctx.db.ownership_records.get(recordId);
  if (!record || !record.ownerUserIds.includes(actor.userId)) throw notFound("That home record");
  return ctx.writer.ownership_record_items.insert({
    id: newId(),
    ownershipRecordId: recordId,
    kind: input.kind,
    title: input.title,
    amount: input.amount ?? null,
    occurredOn: input.occurredOn ?? null,
    documentId: null,
    createdBy: actor.userId,
    createdAt: nowIso(ctx),
  });
}

// ----------------------------------------------------------------------------- calendar

export async function addCalendarEvent(ctx: ServiceContext, transactionId: string, raw: unknown) {
  const actor = requireUser(ctx);
  const input = CalendarEventInput.parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "transaction.view");
  const access = accessContext(s);
  if (!(isUser(ctx.actor) && (actorParticipantIds(actor, s).length > 0))) throw forbidden();
  assertCan(actor, "task.complete_own", access);
  const now = nowIso(ctx);
  const ev = await ctx.writer.calendar_events.insert({
    id: newId(),
    transactionId,
    kind: input.kind,
    title: input.title,
    startsAt: new Date(input.startsAt).toISOString(),
    endsAt: input.endsAt ? new Date(input.endsAt).toISOString() : null,
    location: input.location ?? null,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  });
  await audit(ctx, { action: "calendar.event_created", resourceType: "calendar_event", resourceId: ev.id, transactionId, organizationId: s.transaction.organizationId });
  await postSystemMessage(ctx, transactionId, `${actor.displayName} scheduled: ${ev.title} on ${ev.startsAt.slice(0, 10)}.`, { type: "calendar_event", id: ev.id });
  return ev;
}

export async function listCalendar(ctx: ServiceContext, transactionId: string) {
  const s = await loadAuthorized(ctx, transactionId, "transaction.view");
  const events = await ctx.db.calendar_events.find({ transactionId }, { orderBy: "startsAt" });
  // Deadlines from milestones and the closing date are part of the calendar too.
  const derived = [
    ...(s.transaction.expectedClosingDate
      ? [{ id: `closing-${s.transaction.id}`, kind: "closing" as const, title: "Closing", startsAt: `${s.transaction.expectedClosingDate}T17:00:00.000Z`, endsAt: null, location: null }]
      : []),
    ...s.tasks
      .filter((t) => t.dueDate && t.status !== "complete" && t.status !== "waived")
      .map((t) => ({ id: `task-${t.id}`, kind: "document_deadline" as const, title: `Due: ${t.title}`, startsAt: `${t.dueDate}T17:00:00.000Z`, endsAt: null, location: null })),
  ];
  return { snapshot: s, events: [...events, ...derived].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) };
}

function icsEscape(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
const icsDate = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export async function exportCalendarIcs(ctx: ServiceContext, transactionId: string): Promise<string> {
  const { snapshot, events } = await listCalendar(ctx, transactionId);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sagolik//Sagolik Close//EN", "CALSCALE:GREGORIAN"];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@close.sagolik.com`,
      `DTSTAMP:${icsDate(nowIso(ctx))}`,
      `DTSTART:${icsDate(e.startsAt)}`,
      ...(e.endsAt ? [`DTEND:${icsDate(e.endsAt)}`] : []),
      `SUMMARY:${icsEscape(`${e.title} — ${snapshot.property.addressLine1}`)}`,
      ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
