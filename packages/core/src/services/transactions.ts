import { type Actor, assertCan, can, isOrgAdmin, isPrincipal } from "@sagolik/auth";
import { isFlagEnabled } from "@sagolik/config";
import {
  type CreateTransactionInput,
  CreateTransactionInput as CreateSchema,
  type ParticipantRole,
  type Task,
  type TaskActionKind,
  type Transaction,
  type TransitionInput,
  TransitionInput as TransitionSchema,
  type UpdateTransactionInput,
  UpdateTransactionInput as UpdateSchema,
  type InviteParticipantInput,
  InviteParticipantInput as InviteSchema,
  type CreateTaskInput,
  CreateTaskInput as CreateTaskSchema,
  type UpdateTaskStatusInput,
  UpdateTaskStatusInput as TaskStatusSchema,
  type MilestoneKey,
} from "@sagolik/types";
import { dealSubject, findTransition, getJurisdiction, isTerminal, type TransactionSnapshot } from "@sagolik/workflow";
import { type ServiceContext, requireUser } from "../context";
import { AppError, badRequest, conflict, forbidden, notFound } from "../errors";
import { audit, emit } from "../events";
import { accessContext, actorParticipantIds, loadAuthorized, loadSnapshot } from "../snapshot";
import { newId, nowIso, transactionReference } from "../util";
import { applyTransition, reconcile } from "./engine";
import { ensureTransactionRoom, postSystemMessage } from "./messaging";
import { notify } from "./notifications";

const MILESTONE_OWNERS: Record<MilestoneKey, ParticipantRole> = {
  offer_accepted: "buyer_agent",
  transaction_opened: "transaction_coordinator",
  identity_verified: "buyer",
  documents_received: "transaction_coordinator",
  financing_approved: "loan_officer",
  inspection_completed: "buyer_agent",
  title_cleared: "title_officer",
  signing_complete: "escrow_officer",
  funds_received: "buyer",
  recording_submitted: "title_officer",
  ownership_transferred: "title_officer",
};

const BUSINESS_MILESTONE_OWNERS: Record<MilestoneKey, ParticipantRole> = {
  offer_accepted: "broker",
  transaction_opened: "broker",
  identity_verified: "buyer",
  documents_received: "broker",
  financing_approved: "loan_officer",
  inspection_completed: "accountant",
  title_cleared: "attorney",
  signing_complete: "attorney",
  funds_received: "buyer",
  recording_submitted: "attorney",
  ownership_transferred: "attorney",
};

// ----------------------------------------------------------------------------- create

export async function createTransaction(ctx: ServiceContext, raw: CreateTransactionInput): Promise<Transaction> {
  const actor = requireUser(ctx);
  const input = CreateSchema.parse(raw);
  if (!actor.memberships.some((m) => m.organizationId === input.organizationId)) {
    throw forbidden("You can only open transactions for an organization you belong to.");
  }
  const jurisdiction = getJurisdiction(input.jurisdiction);
  if (jurisdiction.availability === "planned" && !isFlagEnabled("international_markets", { overrides: ctx.flags, organizationId: input.organizationId })) {
    throw badRequest(`${jurisdiction.name} isn't available yet.`);
  }
  if (input.property.country !== jurisdiction.country) throw badRequest("The property's country doesn't match the jurisdiction.");
  const business = input.type === "business_acquisition";
  if (business !== (jurisdiction.vertical === "business")) {
    throw badRequest(business ? "Choose the business acquisition workflow for this deal." : "That workflow is for business acquisitions.");
  }

  const now = nowIso(ctx);
  const property = await ctx.writer.properties.insert({
    id: newId(),
    organizationId: input.organizationId,
    addressLine1: input.property.addressLine1,
    addressLine2: input.property.addressLine2 ?? null,
    city: input.property.city,
    region: input.property.region ?? null,
    postalCode: input.property.postalCode ?? null,
    country: input.property.country,
    latitude: null,
    longitude: null,
    parcelId: null,
    propertyType: business ? "business_premises" : input.property.propertyType,
    yearBuilt: null,
    livingArea: null,
    areaUnit: jurisdiction.country === "US" ? "sqft" : "sqm",
    bedrooms: null,
    bathrooms: null,
    lotSize: null,
    imageUrls: [],
    propertyTaxAnnual: null,
    hoaMonthly: null,
    energyRating: null,
    legalDescription: null,
    currency: input.currency,
    createdAt: now,
    updatedAt: now,
  });

  // Enrich from a property-data provider where one covers this market. Never invent data.
  // (Not for business premises: residential property data doesn't describe them.)
  if (!business) try {
    const details = await ctx.providers.property.lookup({
      line1: property.addressLine1,
      city: property.city,
      region: property.region ?? undefined,
      postalCode: property.postalCode ?? undefined,
      country: property.country,
    });
    if (details) {
      const { source: _source, ...rest } = details;
      await ctx.writer.properties.update(property.id, rest);
    }
  } catch (e) {
    ctx.log.warn("property lookup failed", { error: String(e) });
  }

  const company = input.company
    ? await ctx.writer.companies.insert({
        id: newId(),
        organizationId: input.organizationId,
        legalName: input.company.legalName,
        tradeName: input.company.tradeName ?? null,
        entityType: input.company.entityType,
        stateOfFormation: input.company.stateOfFormation,
        industry: input.company.industry,
        description: input.company.description ?? null,
        employeeCount: input.company.employeeCount ?? null,
        annualRevenue: input.company.annualRevenue ?? null,
        dealStructure: input.company.dealStructure,
        website: null,
        currency: input.currency,
        createdAt: now,
        updatedAt: now,
      })
    : null;

  const tx = await ctx.writer.transactions.insert({
    id: newId(),
    organizationId: input.organizationId,
    propertyId: property.id,
    companyId: company?.id ?? null,
    reference: transactionReference(ctx.now()),
    type: input.type,
    state: "draft",
    jurisdiction: input.jurisdiction,
    currency: input.currency,
    salePrice: input.salePrice,
    expectedClosingDate: input.expectedClosingDate ?? null,
    coordinatorId: input.creatorRole === "transaction_coordinator" ? actor.userId : null,
    createdBy: actor.userId,
    stateChangedAt: now,
    closedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  const creator = await ctx.writer.transaction_participants.insert({
    id: newId(),
    transactionId: tx.id,
    userId: actor.userId,
    organizationId: input.organizationId,
    role: input.creatorRole,
    displayName: actor.displayName,
    email: actor.email.toLowerCase(),
    status: "active",
    invitedBy: actor.userId,
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  for (const key of jurisdiction.milestones) {
    await ctx.writer.transaction_milestones.insert({
      id: newId(),
      transactionId: tx.id,
      key,
      ownerRole: (business ? BUSINESS_MILESTONE_OWNERS : MILESTONE_OWNERS)[key],
      dueDate: key === "ownership_transferred" ? (input.expectedClosingDate ?? null) : null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  await ctx.writer.recordings.insert({
    id: newId(),
    transactionId: tx.id,
    status: "not_ready",
    registry: jurisdiction.recording.registry,
    recordingReference: null,
    submittedAt: null,
    submittedBy: null,
    recordedAt: null,
    confirmationSource: null,
    confirmedBy: null,
    documentId: null,
    createdAt: now,
    updatedAt: now,
  });

  await createTaskRow(ctx, tx.id, {
    title: business ? "Upload the signed letter of intent" : "Upload the accepted purchase agreement",
    description: business
      ? "Add the signed LOI so every party works from the same headline terms."
      : "Add the signed offer / purchase agreement so every party works from the same terms.",
    assigneeParticipantId: creator.id,
    actionKind: "upload_document",
    milestoneKey: "offer_accepted",
    priority: "high",
    estimatedMinutes: 2,
  });
  await createTaskRow(ctx, tx.id, {
    title: "Invite the buyers, sellers and professionals",
    description: `Required in ${jurisdiction.name}: ${jurisdiction.requiredParticipants.map((r) => r.replace(/_/g, " ")).join(", ")}.`,
    assigneeParticipantId: creator.id,
    actionKind: "generic",
    milestoneKey: "transaction_opened",
    priority: "high",
    estimatedMinutes: 5,
  });

  await ensureTransactionRoom(ctx, tx.id);
  await audit(ctx, {
    action: "transaction.created",
    resourceType: "transaction",
    resourceId: tx.id,
    transactionId: tx.id,
    organizationId: tx.organizationId,
    metadata: { reference: tx.reference, jurisdiction: tx.jurisdiction, type: tx.type },
  });
  await emit(ctx, { type: "transaction.created", aggregateType: "transaction", aggregateId: tx.id, transactionId: tx.id });
  await reconcile(ctx, tx.id);
  return tx;
}

// ----------------------------------------------------------------------------- read

export interface TransactionListItem {
  snapshot: TransactionSnapshot;
  myRoles: ParticipantRole[];
}

/** Transactions the actor participates in, or that their org role grants access to. */
export async function listTransactionsForActor(ctx: ServiceContext): Promise<TransactionListItem[]> {
  const actor = requireUser(ctx);
  const mine = await ctx.db.transaction_participants.find({ userId: actor.userId, status: ["invited", "active"] });
  const ids = new Set(mine.map((p) => p.transactionId));
  const orgIds = actor.memberships.filter((m) => m.role === "organization_admin" || m.role === "auditor").map((m) => m.organizationId);
  if (orgIds.length) for (const t of await ctx.db.transactions.find({ organizationId: orgIds })) ids.add(t.id);

  const out: TransactionListItem[] = [];
  for (const id of ids) {
    const s = await loadSnapshot(ctx, id);
    if (!s || !can(actor, "transaction.view", accessContext(s))) continue;
    out.push({ snapshot: s, myRoles: s.participants.filter((p) => p.userId === actor.userId && p.status !== "removed").map((p) => p.role) });
  }
  return out.sort((a, b) => (a.snapshot.transaction.expectedClosingDate ?? "9999").localeCompare(b.snapshot.transaction.expectedClosingDate ?? "9999"));
}

export async function getTransaction(ctx: ServiceContext, transactionId: string) {
  return loadAuthorized(ctx, transactionId, "transaction.view");
}

// ----------------------------------------------------------------------------- update / transition

export async function updateTransaction(ctx: ServiceContext, transactionId: string, raw: UpdateTransactionInput) {
  const input = UpdateSchema.parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "transaction.edit");
  if (isTerminal(s.transaction.state)) throw conflict("This transaction is finished and can't be edited.");
  const patch: Partial<Transaction> = {};
  if (input.expectedClosingDate !== undefined) patch.expectedClosingDate = input.expectedClosingDate;
  if (input.salePrice !== undefined) patch.salePrice = input.salePrice;
  if (input.coordinatorId !== undefined) {
    if (input.coordinatorId && !s.participants.some((p) => p.userId === input.coordinatorId && p.status === "active")) {
      throw badRequest("The coordinator must be an active participant.");
    }
    patch.coordinatorId = input.coordinatorId;
  }
  const updated = await ctx.writer.transactions.updateIf(transactionId, { version: input.expectedVersion }, { ...patch, version: input.expectedVersion + 1 });
  if (!updated) throw conflict("This transaction was just updated by someone else. Please refresh and try again.");
  await audit(ctx, {
    action: "transaction.updated",
    resourceType: "transaction",
    resourceId: transactionId,
    transactionId,
    organizationId: s.transaction.organizationId,
    metadata: { changed: Object.keys(patch), previous: Object.fromEntries(Object.keys(patch).map((k) => [k, s.transaction[k as keyof Transaction]])) },
  });
  if (patch.expectedClosingDate !== undefined && patch.expectedClosingDate !== s.transaction.expectedClosingDate) {
    await ctx.writer.transaction_milestones
      .findOne({ transactionId, key: "ownership_transferred" })
      .then((m) => (m ? ctx.writer.transaction_milestones.update(m.id, { dueDate: patch.expectedClosingDate ?? null }) : null));
    await postSystemMessage(ctx, transactionId, `The expected closing date changed to ${patch.expectedClosingDate ?? "“to be confirmed”"}.`, { type: "transaction", id: transactionId });
    await notify(ctx, {
      userIds: s.participants.filter((p) => p.userId && p.status !== "removed").map((p) => p.userId!),
      transactionId,
      kind: "closing_date_changed",
      title: "Closing date changed",
      body: `The expected closing date for ${dealSubject(s).title} is now ${patch.expectedClosingDate ?? "to be confirmed"}.`,
      linkPath: `/app/transactions/${transactionId}`,
    });
  }
  return updated;
}

export async function transitionTransaction(ctx: ServiceContext, transactionId: string, raw: TransitionInput) {
  const actor = requireUser(ctx);
  const input = TransitionSchema.parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "transaction.view");
  if (s.transaction.version !== input.expectedVersion) throw conflict("This transaction was just updated by someone else. Please refresh and try again.");
  const def = findTransition(s.transaction.state, input.to);
  if (!def) throw new AppError("invalid_transition", "That step isn't possible from the transaction's current stage.", 409);
  assertCan(actor, def.permission, accessContext(s));
  // Raising a dispute is limited to principals and professionals actually on the file.
  if (input.to === "disputed" && actorParticipantIds(actor, s).length === 0) throw forbidden();
  const next = await applyTransition(ctx, s, input.to, input.reason, "user");
  await reconcile(ctx, transactionId);
  return next.transaction;
}

// ----------------------------------------------------------------------------- participants

const PRINCIPAL_ROLES: ParticipantRole[] = ["buyer", "co_buyer", "seller", "co_seller"];

export async function inviteParticipant(ctx: ServiceContext, transactionId: string, raw: InviteParticipantInput) {
  const actor = requireUser(ctx);
  const input = InviteSchema.parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "participant.invite");
  if (isTerminal(s.transaction.state)) throw conflict("This transaction is finished.");
  if (s.participants.some((p) => p.email === input.email && p.role === input.role && p.status !== "removed")) {
    throw conflict("That person already has this role on the transaction.");
  }
  const existingUser = await ctx.writer.profiles.findOne({ email: input.email });
  const now = nowIso(ctx);
  const participant = await ctx.writer.transaction_participants.insert({
    id: newId(),
    transactionId,
    userId: existingUser?.id ?? null,
    organizationId: null,
    role: input.role,
    displayName: input.displayName,
    email: input.email,
    status: "invited",
    invitedBy: actor.userId,
    joinedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await createRoleTasks(ctx, s, participant.id, input.role);

  await audit(ctx, {
    action: "participant.invited",
    resourceType: "participant",
    resourceId: participant.id,
    transactionId,
    organizationId: s.transaction.organizationId,
    metadata: { role: input.role },
  });
  await emit(ctx, { type: "participant.invited", aggregateType: "participant", aggregateId: participant.id, transactionId, payload: { role: input.role } });
  await ctx.providers.email.send({
    to: input.email,
    subject: `You're invited to the closing for ${dealSubject(s).title}`,
    text: `${actor.displayName} invited you to join the closing for ${dealSubject(s).title} (${dealSubject(s).subtitle}) as ${input.role.replace(/_/g, " ")} on Sagolik Close.\n\nSign in with this email address to get started: ${new URL("/sign-in", ctx.env.APP_URL)}`,
  });
  await postSystemMessage(ctx, transactionId, `${input.displayName} was invited as ${input.role.replace(/_/g, " ")}.`, { type: "participant", id: participant.id });

  // Leaving draft is an explicit, human-triggered step once principals are invited.
  if (s.transaction.state === "draft" && PRINCIPAL_ROLES.includes(input.role) && can(actor, "transaction.transition", accessContext(s))) {
    const fresh = await loadSnapshot(ctx, transactionId, ctx.writer);
    if (fresh) await applyTransition(ctx, fresh, "invited", `${input.displayName} invited as ${input.role.replace(/_/g, " ")}.`, "user");
    const again = await loadSnapshot(ctx, transactionId, ctx.writer);
    if (again && again.transaction.state === "invited") await applyTransition(ctx, again, "identity_pending", "Parties invited; verifying identities.", "workflow");
  }
  await reconcile(ctx, transactionId);
  return participant;
}

async function createRoleTasks(ctx: ServiceContext, s: TransactionSnapshot, participantId: string, role: ParticipantRole) {
  const j = getJurisdiction(s.transaction.jurisdiction);
  if (isPrincipal(role)) {
    await createTaskRow(ctx, s.transaction.id, {
      title: "Verify your identity",
      description: j.identity.methods.includes("bankid_se")
        ? "Confirm who you are with BankID. It takes about a minute."
        : "Take a photo of your ID and a quick selfie. It usually takes less than three minutes.",
      assigneeParticipantId: participantId,
      actionKind: "verify_identity",
      milestoneKey: "identity_verified",
      priority: "high",
      estimatedMinutes: 3,
    });
  }
  if (role === "buyer" || role === "co_buyer") {
    await createTaskRow(ctx, s.transaction.id, {
      title: "Connect the bank account you'll pay from",
      description: "Securely connect through your bank's own consent screen. We never see your banking password.",
      assigneeParticipantId: participantId,
      actionKind: "connect_bank",
      milestoneKey: "funds_received",
      priority: "normal",
      estimatedMinutes: 3,
    });
    await createTaskRow(ctx, s.transaction.id, {
      title: "Tell us where your funds come from",
      description: "Required for anti-money-laundering checks. Add a short description and any supporting document.",
      assigneeParticipantId: participantId,
      actionKind: "declare_source_of_funds",
      milestoneKey: "funds_received",
      priority: "normal",
      estimatedMinutes: 4,
    });
  }
}

export async function removeParticipant(ctx: ServiceContext, transactionId: string, participantId: string, reason: string) {
  const s = await loadAuthorized(ctx, transactionId, "participant.remove");
  const p = s.participants.find((x) => x.id === participantId);
  if (!p) throw notFound("That participant");
  if (p.status === "removed") return p;
  const updated = await ctx.writer.transaction_participants.update(p.id, { status: "removed" });
  await audit(ctx, { action: "participant.removed", resourceType: "participant", resourceId: p.id, transactionId, organizationId: s.transaction.organizationId, metadata: { role: p.role, reason } });
  await postSystemMessage(ctx, transactionId, `${p.displayName} (${p.role.replace(/_/g, " ")}) was removed from the transaction.`, { type: "participant", id: p.id });
  return updated;
}

/** On sign-in: link pending invitations addressed to this email to the account. */
export async function claimInvitations(ctx: ServiceContext, actor: Actor): Promise<number> {
  const pending = await ctx.writer.transaction_participants.find({ email: actor.email.toLowerCase(), userId: null });
  for (const p of pending) {
    if (p.status === "removed" || p.status === "declined") continue;
    await ctx.writer.transaction_participants.update(p.id, { userId: actor.userId, status: "active", joinedAt: nowIso(ctx) });
  }
  // Invitations addressed to an existing account become active on first sign-in.
  for (const p of await ctx.writer.transaction_participants.find({ userId: actor.userId, status: "invited" })) {
    await ctx.writer.transaction_participants.update(p.id, { status: "active", joinedAt: nowIso(ctx) });
  }
  return pending.length;
}

// ----------------------------------------------------------------------------- tasks

interface TaskRowInput {
  title: string;
  description?: string | null;
  assigneeParticipantId: string | null;
  actionKind: TaskActionKind;
  milestoneKey: MilestoneKey | null;
  priority?: Task["priority"];
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  requiredEvidence?: string | null;
}

export async function createTaskRow(ctx: ServiceContext, transactionId: string, t: TaskRowInput): Promise<Task> {
  const now = nowIso(ctx);
  return ctx.writer.tasks.insert({
    id: newId(),
    transactionId,
    milestoneKey: t.milestoneKey,
    title: t.title,
    description: t.description ?? null,
    assigneeParticipantId: t.assigneeParticipantId,
    status: "todo",
    priority: t.priority ?? "normal",
    dueDate: t.dueDate ?? null,
    requiredEvidence: t.requiredEvidence ?? null,
    actionKind: t.actionKind,
    relatedEntityType: t.relatedEntityType ?? null,
    relatedEntityId: t.relatedEntityId ?? null,
    estimatedMinutes: t.estimatedMinutes ?? null,
    completedAt: null,
    completedBy: null,
    createdBy: "userId" in ctx.actor ? ctx.actor.userId : null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function createTask(ctx: ServiceContext, transactionId: string, raw: CreateTaskInput) {
  const input = CreateTaskSchema.parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "task.manage");
  if (input.assigneeParticipantId && !s.participants.some((p) => p.id === input.assigneeParticipantId && p.status !== "removed")) {
    throw badRequest("The assignee must be a participant on this transaction.");
  }
  const task = await createTaskRow(ctx, transactionId, {
    title: input.title,
    description: input.description ?? null,
    assigneeParticipantId: input.assigneeParticipantId ?? null,
    actionKind: "generic",
    milestoneKey: null,
    priority: input.priority,
    dueDate: input.dueDate ?? null,
  });
  await audit(ctx, { action: "task.created", resourceType: "task", resourceId: task.id, transactionId, organizationId: s.transaction.organizationId });
  const assignee = s.participants.find((p) => p.id === input.assigneeParticipantId);
  if (assignee?.userId) {
    await notify(ctx, { userIds: [assignee.userId], transactionId, kind: "task_assigned", title: "New task for you", body: task.title, linkPath: `/app/transactions/${transactionId}/tasks` });
  }
  return task;
}

/** Tasks tied to a real action complete when that action happens, not by clicking. */
const SELF_COMPLETING: TaskActionKind[] = ["verify_identity", "connect_bank", "sign_document", "transfer_funds", "declare_source_of_funds", "upload_document"];

export async function updateTaskStatus(ctx: ServiceContext, transactionId: string, taskId: string, raw: UpdateTaskStatusInput) {
  const actor = requireUser(ctx);
  const input = TaskStatusSchema.parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "transaction.view");
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task) throw notFound("That task");
  const access = accessContext(s);
  const isAssignee = !!task.assigneeParticipantId && actorParticipantIds(actor, s).includes(task.assigneeParticipantId);
  const manager = can(actor, "task.manage", access);
  if (!manager && !(isAssignee && can(actor, "task.complete_own", access))) throw forbidden("Only the assignee or a coordinator can update this task.");
  if (input.status === "waived" && !manager) throw forbidden("Only a coordinator can waive a task.");
  if (input.status === "complete" && SELF_COMPLETING.includes(task.actionKind) && !manager) {
    throw badRequest("This task completes automatically when the step itself is done.");
  }
  if (input.status === "complete") {
    const deps = s.taskDependencies.filter((d) => d.taskId === taskId);
    const openDep = deps.map((d) => s.tasks.find((t) => t.id === d.dependsOnTaskId)).find((t) => t && t.status !== "complete" && t.status !== "waived");
    if (openDep) throw badRequest(`Finish “${openDep.title}” first.`);
  }
  const done = input.status === "complete" || input.status === "waived";
  const updated = await ctx.writer.tasks.update(taskId, {
    status: input.status,
    completedAt: done ? nowIso(ctx) : null,
    completedBy: done ? actor.userId : null,
  });
  await audit(ctx, {
    action: "task.updated",
    resourceType: "task",
    resourceId: taskId,
    transactionId,
    organizationId: s.transaction.organizationId,
    metadata: { from: task.status, to: input.status, note: input.note ?? null },
  });
  await reconcile(ctx, transactionId);
  return updated;
}

/** Complete open tasks of a kind for a participant (called when the underlying action happens). */
export async function completeTasksFor(ctx: ServiceContext, transactionId: string, kind: TaskActionKind, participantId: string | null, relatedEntityId?: string) {
  const open = await ctx.writer.tasks.find({ transactionId, actionKind: kind, status: ["todo", "in_progress", "waiting", "blocked"] });
  for (const t of open) {
    if (participantId && t.assigneeParticipantId !== participantId) continue;
    if (relatedEntityId && t.relatedEntityId && t.relatedEntityId !== relatedEntityId) continue;
    await ctx.writer.tasks.update(t.id, { status: "complete", completedAt: nowIso(ctx), completedBy: "userId" in ctx.actor ? ctx.actor.userId : null });
  }
}

export function canManageOrg(actor: Actor, organizationId: string) {
  return isOrgAdmin(actor, organizationId);
}
