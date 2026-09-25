/**
 * Settlement instructions + payments.
 *
 * Fraud controls (closing wire fraud is the #1 risk):
 *  - instructions are versioned objects; content is immutable (DB trigger)
 *  - every change: step-up + risk assessment + security signal + alert to all parties
 *  - changed instructions enter a cooling-off period before they can be used
 *  - verification must be done by a DIFFERENT person, out of band
 *  - payments need step-up to initiate and, by default, a second approver
 *  - settlement is recorded ONLY from a verified provider webhook
 */
import { assertCan, assertStepUp } from "@sagolik/auth";
import { isFlagEnabled } from "@sagolik/config";
import { assessRisk, decryptField, encryptField, lastFour } from "@sagolik/security";
import {
  type BankInstruction,
  BankInstructionInput,
  CreatePaymentInput,
  type Payment,
  type PaymentStatus,
} from "@sagolik/types";
import { capabilityEnabled, latestInstruction, type TransactionSnapshot } from "@sagolik/workflow";
import { type ServiceContext, requireUser } from "../context";
import { AppError, badRequest, conflict, forbidden, notFound } from "../errors";
import { audit, emit } from "../events";
import { accessContext, loadAuthorized } from "../snapshot";
import { newId, nowIso } from "../util";
import { HELD_BY_MONEY_SERVICE, moneyCaller, viaMoney } from "../money/bridge";
import { reconcile } from "./engine";
import { postSystemMessage } from "./messaging";
import { notify, participantUserIds } from "./notifications";
import { completeTasksFor } from "./transactions";

const VERIFICATION_METHODS = ["out_of_band_call", "in_person", "provider_attested"] as const;

async function orgSettings(ctx: ServiceContext, organizationId: string) {
  return (
    (await ctx.writer.organization_settings.findOne({ organizationId })) ?? { requireDualApproval: true, coolingOffHours: 24 }
  );
}

function hoursUntil(ctx: ServiceContext, date: string | null): number | null {
  if (!date) return null;
  return (new Date(`${date}T17:00:00Z`).getTime() - ctx.now().getTime()) / 3_600_000;
}

// ----------------------------------------------------------------------------- instructions

export async function createBankInstruction(ctx: ServiceContext, transactionId: string, raw: unknown, opts: { providerAttested?: boolean } = {}): Promise<BankInstruction> {
  const actor = requireUser(ctx);
  const input = BankInstructionInput.parse(raw);
  const s = await loadAuthorized(ctx, transactionId, "beneficiary.modify");
  assertStepUp(actor, "bank_instruction.change", ctx.now().getTime());
  if (input.currency !== s.transaction.currency) throw badRequest(`Instructions on this transaction must be in ${s.transaction.currency}.`);

  const previous = latestInstruction(s, input.purpose) ?? null;
  const settings = await orgSettings(ctx, s.transaction.organizationId);
  const hoursToClosing = hoursUntil(ctx, s.transaction.expectedClosingDate);
  const risk = previous ? assessRisk({ kind: "bank_instruction_changed", hoursToClosing }, settings.coolingOffHours) : null;
  const now = ctx.now();
  let effectiveAfter = risk && risk.coolingOffHours > 0 ? new Date(now.getTime() + risk.coolingOffHours * 3_600_000).toISOString() : null;
  const accountNumber = input.accountNumber.replace(/\s/g, "");

  // Money service mode: it seals the account number and owns versioning and cooling-off;
  // the web app keeps a masked mirror for display and workflow.
  const authoritative = ctx.money
    ? (
        await viaMoney(() =>
          ctx.money!.createInstruction(moneyCaller(ctx, s, "beneficiary.modify"), {
            purpose: input.purpose,
            beneficiaryName: input.beneficiaryName,
            bankName: input.bankName,
            routingNumber: input.routingIdentifier.replace(/\s/g, ""),
            accountNumber,
            currency: input.currency,
            ...(hoursToClosing !== null ? { hoursToClosing } : {}),
          }),
        )
      ).instruction
    : null;
  if (authoritative) effectiveAfter = authoritative.effectiveAfter;

  if (previous && previous.status !== "superseded" && previous.status !== "rejected") {
    await ctx.writer.bank_instructions.update(previous.id, { status: "superseded" });
  }
  const instruction = await ctx.writer.bank_instructions.insert({
    id: authoritative?.id ?? newId(),
    transactionId,
    purpose: input.purpose,
    beneficiaryName: input.beneficiaryName,
    bankName: input.bankName,
    accountMask: authoritative?.accountMask ?? lastFour(accountNumber),
    routingIdentifier: authoritative?.routingNumber ?? input.routingIdentifier,
    encryptedAccountNumber: authoritative ? HELD_BY_MONEY_SERVICE : encryptField(accountNumber, ctx.keyRing, `bank_instruction:${transactionId}:${input.purpose}`),
    currency: input.currency,
    status: "pending_verification",
    version: authoritative?.version ?? (previous?.version ?? 0) + 1,
    previousVersionId: authoritative?.previousId ?? previous?.id ?? null,
    verifiedBy: null,
    verifiedAt: null,
    verificationMethod: opts.providerAttested ? "provider_attested" : null,
    effectiveAfter,
    createdBy: actor.userId,
    createdAt: now.toISOString(),
  });

  await audit(ctx, {
    action: previous ? "beneficiary.changed" : "bank_instruction.created",
    resourceType: "bank_instruction",
    resourceId: instruction.id,
    transactionId,
    organizationId: s.transaction.organizationId,
    metadata: { purpose: input.purpose, version: instruction.version, previousVersionId: previous?.id ?? null, risk: risk?.level ?? "low", mask: instruction.accountMask },
  });

  if (previous && risk) {
    await ctx.writer.security_signals.insert({
      id: newId(),
      userId: actor.userId,
      transactionId,
      kind: "bank_instruction_changed",
      riskLevel: risk.level,
      controls: risk.controls,
      details: { reasons: risk.reasons, instructionId: instruction.id, version: instruction.version },
      resolved: false,
      createdAt: now.toISOString(),
    });
    await audit(ctx, { action: "security.signal_raised", resourceType: "bank_instruction", resourceId: instruction.id, transactionId, organizationId: s.transaction.organizationId, metadata: { level: risk.level } });
    const warning = `Security notice: the payment instructions for escrow changed (now v${instruction.version}, account ending ${instruction.accountMask}). They can't be used until they're independently verified${effectiveAfter ? ` and the waiting period ends` : ""}. Never send money based on instructions received by email or phone — confirm by calling your escrow officer on a number you already know.`;
    await postSystemMessage(ctx, transactionId, warning, { type: "bank_instruction", id: instruction.id });
    await notify(ctx, {
      userIds: participantUserIds(s.participants),
      transactionId,
      kind: "payment_instructions_changed",
      title: "Payment instructions changed — verify before sending money",
      body: warning,
      linkPath: `/app/transactions/${transactionId}/money`,
    });
  }
  return instruction;
}

/** Second-person, out-of-band verification. The creator can never verify their own instruction. */
export async function verifyBankInstruction(ctx: ServiceContext, instructionId: string, method: string, reference = "") {
  const actor = requireUser(ctx);
  if (!(VERIFICATION_METHODS as readonly string[]).includes(method)) throw badRequest("Choose how the instructions were verified.");
  const ins = await ctx.writer.bank_instructions.get(instructionId);
  if (!ins) throw notFound("Those instructions");
  const s = await loadAuthorized(ctx, ins.transactionId, "beneficiary.verify");
  assertStepUp(actor, "bank_instruction.verify", ctx.now().getTime());
  if (ins.createdBy === actor.userId) throw forbidden("Instructions must be verified by someone other than the person who entered them.");
  if (ins.status !== "pending_verification") throw conflict("These instructions aren't waiting for verification.");
  const latest = latestInstruction(s, ins.purpose);
  if (latest?.id !== ins.id) throw conflict("A newer version of these instructions exists.");
  if (ctx.money) {
    // The money service re-checks every rule and records the verification.
    await viaMoney(() => ctx.money!.verifyInstruction(moneyCaller(ctx, s, "beneficiary.verify"), ins.id, { method, reference: reference.trim() }));
  }
  const updated = await ctx.writer.bank_instructions.update(ins.id, { status: "verified", verifiedBy: actor.userId, verifiedAt: nowIso(ctx), verificationMethod: method });
  await audit(ctx, {
    action: "bank_instruction.verified",
    resourceType: "bank_instruction",
    resourceId: ins.id,
    transactionId: ins.transactionId,
    organizationId: s.transaction.organizationId,
    metadata: { method, version: ins.version, hasReference: reference.trim() !== "" },
  });
  await postSystemMessage(ctx, ins.transactionId, `Escrow payment instructions v${ins.version} (account ending ${ins.accountMask}) were verified by ${actor.displayName}.`, { type: "bank_instruction", id: ins.id });
  await reconcile(ctx, ins.transactionId);
  return updated;
}

/**
 * Full wire details for the payer (F1: the buyer sends money from their own
 * bank). Only for current, verified instructions past any waiting period;
 * requires a fresh step-up and is audited.
 */
export async function revealBankInstruction(ctx: ServiceContext, instructionId: string) {
  const actor = requireUser(ctx);
  const ins = await ctx.writer.bank_instructions.get(instructionId);
  if (!ins) throw notFound("Those payment instructions");
  const s = await loadAuthorized(ctx, ins.transactionId, "payment.initiate");
  assertStepUp(actor, "bank_instruction.reveal", ctx.now().getTime());
  assertUsableInstruction(ctx, s, ins);
  const accountNumber = ctx.money
    ? (await viaMoney(() => ctx.money!.revealInstruction(moneyCaller(ctx, s, "payment.initiate"), ins.id))).accountNumber
    : decryptField(ins.encryptedAccountNumber, ctx.keyRing, `bank_instruction:${ins.transactionId}:${ins.purpose}`);
  await audit(ctx, {
    action: "bank_instruction.revealed",
    resourceType: "bank_instruction",
    resourceId: ins.id,
    transactionId: ins.transactionId,
    organizationId: s.transaction.organizationId,
    metadata: { version: ins.version },
  });
  return { beneficiaryName: ins.beneficiaryName, bankName: ins.bankName, routingIdentifier: ins.routingIdentifier, accountNumber, version: ins.version };
}

// ----------------------------------------------------------------------------- payments

function assertUsableInstruction(ctx: ServiceContext, s: TransactionSnapshot, ins: BankInstruction) {
  const latest = latestInstruction(s, ins.purpose);
  if (latest?.id !== ins.id) throw conflict("These payment instructions have been replaced. Please review the current instructions.");
  if (ins.status !== "verified" && ins.status !== "locked") throw badRequest("These payment instructions haven't been independently verified yet.");
  if (ins.effectiveAfter && ins.effectiveAfter > nowIso(ctx)) {
    throw new AppError("forbidden", `These payment instructions changed recently and are in a security waiting period until ${new Date(ins.effectiveAfter).toUTCString()}.`, 403);
  }
}

export async function initiatePayment(ctx: ServiceContext, raw: unknown, idempotencyKey?: string): Promise<Payment> {
  const actor = requireUser(ctx);
  const input = CreatePaymentInput.parse(raw);
  const s = await loadAuthorized(ctx, input.transactionId, "payment.initiate");
  if (ctx.money || !isFlagEnabled("payment_initiation", { overrides: ctx.flags, organizationId: s.transaction.organizationId })) {
    // With the money service, transfers stay with the payer's own bank (F1) until escrow-initiated payments are cleared by counsel.
    throw badRequest("Transfers are sent from your own bank for this transaction. Use the verified instructions shown on the Money page.");
  }
  assertStepUp(actor, "payment.initiate", ctx.now().getTime());

  const key = idempotencyKey ?? `pay_${input.transactionId}_${input.type}_${input.amount}_${input.fromAccountId}`;
  const existing = await ctx.writer.payments.findOne({ idempotencyKey: key });
  if (existing) {
    if (existing.transactionId !== input.transactionId || existing.amount !== input.amount) throw new AppError("idempotency_conflict", "This request was already used for a different payment.", 409);
    return existing;
  }

  const capability = input.type === "closing_funds" ? "closing_funds" : "escrow_deposit";
  if (!capabilityEnabled(s, capability)) {
    throw badRequest(
      capability === "escrow_deposit"
        ? "The deposit can be sent once everyone's identity is verified and the purchase agreement is signed."
        : "Closing funds can be sent once escrow's instructions are verified and compliance checks are complete.",
    );
  }
  if (input.currency !== s.transaction.currency) throw badRequest(`Payments on this transaction are in ${s.transaction.currency}.`);

  const ins = s.bankInstructions.find((b) => b.id === input.bankInstructionId);
  if (!ins) throw notFound("Those payment instructions");
  assertUsableInstruction(ctx, s, ins);

  const account = await ctx.writer.bank_accounts.get(input.fromAccountId);
  if (!account || account.userId !== actor.userId) throw notFound("That bank account");
  if (!account.ownershipVerified) throw badRequest("We couldn't confirm you own this account. Please choose an account in your name.");
  if (account.currency !== input.currency) throw badRequest("That account is in a different currency.");
  if (account.availableBalance !== null && account.availableBalance < input.amount) throw badRequest("The available balance on that account is lower than this transfer.");

  const settings = await orgSettings(ctx, s.transaction.organizationId);
  const now = nowIso(ctx);
  const payment = await ctx.writer.payments.insert({
    id: newId(),
    transactionId: input.transactionId,
    type: input.type,
    rail: input.rail,
    status: settings.requireDualApproval ? "authorization_required" : "authorized",
    amount: input.amount,
    currency: input.currency,
    fromAccountId: account.id,
    bankInstructionId: ins.id,
    provider: ctx.providers.payments.info.id,
    externalPaymentId: null,
    idempotencyKey: key,
    initiatedBy: actor.userId,
    approvedBy: null,
    requiresDualApproval: settings.requireDualApproval,
    settledAt: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  });
  await recordPaymentEvent(ctx, payment, payment.status, "user", null);
  await audit(ctx, {
    action: "payment.initiated",
    resourceType: "payment",
    resourceId: payment.id,
    transactionId: s.transaction.id,
    organizationId: s.transaction.organizationId,
    metadata: { type: input.type, rail: input.rail, amount: input.amount, currency: input.currency, instructionVersion: ins.version, dualApproval: settings.requireDualApproval },
  });
  if (settings.requireDualApproval) {
    await ctx.writer.approvals.insert({
      id: newId(),
      transactionId: s.transaction.id,
      subjectType: "payment",
      subjectId: payment.id,
      requestedBy: actor.userId,
      approvedBy: null,
      status: "pending",
      decidedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await notify(ctx, {
      userIds: participantUserIds(s.participants, ["escrow_officer"]),
      transactionId: s.transaction.id,
      kind: "status_update",
      title: "A transfer is waiting for your approval",
      body: `${actor.displayName} started a ${input.type.replace(/_/g, " ")} transfer. Review and approve it on the Money page.`,
      linkPath: `/app/transactions/${s.transaction.id}/money`,
    });
    return payment;
  }
  return submitToProvider(ctx, s, payment, ins);
}

export async function approvePayment(ctx: ServiceContext, paymentId: string): Promise<Payment> {
  const actor = requireUser(ctx);
  const payment = await ctx.writer.payments.get(paymentId);
  if (!payment) throw notFound("That payment");
  const s = await loadAuthorized(ctx, payment.transactionId, "payment.approve");
  assertStepUp(actor, "payment.approve", ctx.now().getTime());
  if (payment.initiatedBy === actor.userId) throw forbidden("A second person must approve this transfer.");
  if (payment.status !== "authorization_required") throw conflict("This transfer isn't waiting for approval.");
  const ins = s.bankInstructions.find((b) => b.id === payment.bankInstructionId);
  if (!ins) throw notFound("Those payment instructions");
  assertUsableInstruction(ctx, s, ins);

  const approval = await ctx.writer.approvals.findOne({ subjectType: "payment", subjectId: paymentId, status: "pending" });
  if (approval) await ctx.writer.approvals.update(approval.id, { status: "approved", approvedBy: actor.userId, decidedAt: nowIso(ctx) });
  const authorized = await ctx.writer.payments.updateIf(paymentId, { status: "authorization_required" }, { status: "authorized", approvedBy: actor.userId });
  if (!authorized) throw conflict("This transfer was just updated. Please refresh.");
  await recordPaymentEvent(ctx, authorized, "authorized", "user", null);
  await audit(ctx, { action: "payment.approved", resourceType: "payment", resourceId: paymentId, transactionId: s.transaction.id, organizationId: s.transaction.organizationId });
  return submitToProvider(ctx, s, authorized, ins);
}

async function submitToProvider(ctx: ServiceContext, s: TransactionSnapshot, payment: Payment, ins: BankInstruction): Promise<Payment> {
  const account = payment.fromAccountId ? await ctx.writer.bank_accounts.get(payment.fromAccountId) : null;
  // Decrypted only for this call; never logged or returned.
  const accountNumber = decryptField(ins.encryptedAccountNumber, ctx.keyRing, `bank_instruction:${ins.transactionId}:${ins.purpose}`);
  const res = await ctx.providers.payments.createPayment({
    idempotencyKey: payment.idempotencyKey,
    amount: payment.amount,
    currency: payment.currency,
    rail: payment.rail,
    reference: `${s.transaction.reference} ${payment.type}`,
    fromExternalAccountId: account?.externalAccountId ?? "",
    beneficiary: { name: ins.beneficiaryName, accountNumber, routingIdentifier: ins.routingIdentifier, bankName: ins.bankName },
  });
  // Provider may already have pushed a webhook (inline sandbox); only move forward.
  const current = (await ctx.writer.payments.get(payment.id))!;
  const next = rank(res.status) > rank(current.status) ? res.status : current.status;
  const updated = await ctx.writer.payments.update(payment.id, { externalPaymentId: res.externalPaymentId, status: next });
  if (next !== current.status) await recordPaymentEvent(ctx, updated, next, "system", null);
  if (s.escrow && !(await ctx.writer.escrow_transactions.findOne({ paymentId: payment.id }))) {
    await ctx.writer.escrow_transactions.insert({
      id: newId(),
      escrowAccountId: s.escrow.id,
      transactionId: s.transaction.id,
      direction: "deposit",
      amount: payment.amount,
      currency: payment.currency,
      status: updated.status,
      paymentId: payment.id,
      description: payment.type === "closing_funds" ? "Buyer closing funds" : "Earnest money deposit",
      externalReference: res.externalPaymentId,
      occurredAt: nowIso(ctx),
      createdAt: nowIso(ctx),
    });
  }
  const initiator = s.participants.find((p) => p.userId === payment.initiatedBy);
  if (initiator) await completeTasksFor(ctx, s.transaction.id, "transfer_funds", initiator.id);
  await postSystemMessage(ctx, s.transaction.id, `A ${payment.type.replace(/_/g, " ")} transfer is on its way to escrow.`, { type: "payment", id: payment.id });
  return updated;
}

const STATUS_RANK: Record<PaymentStatus, number> = {
  created: 0,
  authorization_required: 1,
  authorized: 2,
  initiated: 3,
  processing: 4,
  received: 5,
  settled: 6,
  failed: 7,
  returned: 8,
  cancelled: 7,
};
const rank = (s: PaymentStatus) => STATUS_RANK[s];
const TERMINAL: PaymentStatus[] = ["failed", "returned", "cancelled"];

async function recordPaymentEvent(ctx: ServiceContext, p: Payment, status: PaymentStatus, source: "provider_webhook" | "user" | "system", webhookEventId: string | null) {
  await ctx.writer.payment_events.insert({ id: newId(), paymentId: p.id, transactionId: p.transactionId, status, source, webhookEventId, occurredAt: nowIso(ctx) });
}

/** Provider webhook → payment state. The ONLY path to `settled`. */
export async function handlePaymentEvent(ctx: ServiceContext, data: Record<string, unknown>, webhookEventId: string | null) {
  const externalId = String(data.externalPaymentId ?? "");
  const payment = await ctx.writer.payments.findOne({ provider: ctx.providers.payments.info.id, externalPaymentId: externalId });
  if (!payment) {
    // The webhook can beat our own write of externalPaymentId; the worker retries.
    throw new Error(`unknown payment ${externalId}`);
  }
  // Re-read the authoritative status from the provider.
  const live = await ctx.providers.payments.getPaymentStatus(externalId);
  const to = live.status;
  if (to === payment.status) return;
  if (TERMINAL.includes(payment.status) || (payment.status === "settled" && to !== "returned")) {
    ctx.log.warn("ignoring payment regression", { paymentId: payment.id, from: payment.status, to });
    return;
  }
  if (!TERMINAL.includes(to) && to !== "returned" && rank(to) < rank(payment.status)) return; // out-of-order delivery
  const updated = await ctx.writer.payments.update(payment.id, {
    status: to,
    settledAt: to === "settled" ? nowIso(ctx) : payment.settledAt,
    failureReason: live.failureReason,
  });
  await recordPaymentEvent(ctx, updated, to, "provider_webhook", webhookEventId);
  const tx = await ctx.writer.transactions.get(payment.transactionId);
  await audit(ctx, {
    action: to === "settled" ? "payment.settled" : "payment.status_changed",
    resourceType: "payment",
    resourceId: payment.id,
    transactionId: payment.transactionId,
    organizationId: tx?.organizationId ?? null,
    metadata: { from: payment.status, to, amount: payment.amount, currency: payment.currency },
  });
  await emit(ctx, {
    type: "payment.status_changed",
    aggregateType: "payment",
    aggregateId: payment.id,
    transactionId: payment.transactionId,
    payload: { from: payment.status, to },
    idempotencyKey: `payment.status_changed:${payment.id}:${to}`,
  });

  const ledger = await ctx.writer.escrow_transactions.findOne({ paymentId: payment.id });
  if (ledger) await ctx.writer.escrow_transactions.update(ledger.id, { status: to });
  const escrow = await ctx.writer.escrow_accounts.findOne({ transactionId: payment.transactionId });
  if (escrow && to === "settled") {
    const received = escrow.receivedAmount + payment.amount;
    await ctx.writer.escrow_accounts.update(escrow.id, { receivedAmount: received, status: received >= escrow.requiredAmount ? "funded" : "awaiting_deposit" });
    await emit(ctx, { type: "escrow.deposit_received", aggregateType: "escrow_account", aggregateId: escrow.id, transactionId: payment.transactionId, payload: { amount: payment.amount }, idempotencyKey: `escrow.deposit_received:${payment.id}` });
  }
  if (escrow && to === "returned" && payment.status === "settled") {
    await ctx.writer.escrow_accounts.update(escrow.id, { receivedAmount: Math.max(0, escrow.receivedAmount - payment.amount), status: "awaiting_deposit" });
  }

  const initiator = payment.initiatedBy;
  const human: Partial<Record<PaymentStatus, { title: string; body: string }>> = {
    received: { title: "Your transfer has arrived", body: "Your transfer has been received and is being finalized." },
    settled: { title: "Your transfer is complete", body: "Your funds have settled in escrow." },
    failed: { title: "Your transfer didn't go through", body: "Your bank didn't complete the transfer. No money has moved. Please contact your escrow officer." },
    returned: { title: "Your transfer was returned", body: "The transfer was returned. Please contact your escrow officer before trying again." },
  };
  const msg = human[to];
  if (msg) {
    await notify(ctx, { userIds: [initiator], transactionId: payment.transactionId, kind: "funds_received", title: msg.title, body: msg.body, linkPath: `/app/transactions/${payment.transactionId}/money` });
    await postSystemMessage(ctx, payment.transactionId, `${payment.type.replace(/_/g, " ")} transfer: ${msg.body}`, { type: "payment", id: payment.id });
  }
  await reconcile(ctx, payment.transactionId);
}

export async function cancelPayment(ctx: ServiceContext, paymentId: string) {
  const actor = requireUser(ctx);
  const payment = await ctx.writer.payments.get(paymentId);
  if (!payment) throw notFound("That payment");
  const s = await loadAuthorized(ctx, payment.transactionId, "transaction.view");
  if (payment.initiatedBy !== actor.userId) assertCan(actor, "payment.approve", accessContext(s));
  if (!["created", "authorization_required", "authorized"].includes(payment.status)) {
    if (payment.externalPaymentId) await ctx.providers.payments.cancelPayment(payment.externalPaymentId);
    else throw conflict("This transfer can no longer be cancelled.");
  }
  const updated = await ctx.writer.payments.update(paymentId, { status: "cancelled" });
  await recordPaymentEvent(ctx, updated, "cancelled", "user", null);
  const approval = await ctx.writer.approvals.findOne({ subjectType: "payment", subjectId: paymentId, status: "pending" });
  if (approval) await ctx.writer.approvals.update(approval.id, { status: "rejected", approvedBy: actor.userId === payment.initiatedBy ? null : actor.userId, decidedAt: nowIso(ctx) });
  await audit(ctx, { action: "payment.status_changed", resourceType: "payment", resourceId: paymentId, transactionId: payment.transactionId, organizationId: s.transaction.organizationId, metadata: { to: "cancelled" } });
  return updated;
}
