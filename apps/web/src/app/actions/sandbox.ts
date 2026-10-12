"use server";
/**
 * Sandbox controls. They play the part of external providers (bank rails,
 * escrow partner, identity vendor, e-signature vendor) in demo/local mode by
 * driving the MOCK providers, which then emit signed webhooks through the
 * real pipeline. Disabled entirely outside demo mode.
 */
import { assertStepUp, can } from "@sagolik/auth";
import {
  accessContext,
  badRequest,
  completeBankConnection,
  connectWallet,
  forbidden,
  fundsStillNeeded,
  getRuntime,
  getTransaction,
  openWalletChallenge,
  recordEscrowMovement,
  toAppError,
  walletChallenge,
} from "@sagolik/core";
import { demoWallet } from "@sagolik/integrations";
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
  // A real provider sends the browser back to /api/v1/bank-connections/callback with a GET.
  // A server action can't redirect into a route handler, so the sandbox finishes the same
  // way the callback does (completeBankConnection) and then goes to the page it would.
  const { ctx } = await requireContext();
  let dest: string;
  try {
    const conn = await completeBankConnection(ctx, state, code);
    dest = conn.transactionId ? `/app/transactions/${conn.transactionId}/money?bank=connected` : "/app/settings/banks?bank=connected";
  } catch (e) {
    dest = `/app/settings/banks?bank_error=${encodeURIComponent(toAppError(e).userMessage)}`;
  }
  redirect(dest);
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

// ----------------------------------------------------------------------------- sandbox wallet

/** Opens the sandbox wallet's signing screen for the signed-in person's demo wallet. */
export async function startDemoWalletSandbox(_p: ActionState, fd: FormData): Promise<ActionState> {
  let dest = "";
  const result = await runAction(async () => {
    const mocks = await sandbox();
    if (!mocks.chain) throw forbidden("The sandbox chain isn't running.");
    const { ctx, actor } = await requireContext();
    const c = await walletChallenge(ctx, formString(fd, "transactionId") ?? "", demoWallet(actor.userId).address);
    dest = `/sandbox/wallet?token=${encodeURIComponent(c.token)}`;
  });
  if (!result.ok) return result;
  redirect(dest);
}

/** The sandbox wallet signs, exactly as a wallet app would, and hands the signature back. */
export async function signDemoWalletSandbox(_p: ActionState, fd: FormData): Promise<ActionState> {
  let dest = "";
  const result = await runAction(async () => {
    await sandbox();
    const { ctx, actor } = await requireContext();
    const token = formString(fd, "token") ?? "";
    const c = await openWalletChallenge(ctx, token);
    const wallet = demoWallet(actor.userId);
    if (c.address !== wallet.address) throw forbidden("This request is for a different wallet.");
    await connectWallet(ctx, token, await wallet.sign(c.message));
    dest = `/app/transactions/${c.transactionId}/money?wallet=connected#wallets`;
  });
  if (!result.ok) return result;
  redirect(dest);
}

/**
 * Plays the buyer's side of a USDC payment (from their verified demo wallet
 * to the escrow partner's), then records it as escrow would, with the
 * transaction as evidence. Sagolik never sends or receives the money; the
 * sandbox stands in for the buyer's wallet app.
 */
export async function recordUsdcPaymentSandbox(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const mocks = await sandbox();
    if (!mocks.chain) throw forbidden("The sandbox chain isn't running.");
    const { ctx, actor } = await requireContext();
    const txId = formString(fd, "transactionId") ?? "";
    const s = await getTransaction(ctx, txId);
    if (!can(actor, "escrow.manage", accessContext(s))) throw forbidden();
    // Recording needs a fresh confirmation; ask before the sandbox wallet sends anything.
    assertStepUp(actor, "escrow.record_movement", Date.now());
    const rt = await getRuntime();
    const wallets = await rt.serviceDb.wallet_connections.find({ transactionId: txId, status: "verified", network: "sandbox" });
    const buyerIds = new Set(s.participants.filter((p) => p.role === "buyer" || p.role === "co_buyer").map((p) => p.userId));
    const wallet = wallets.find((w) => buyerIds.has(w.userId));
    if (!wallet) throw badRequest("The buyer hasn't confirmed a wallet for this closing yet.");
    const balance = (await mocks.chain.usdcBalance(wallet.address as `0x${string}`)).cents;
    const amount = Math.min(fundsStillNeeded(s, new Date().toISOString()), balance);
    if (amount <= 0) throw badRequest("Nothing is outstanding, or the buyer's demo wallet is empty.");
    const hash = mocks.chain.simulateTransfer({ from: wallet.address as `0x${string}`, to: demoWallet(`escrow-partner:${txId}`).address, cents: amount });
    await recordEscrowMovement(ctx, txId, { kind: "receipt", amount, reference: `USDC ${hash.slice(2, 10)}`, chainTxHash: hash });
    return { message: "Sandbox: the buyer's wallet sent USDC to the escrow partner, and escrow recorded it with the transaction as evidence.", revalidate: [`/app/transactions/${txId}`] };
  });
}
