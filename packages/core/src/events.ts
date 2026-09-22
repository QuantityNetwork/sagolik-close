/**
 * Audit trail + domain-event outbox.
 *
 * `audit()` writes an append-only audit row. `emit()` writes a domain event
 * to the outbox with an idempotency key; handlers run either inline (local)
 * or in the worker, with retries, backoff and dead-lettering.
 */
import { type AuditAction, type DomainEventType, nextAttemptDelay } from "@sagolik/audit";
import type { DomainEventRow } from "@sagolik/types";
import { type ServiceContext, isUser } from "./context";

export interface AuditInput {
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  transactionId?: string | null;
  organizationId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function audit(ctx: ServiceContext, input: AuditInput): Promise<void> {
  const a = ctx.actor;
  await ctx.writer.audit_events.insert({
    id: crypto.randomUUID(),
    organizationId: input.organizationId ?? null,
    transactionId: input.transactionId ?? null,
    actorId: isUser(a) ? a.userId : null,
    actorType: isUser(a) ? "user" : a.source.startsWith("webhook") ? "provider" : "system",
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    occurredAt: ctx.now().toISOString(),
    ipAddress: isUser(a) ? a.ipAddress : null,
    userAgent: isUser(a) ? a.userAgent : null,
    metadata: { ...(input.metadata ?? {}), ...(isUser(a) ? {} : { systemSource: a.source }) },
    correlationId: ctx.correlationId,
  });
}

export interface EmitInput {
  type: DomainEventType;
  aggregateType: string;
  aggregateId: string;
  transactionId?: string | null;
  payload?: Record<string, unknown>;
  /** Stable key so re-emitting the same fact is a no-op. Defaults to type+aggregate+correlation. */
  idempotencyKey?: string;
}

export type DomainEventHandler = (ctx: ServiceContext, event: DomainEventRow) => Promise<void>;
const handlers = new Map<string, DomainEventHandler[]>();

export function onDomainEvent(type: DomainEventType, handler: DomainEventHandler) {
  const list = handlers.get(type) ?? [];
  list.push(handler);
  handlers.set(type, list);
}

export async function emit(ctx: ServiceContext, input: EmitInput): Promise<void> {
  const row: DomainEventRow = {
    id: crypto.randomUUID(),
    eventType: input.type,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    transactionId: input.transactionId ?? null,
    payload: input.payload ?? {},
    correlationId: ctx.correlationId,
    idempotencyKey: input.idempotencyKey ?? `${input.type}:${input.aggregateId}:${ctx.correlationId}`,
    status: "pending",
    attempts: 0,
    availableAt: ctx.now().toISOString(),
    lastError: null,
    createdAt: ctx.now().toISOString(),
    processedAt: null,
  };
  try {
    await ctx.writer.domain_events.insert(row);
  } catch (e) {
    if ((e as { code?: string }).code === "conflict") return; // already emitted — idempotent
    throw e;
  }
  if (ctx.outboxMode === "inline") await processEvent(ctx, row);
}

/** Process one outbox row. Claims it with compare-and-set so concurrent workers never double-run it. */
export async function processEvent(ctx: ServiceContext, row: DomainEventRow): Promise<"processed" | "failed" | "dead_letter" | "skipped"> {
  const claimed = await ctx.writer.domain_events.updateIf(
    row.id,
    { status: row.status, attempts: row.attempts },
    { status: "processing", attempts: row.attempts + 1 },
  );
  if (!claimed) return "skipped";
  const system: ServiceContext = { ...ctx, db: ctx.writer, actor: { kind: "system", source: `event:${row.eventType}` }, correlationId: row.correlationId };
  try {
    for (const h of handlers.get(row.eventType) ?? []) await h(system, claimed);
    await ctx.writer.domain_events.update(row.id, { status: "processed", processedAt: ctx.now().toISOString(), lastError: null });
    return "processed";
  } catch (e) {
    const delay = nextAttemptDelay(claimed.attempts);
    const message = e instanceof Error ? e.message : String(e);
    ctx.log.error("domain event handler failed", { eventType: row.eventType, eventId: row.id, attempts: claimed.attempts, error: message, correlationId: row.correlationId });
    if (delay === null) {
      await ctx.writer.domain_events.update(row.id, { status: "dead_letter", lastError: message });
      return "dead_letter";
    }
    await ctx.writer.domain_events.update(row.id, {
      status: "failed",
      lastError: message,
      availableAt: new Date(ctx.now().getTime() + delay).toISOString(),
    });
    return "failed";
  }
}

/** Drain due outbox rows (worker loop / scheduled job). */
export async function drainOutbox(ctx: ServiceContext, limit = 50): Promise<Record<string, number>> {
  const due = (await ctx.writer.domain_events.find({ status: ["pending", "failed"] }, { orderBy: "availableAt", limit: limit * 2 }))
    .filter((e) => e.availableAt <= ctx.now().toISOString())
    .slice(0, limit);
  const counts: Record<string, number> = {};
  for (const e of due) {
    const r = await processEvent(ctx, e);
    counts[r] = (counts[r] ?? 0) + 1;
  }
  return counts;
}
