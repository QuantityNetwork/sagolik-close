"use server";
/**
 * Sandbox controls. They play the part of external providers (bank rails,
 * escrow partner, identity vendor, e-signature vendor) in demo/local mode by
 * driving the MOCK providers, which then emit signed webhooks through the
 * real pipeline. Disabled entirely outside demo mode.
 */
import { can } from "@sagolik/auth";
import { accessContext, badRequest, forbidden, getRuntime, getTransaction } from "@sagolik/core";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { formString, runAction } from "@/lib/server/action";
import { requireContext } from "@/lib/server/context";
import { requireActor } from "@/lib/server/session";

async function sandbox() {
  const rt = await getRuntime();
  if (!rt.env.demoMode) throw forbidden("Sandbox controls are only available in the demo environment.");
  return rt.providers.mocks;
}

export async function advancePaymentSandbox(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const mocks = await sandbox();
    const { ctx, actor } = await requireContext();
    const txId = formString(fd, "transactionId") ?? "";
    const s = await getTransaction(ctx, txId);
    if (!can(actor, "financial.view", accessContext(s))) throw forbidden();
    const payment = s.payments.find((p) => p.id === formString(fd, "paymentId"));
    if (!payment?.externalPaymentId || !mocks.payments) throw badRequest("This payment hasn't reached the bank yet.");
    await mocks.payments.advance(payment.externalPaymentId, (formString(fd, "outcome") ?? "next") as "next");
    return { revalidate: [`/app/transactions/${txId}`] };
  });
}

export async function confirmDisbursementSandbox(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const mocks = await sandbox();
    const { ctx, actor } = await requireContext();
    const txId = formString(fd, "transactionId") ?? "";
    const s = await getTransaction(ctx, txId);
    if (!can(actor, "escrow.manage", accessContext(s)) || !s.escrow || !mocks.escrow) throw forbidden();
    await mocks.escrow.confirmDisbursed(s.escrow.externalReference);
    return { message: "The sandbox escrow partner confirmed disbursement.", revalidate: [`/app/transactions/${txId}`] };
  });
}

/** Sandbox bank consent screen → approve → back to our callback with an authorization code. */
export async function approveBankConsentSandbox(_p: ActionState, fd: FormData): Promise<ActionState> {
  const mocks = await sandbox();
  const actor = await requireActor();
  const state = formString(fd, "state") ?? "";
  const pending = mocks.banking?.pendingConsent(state);
  if (!pending || pending.userId !== actor.userId) return { ok: false, error: "This bank connection request has expired. Please start again.", code: "not_found" };
  const code = mocks.banking!.approveConsent(state);
  const rt = await getRuntime();
  const back = new URL("/api/v1/bank-connections/callback", rt.env.APP_URL);
  back.searchParams.set("state", state);
  back.searchParams.set("code", code);
  redirect(back.pathname + back.search);
}

export async function completeIdentitySandbox(_p: ActionState, fd: FormData): Promise<ActionState> {
  const mocks = await sandbox();
  await requireActor();
  const inquiry = formString(fd, "inquiry") ?? "";
  const outcome = (formString(fd, "outcome") ?? "approve") as "approve";
  const result = await runAction(async () => {
    if (!mocks.identity?.session(inquiry)) throw badRequest("This verification session has expired. Please start again.");
    await mocks.identity.complete(inquiry, outcome);
  });
  if (!result.ok) return result;
  const back = formString(fd, "redirect_uri") ?? "/app";
  redirect(back.startsWith("http") ? new URL(back).pathname + new URL(back).search : back);
}

export async function signEnvelopeSandbox(_p: ActionState, fd: FormData): Promise<ActionState> {
  const mocks = await sandbox();
  const actor = await requireActor();
  const envelopeId = formString(fd, "envelope") ?? "";
  const recipientId = formString(fd, "recipient") ?? "";
  const action = formString(fd, "action") === "decline" ? "decline" : "sign";
  const result = await runAction(async () => {
    const env = mocks.signatures?.envelope(envelopeId);
    if (!env) throw badRequest("This signing session has expired.");
    // The signer must be the signed-in person.
    const rt = await getRuntime();
    const participant = await rt.serviceDb.transaction_participants.get(recipientId);
    if (!participant || participant.userId !== actor.userId) throw forbidden("You're not a signer on this document.");
    await mocks.signatures!.act(envelopeId, recipientId, action);
  });
  if (!result.ok) return result;
  const back = formString(fd, "return_url") ?? "/app";
  redirect(back.startsWith("http") ? new URL(back).pathname + new URL(back).search : back);
}
