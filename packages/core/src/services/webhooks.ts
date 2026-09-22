/**
 * Inbound webhooks: signature verification → timestamp window → schema
 * validation → exactly-once recording (unique provider+event id) → mapping
 * to domain handlers → processed/failed status with retry + dead-letter.
 */
import { type NormalizedWebhook, WebhookRejectedError } from "@sagolik/integrations";
import { sha256Hex } from "@sagolik/security";
import type { WebhookEvent } from "@sagolik/types";
import { type ServiceContext, asSystem } from "../context";
import { audit } from "../events";
import { newId, nowIso } from "../util";
import { handleEscrowEvent } from "./escrow";
import { handleIdentityEvent } from "./identity";
import { notify } from "./notifications";
import { handlePaymentEvent } from "./payments";
import { handleSignatureEvent } from "./signatures";

export const MAX_WEBHOOK_ATTEMPTS = 5;

export type WebhookOutcome =
  | { status: "processed"; httpStatus: 200 }
  | { status: "duplicate"; httpStatus: 200 }
  | { status: "ignored"; httpStatus: 200 }
  | { status: "rejected"; httpStatus: 400 | 401 | 404; reason: string }
  | { status: "failed"; httpStatus: 500 };

async function route(ctx: ServiceContext, providerId: string, event: NormalizedWebhook, webhookEventId: string): Promise<"processed" | "ignored"> {
  const p = ctx.providers;
  if (providerId === p.signatures.info.id) {
    await handleSignatureEvent(ctx, event.eventType, event.data);
    return "processed";
  }
  if (providerId === p.identity.info.id && event.eventType === "identity.verification.completed") {
    await handleIdentityEvent(ctx, event.data);
    return "processed";
  }
  if (providerId === p.payments.info.id && event.eventType === "payment.status_changed") {
    await handlePaymentEvent(ctx, event.data, webhookEventId);
    return "processed";
  }
  if (providerId === p.escrow.info.id) {
    await handleEscrowEvent(ctx, event.eventType, event.data);
    return "processed";
  }
  if (providerId === p.banking.info.id && event.eventType === "bank.reauth_required") {
    const conn = await ctx.writer.bank_connections.findOne({ externalConnectionId: String(event.data.externalConnectionId ?? "") });
    if (!conn) return "ignored";
    await ctx.writer.bank_connections.update(conn.id, { status: "reauthentication_required", lastError: "Your bank needs you to reconnect before we can refresh the account." });
    await notify(ctx, {
      userIds: [conn.userId],
      transactionId: conn.transactionId,
      kind: "bank_reconnect",
      title: `${conn.institutionName} needs you to reconnect`,
      body: "Your bank needs you to reconnect before we can refresh the account.",
      linkPath: "/app/settings/banks",
    });
    return "processed";
  }
  return "ignored";
}

export async function handleWebhook(base: ServiceContext, providerId: string, rawBody: string, headers: Headers): Promise<WebhookOutcome> {
  const ctx = asSystem(base, `webhook:${providerId}`);
  const receiver = ctx.providers.webhookReceivers.get(providerId);
  if (!receiver) return { status: "rejected", httpStatus: 404, reason: "unknown_provider" };

  let event: NormalizedWebhook;
  try {
    event = receiver.parseWebhook(rawBody, headers);
  } catch (e) {
    const reason = e instanceof WebhookRejectedError ? e.reason : "invalid";
    await audit(ctx, { action: "webhook.rejected", resourceType: "webhook", resourceId: providerId, metadata: { reason, bytes: rawBody.length } });
    ctx.log.warn("webhook rejected", { provider: providerId, reason, correlationId: ctx.correlationId });
    return { status: "rejected", httpStatus: reason === "schema" || reason === "invalid_json" ? 400 : 401, reason };
  }

  const now = nowIso(ctx);
  let row: WebhookEvent;
  try {
    row = await ctx.writer.webhook_events.insert({
      id: newId(),
      provider: providerId,
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      payloadHash: sha256Hex(rawBody),
      payload: event as unknown as Record<string, unknown>,
      status: "processing",
      attempts: 1,
      error: null,
      receivedAt: now,
      processedAt: null,
    });
  } catch (e) {
    if ((e as { code?: string }).code !== "conflict") throw e;
    // Seen before. Only a previously FAILED event may be re-claimed (provider retry).
    const existing = await ctx.writer.webhook_events.findOne({ provider: providerId, externalEventId: event.externalEventId });
    if (!existing || existing.status !== "failed") return { status: "duplicate", httpStatus: 200 };
    const claimed = await ctx.writer.webhook_events.updateIf(existing.id, { status: "failed", attempts: existing.attempts }, { status: "processing", attempts: existing.attempts + 1 });
    if (!claimed) return { status: "duplicate", httpStatus: 200 };
    row = claimed;
  }
  return processWebhookRow(ctx, providerId, event, row);
}

async function processWebhookRow(ctx: ServiceContext, providerId: string, event: NormalizedWebhook, row: WebhookEvent): Promise<WebhookOutcome> {
  try {
    const result = await route(ctx, providerId, event, row.id);
    await ctx.writer.webhook_events.update(row.id, { status: result, processedAt: nowIso(ctx), error: null });
    return { status: result, httpStatus: 200 };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const dead = row.attempts >= MAX_WEBHOOK_ATTEMPTS;
    await ctx.writer.webhook_events.update(row.id, { status: dead ? "dead_letter" : "failed", error: message.slice(0, 1000) });
    ctx.log.error("webhook processing failed", { provider: providerId, eventType: event.eventType, eventId: event.externalEventId, attempts: row.attempts, error: message, correlationId: ctx.correlationId });
    return { status: "failed", httpStatus: 500 };
  }
}

/** Worker / scheduled job: retry failed webhooks from their stored (already-verified) payload. */
export async function retryFailedWebhooks(base: ServiceContext, limit = 25): Promise<number> {
  const failed = await base.writer.webhook_events.find({ status: "failed" }, { orderBy: "receivedAt", limit });
  let n = 0;
  for (const row of failed) {
    const ctx = asSystem(base, `webhook:${row.provider}`);
    const claimed = await ctx.writer.webhook_events.updateIf(row.id, { status: "failed", attempts: row.attempts }, { status: "processing", attempts: row.attempts + 1 });
    if (!claimed) continue;
    await processWebhookRow(ctx, row.provider, row.payload as unknown as NormalizedWebhook, claimed);
    n++;
  }
  return n;
}
