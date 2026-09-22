/**
 * Secure transaction messaging: one transaction room per file, direct
 * threads, and system notices that always reference the object they're about.
 */
import { assertCan } from "@sagolik/auth";
import { type SendMessageInput, SendMessageInput as SendMessageSchema, type Message, type MessageThread } from "@sagolik/types";
import { type ServiceContext, requireUser } from "../context";
import { forbidden, notFound } from "../errors";
import { audit, emit } from "../events";
import { accessContext, loadAuthorized } from "../snapshot";
import { newId, nowIso } from "../util";

export async function ensureTransactionRoom(ctx: ServiceContext, transactionId: string): Promise<MessageThread> {
  const existing = await ctx.writer.message_threads.findOne({ transactionId, kind: "transaction_room" });
  if (existing) return existing;
  return ctx.writer.message_threads.insert({
    id: newId(),
    transactionId,
    kind: "transaction_room",
    title: "Transaction room",
    memberUserIds: [],
    createdAt: nowIso(ctx),
    updatedAt: nowIso(ctx),
  });
}

/** Automated notice in the transaction room, linked to the object it describes. */
export async function postSystemMessage(
  ctx: ServiceContext,
  transactionId: string,
  body: string,
  related: { type: string; id: string } | null = null,
): Promise<Message> {
  const room = await ensureTransactionRoom(ctx, transactionId);
  return ctx.writer.messages.insert({
    id: newId(),
    threadId: room.id,
    transactionId,
    authorId: null,
    kind: "system",
    body,
    mentions: [],
    attachmentDocumentIds: [],
    relatedEntityType: related?.type ?? null,
    relatedEntityId: related?.id ?? null,
    createdAt: nowIso(ctx),
  });
}

function visibleThread(thread: MessageThread, userId: string) {
  return thread.kind !== "direct" || thread.memberUserIds.includes(userId);
}

export async function listThreads(ctx: ServiceContext, transactionId: string) {
  const actor = requireUser(ctx);
  await loadAuthorized(ctx, transactionId, "transaction.view");
  await ensureTransactionRoom(ctx, transactionId);
  const threads = (await ctx.db.message_threads.find({ transactionId }, { orderBy: "createdAt" })).filter((t) => visibleThread(t, actor.userId));
  const result = [];
  for (const t of threads) {
    const messages = await ctx.db.messages.find({ threadId: t.id }, { orderBy: "createdAt" });
    const reads = messages.length ? await ctx.db.message_reads.find({ messageId: messages.map((m) => m.id), userId: actor.userId }) : [];
    const readIds = new Set(reads.map((r) => r.messageId));
    result.push({ thread: t, messages, unread: messages.filter((m) => m.authorId !== actor.userId && !readIds.has(m.id)).length });
  }
  return result;
}

export async function sendMessage(ctx: ServiceContext, raw: SendMessageInput): Promise<Message> {
  const actor = requireUser(ctx);
  const input = SendMessageSchema.parse(raw);
  const thread = await ctx.db.message_threads.get(input.threadId);
  if (!thread) throw notFound("That conversation");
  const s = await loadAuthorized(ctx, thread.transactionId, "message.send");
  if (thread.kind === "system" || !visibleThread(thread, actor.userId)) throw forbidden("You can't post in this conversation.");
  // Attachments must be documents on this transaction.
  for (const docId of input.attachmentDocumentIds) {
    if (!s.documents.some((d) => d.id === docId)) throw notFound("That attachment");
  }
  // Mentions: "@Name" matched against participants of this transaction only.
  const mentions = s.participants
    .filter((p) => p.userId && p.userId !== actor.userId && input.body.toLowerCase().includes(`@${p.displayName.split(" ")[0]!.toLowerCase()}`))
    .map((p) => p.userId!);
  const msg = await ctx.writer.messages.insert({
    id: newId(),
    threadId: thread.id,
    transactionId: thread.transactionId,
    authorId: actor.userId,
    kind: "user",
    body: input.body,
    mentions: [...new Set(mentions)],
    attachmentDocumentIds: input.attachmentDocumentIds,
    relatedEntityType: null,
    relatedEntityId: null,
    createdAt: nowIso(ctx),
  });
  await ctx.writer.message_reads.insert({ id: newId(), messageId: msg.id, userId: actor.userId, readAt: nowIso(ctx) });
  await audit(ctx, { action: "message.sent", resourceType: "message", resourceId: msg.id, transactionId: thread.transactionId, organizationId: s.transaction.organizationId });
  await emit(ctx, { type: "message.posted", aggregateType: "message", aggregateId: msg.id, transactionId: thread.transactionId, payload: { mentions: msg.mentions } });
  return msg;
}

export async function markThreadRead(ctx: ServiceContext, threadId: string) {
  const actor = requireUser(ctx);
  const thread = await ctx.db.message_threads.get(threadId);
  if (!thread) throw notFound("That conversation");
  const s = await loadAuthorized(ctx, thread.transactionId, "transaction.view");
  assertCan(actor, "transaction.view", accessContext(s));
  if (!visibleThread(thread, actor.userId)) throw notFound("That conversation");
  const messages = await ctx.db.messages.find({ threadId });
  const reads = await ctx.db.message_reads.find({ userId: actor.userId, messageId: messages.map((m) => m.id) });
  const have = new Set(reads.map((r) => r.messageId));
  for (const m of messages) {
    if (!have.has(m.id)) await ctx.writer.message_reads.insert({ id: newId(), messageId: m.id, userId: actor.userId, readAt: nowIso(ctx) });
  }
}
