/**
 * Domain-event reactions. Registered once at startup (web + worker).
 * Handlers must be idempotent — the outbox may deliver more than once.
 */
import type { TransactionState } from "@sagolik/types";
import { onDomainEvent } from "../events";
import { prepareFromOwnershipRecord } from "./autopilot";
import { createOwnershipRecord } from "./closing";
import { notify, participantUserIds } from "./notifications";

const PEOPLE_UPDATES: Partial<Record<TransactionState, string>> = {
  documents_pending: "Everyone's identity is verified.",
  financing_pending: "The purchase agreement is fully signed.",
  conditions_pending: "Financing is approved.",
  ready_for_signing: "Your closing documents are being prepared for signing.",
  escrow_pending: "All closing documents are signed.",
  funding_pending: "Funds have settled in escrow.",
  recording_pending: "Everything is in place — the deed is being recorded.",
  closed: "Your transaction is closed.",
  cancelled: "This transaction was cancelled.",
  disputed: "This transaction has been paused because of a dispute.",
};

let registered = false;

export function registerReactions() {
  if (registered) return;
  registered = true;

  onDomainEvent("transaction.state_changed", async (ctx, e) => {
    const to = e.payload.to as TransactionState;
    const body = PEOPLE_UPDATES[to];
    if (!body || !e.transactionId) return;
    const [tx, participants] = await Promise.all([
      ctx.writer.transactions.get(e.transactionId),
      ctx.writer.transaction_participants.find({ transactionId: e.transactionId }),
    ]);
    if (!tx) return;
    const property = await ctx.writer.properties.get(tx.propertyId);
    await notify(ctx, {
      userIds: participantUserIds(participants),
      transactionId: e.transactionId,
      kind: "status_update",
      title: property ? `Update on ${property.addressLine1}` : "Transaction update",
      body,
      linkPath: `/app/transactions/${e.transactionId}`,
    });
  });

  onDomainEvent("ownership.transferred", async (ctx, e) => {
    if (!e.transactionId) return;
    const record = await createOwnershipRecord(ctx, e.transactionId);
    // Close → Live: the property moves straight into monitoring (no money is ever moved).
    await prepareFromOwnershipRecord(ctx, record.id);
  });

  onDomainEvent("message.posted", async (ctx, e) => {
    const mentions = (e.payload.mentions as string[] | undefined) ?? [];
    if (!mentions.length || !e.transactionId) return;
    await notify(ctx, {
      userIds: mentions,
      transactionId: e.transactionId,
      kind: "message_mention",
      title: "You were mentioned in the transaction room",
      body: "Someone mentioned you in a message.",
      linkPath: `/app/transactions/${e.transactionId}/messages`,
    });
  });

  onDomainEvent("escrow.deposit_received", async (ctx, e) => {
    if (!e.transactionId) return;
    const participants = await ctx.writer.transaction_participants.find({ transactionId: e.transactionId });
    await notify(ctx, {
      userIds: participantUserIds(participants, ["escrow_officer", "buyer_agent"]),
      transactionId: e.transactionId,
      kind: "funds_received",
      title: "Escrow deposit settled",
      body: "A deposit has settled in escrow.",
      linkPath: `/app/transactions/${e.transactionId}/money`,
    });
  });
}
