/**
 * Escrow orchestration. The licensed escrow/title partner holds the money;
 * Sagolik tracks instructions, conditions, deposits and disbursement status.
 */
import { assertCan, assertStepUp } from "@sagolik/auth";
import { z } from "zod";
import { type ServiceContext, requireUser } from "../context";
import { badRequest, conflict, notFound } from "../errors";
import { audit } from "../events";
import { accessContext, loadAuthorized } from "../snapshot";
import { newId, nowIso } from "../util";
import { reconcile } from "./engine";
import { postSystemMessage } from "./messaging";
import { moneyCaller, viaMoney } from "../money/bridge";
import { emit } from "../events";
import { createBankInstruction } from "./payments";

const OpenEscrowInput = z.object({ requiredAmount: z.number().int().positive(), expectedReleaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

export async function openEscrow(ctx: ServiceContext, transactionId: string, raw: unknown) {
  const actor = requireUser(ctx);
  const input = OpenEscrowInput.parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "escrow.manage");
  // Opening escrow creates payment instructions: check every precondition before the first write.
  assertCan(actor, "beneficiary.modify", accessContext(s));
  assertStepUp(actor, "bank_instruction.change", ctx.now().getTime());
  if (s.escrow) throw conflict("Escrow is already open for this transaction.");
  const opened = await ctx.providers.escrow.openEscrow({ transactionReference: s.transaction.reference, requiredAmount: input.requiredAmount, currency: s.transaction.currency });
  const now = nowIso(ctx);
  const escrow = await ctx.writer.escrow_accounts.insert({
    id: newId(),
    transactionId,
    provider: ctx.providers.escrow.info.id,
    providerName: opened.providerName,
    externalReference: opened.externalReference,
    status: "awaiting_deposit",
    requiredAmount: input.requiredAmount,
    receivedAmount: 0,
    currency: s.transaction.currency,
    expectedReleaseDate: input.expectedReleaseDate ?? s.transaction.expectedClosingDate,
    createdAt: now,
    updatedAt: now,
  });
  // The partner's trust-account details become instruction v1 — still subject to second-person verification.
  await createBankInstruction(
    ctx,
    transactionId,
    {
      purpose: "closing_funds_to_escrow",
      beneficiaryName: opened.instructions.beneficiaryName,
      bankName: opened.instructions.bankName,
      accountNumber: opened.instructions.accountNumber,
      routingIdentifier: opened.instructions.routingIdentifier,
      currency: s.transaction.currency,
    },
    { providerAttested: true },
  );
  if (ctx.money) {
    await viaMoney(() =>
      ctx.money!.recordMovement(moneyCaller(ctx, s, "escrow.manage"), {
        kind: "expectation",
        amount: input.requiredAmount,
        currency: s.transaction.currency,
        reference: `Escrow ${opened.externalReference}`,
        idempotencyKey: `escrow:${transactionId}:expectation:opened`,
      }),
    );
  }
  await audit(ctx, { action: "escrow.opened", resourceType: "escrow_account", resourceId: escrow.id, transactionId, organizationId: s.transaction.organizationId, metadata: { provider: escrow.provider, reference: escrow.externalReference, requiredAmount: escrow.requiredAmount, openedBy: actor.userId } });
  await postSystemMessage(ctx, transactionId, `Escrow opened with ${opened.providerName} (ref ${opened.externalReference}).`, { type: "escrow_account", id: escrow.id });
  await reconcile(ctx, transactionId);
  return escrow;
}

export async function addEscrowCondition(ctx: ServiceContext, transactionId: string, description: string) {
  const s = await loadAuthorized(ctx, transactionId, "escrow.manage");
  if (!s.escrow) throw badRequest("Open escrow first.");
  const text = z.string().trim().min(3).max(300).parse(description);
  const now = nowIso(ctx);
  const c = await ctx.writer.escrow_conditions.insert({ id: newId(), escrowAccountId: s.escrow.id, transactionId, description: text, satisfied: false, satisfiedAt: null, satisfiedBy: null, createdAt: now, updatedAt: now });
  await reconcile(ctx, transactionId);
  return c;
}

export async function satisfyEscrowCondition(ctx: ServiceContext, conditionId: string) {
  const actor = requireUser(ctx);
  const c = await ctx.db.escrow_conditions.get(conditionId);
  if (!c) throw notFound("That condition");
  const s = await loadAuthorized(ctx, c.transactionId, "escrow.manage");
  if (c.satisfied) return c;
  const updated = await ctx.writer.escrow_conditions.update(conditionId, { satisfied: true, satisfiedAt: nowIso(ctx), satisfiedBy: actor.userId });
  await audit(ctx, { action: "escrow.condition_satisfied", resourceType: "escrow_condition", resourceId: conditionId, transactionId: c.transactionId, organizationId: s.transaction.organizationId, metadata: { description: c.description } });
  await postSystemMessage(ctx, c.transactionId, `Escrow condition satisfied: ${c.description}`, { type: "escrow_condition", id: conditionId });
  await reconcile(ctx, c.transactionId);
  return updated;
}

/** Ask the partner to release funds. Only after the deed is submitted or recorded. */
export async function requestDisbursement(ctx: ServiceContext, transactionId: string) {
  const actor = requireUser(ctx);
  const s = await loadAuthorized(ctx, transactionId, "escrow.manage");
  assertStepUp(actor, "payment.approve", ctx.now().getTime());
  if (!s.escrow) throw badRequest("There's no escrow account on this transaction.");
  if (!s.recording || !["submitted_for_recording", "recorded"].includes(s.recording.status)) {
    throw badRequest("Funds can be released once the deed has been submitted for recording.");
  }
  if (s.escrow.status === "releasing" || s.escrow.status === "disbursed") throw conflict("Disbursement is already under way.");
  const lines = [{ payee: "Seller proceeds and payoffs per the approved closing statement", amount: s.escrow.receivedAmount, purpose: "closing_disbursement" }];
  const { requestId } = await ctx.providers.escrow.requestDisbursement(s.escrow.externalReference, lines);
  await ctx.writer.escrow_accounts.update(s.escrow.id, { status: "releasing" });
  await audit(ctx, { action: "escrow.disbursed", resourceType: "escrow_account", resourceId: s.escrow.id, transactionId, organizationId: s.transaction.organizationId, metadata: { stage: "requested", requestId } });
  await postSystemMessage(ctx, transactionId, `Disbursement requested from ${s.escrow.providerName}.`, { type: "escrow_account", id: s.escrow.id });
  return requestId;
}

/** Webhook: the partner confirms funds were released. */
export async function handleEscrowEvent(ctx: ServiceContext, eventType: string, data: Record<string, unknown>) {
  const ref = String(data.externalReference ?? "");
  const escrow = await ctx.writer.escrow_accounts.findOne({ externalReference: ref });
  if (!escrow) throw new Error(`unknown escrow ${ref}`);
  if (eventType !== "escrow.disbursed" || escrow.status === "disbursed") return;
  await ctx.writer.escrow_accounts.update(escrow.id, { status: "disbursed" });
  await ctx.writer.escrow_transactions.insert({
    id: newId(),
    escrowAccountId: escrow.id,
    transactionId: escrow.transactionId,
    direction: "disbursement",
    amount: Math.max(1, escrow.receivedAmount),
    currency: escrow.currency,
    status: "settled",
    paymentId: null,
    description: "Closing disbursement",
    externalReference: ref,
    occurredAt: nowIso(ctx),
    createdAt: nowIso(ctx),
  });
  const tx = await ctx.writer.transactions.get(escrow.transactionId);
  await audit(ctx, { action: "escrow.disbursed", resourceType: "escrow_account", resourceId: escrow.id, transactionId: escrow.transactionId, organizationId: tx?.organizationId ?? null, metadata: { stage: "confirmed" } });
  await postSystemMessage(ctx, escrow.transactionId, `${escrow.providerName} confirmed that all funds have been disbursed.`, { type: "escrow_account", id: escrow.id });
  await reconcile(ctx, escrow.transactionId);
}

const MovementInput = z.object({
  kind: z.enum(["receipt", "disbursement"]),
  amount: z.number().int().positive(),
  reference: z.string().trim().regex(/^[\p{L}\p{N} .,:#/_-]{3,120}$/u, "Add the reference from your escrow system."),
});

/**
 * The escrow officer records what their escrow system shows — funds received
 * from the buyer's bank, or paid out. Sagolik never moves these funds; this is
 * how F1 (buyer wires from their own bank) is reflected. Same reference twice
 * is treated as the same entry.
 */
export async function recordEscrowMovement(ctx: ServiceContext, transactionId: string, raw: unknown) {
  const actor = requireUser(ctx);
  const input = MovementInput.parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "escrow.manage");
  assertStepUp(actor, "escrow.record_movement", ctx.now().getTime());
  if (!s.escrow) throw badRequest("Open escrow before recording funds.");
  const escrow = s.escrow;
  const externalReference = `${input.kind}:${input.reference}`;
  if (await ctx.writer.escrow_transactions.findOne({ escrowAccountId: escrow.id, externalReference })) {
    return escrow; // already recorded
  }
  if (input.kind === "disbursement" && input.amount > escrow.receivedAmount) {
    throw conflict("That payout is larger than the funds escrow has reported holding.");
  }
  if (ctx.money) {
    await viaMoney(() =>
      ctx.money!.recordMovement(moneyCaller(ctx, s, "escrow.manage"), {
        kind: input.kind,
        amount: input.amount,
        currency: escrow.currency,
        reference: input.reference,
        idempotencyKey: `escrow:${transactionId}:${externalReference}`.slice(0, 200),
      }),
    );
  }
  const now = nowIso(ctx);
  await ctx.writer.escrow_transactions.insert({
    id: newId(),
    escrowAccountId: escrow.id,
    transactionId,
    direction: input.kind === "receipt" ? "deposit" : "disbursement",
    amount: input.amount,
    currency: escrow.currency,
    status: "settled",
    paymentId: null,
    description: input.kind === "receipt" ? "Funds received (recorded by escrow)" : "Funds paid out (recorded by escrow)",
    externalReference,
    occurredAt: now,
    createdAt: now,
  });
  const received = input.kind === "receipt" ? escrow.receivedAmount + input.amount : escrow.receivedAmount - input.amount;
  const updated = await ctx.writer.escrow_accounts.update(escrow.id, {
    receivedAmount: received,
    status: input.kind === "disbursement" ? escrow.status : received >= escrow.requiredAmount ? "funded" : "awaiting_deposit",
  });
  await audit(ctx, {
    action: "escrow.movement_recorded",
    resourceType: "escrow_account",
    resourceId: escrow.id,
    transactionId,
    organizationId: s.transaction.organizationId,
    metadata: { kind: input.kind, amount: input.amount, currency: escrow.currency, reference: input.reference },
  });
  if (input.kind === "receipt") {
    await emit(ctx, { type: "escrow.deposit_received", aggregateType: "escrow_account", aggregateId: escrow.id, transactionId, payload: { amount: input.amount }, idempotencyKey: `escrow.deposit_received:${escrow.id}:${input.reference}` });
    await postSystemMessage(ctx, transactionId, `Escrow recorded funds received (ref ${input.reference}).`, { type: "escrow_account", id: escrow.id });
  }
  await reconcile(ctx, transactionId);
  return updated;
}
