"use server";
/**
 * Server actions for the transaction workspace. Every action:
 *  1. resolves the signed-in person server-side,
 *  2. calls a core service (which authorizes, validates and audits),
 *  3. returns a human-readable result or redirects.
 */
import * as core from "@sagolik/core";
import { RATE_LIMITS } from "@sagolik/security";
import type { DocumentCategory, ParticipantRole } from "@sagolik/types";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { formString, parseMoneyInput, runAction } from "@/lib/server/action";
import { rateLimit, requireContext } from "@/lib/server/context";

const txPath = (id: string) => `/app/transactions/${id}`;

function id(fd: FormData, key = "transactionId") {
  const v = formString(fd, key);
  if (!v || !/^[0-9a-f-]{36}$/i.test(v)) throw core.badRequest("Missing or invalid reference.");
  return v;
}

async function appUrl() {
  return (await core.getRuntime()).env.APP_URL;
}

// ----------------------------------------------------------------------------- transaction

export async function createTransactionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let createdId: string | null = null;
  const result = await runAction(async () => {
    const { ctx } = await requireContext();
    const tx = await core.createTransaction(ctx, {
      organizationId: formString(fd, "organizationId") ?? "",
      type: (formString(fd, "type") ?? "purchase") as "purchase",
      jurisdiction: formString(fd, "jurisdiction") ?? "US-TX",
      currency: (formString(fd, "currency") ?? "USD") as "USD",
      salePrice: parseMoneyInput(formString(fd, "salePrice")) ?? 0,
      expectedClosingDate: formString(fd, "expectedClosingDate"),
      creatorRole: (formString(fd, "creatorRole") ?? "transaction_coordinator") as ParticipantRole,
      property: {
        addressLine1: formString(fd, "addressLine1") ?? "",
        addressLine2: formString(fd, "addressLine2"),
        city: formString(fd, "city") ?? "",
        region: formString(fd, "region"),
        postalCode: formString(fd, "postalCode"),
        country: formString(fd, "country") ?? "US",
        propertyType: formString(fd, "propertyType") ?? "single_family",
      },
    });
    createdId = tx.id;
  });
  if (result.ok && createdId) redirect(`${txPath(createdId)}/people?created=1`);
  return result;
}

export async function updateClosingDateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.updateTransaction(ctx, txId, { expectedClosingDate: formString(fd, "expectedClosingDate") ?? null, expectedVersion: Number(formString(fd, "version")) });
    return { message: "Closing date updated. Everyone has been notified.", revalidate: [txPath(txId)] };
  });
}

export async function transitionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.transitionTransaction(ctx, txId, { to: formString(fd, "to") as never, reason: formString(fd, "reason") ?? "", expectedVersion: Number(formString(fd, "version")) });
    return { message: "Transaction updated.", revalidate: [txPath(txId)] };
  });
}

// ----------------------------------------------------------------------------- people & tasks

export async function inviteParticipantAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    const p = await core.inviteParticipant(ctx, txId, { role: formString(fd, "role") as ParticipantRole, displayName: formString(fd, "displayName") ?? "", email: formString(fd, "email") ?? "" });
    return { message: `${p.displayName} has been invited.`, revalidate: [txPath(txId)] };
  });
}

export async function removeParticipantAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.removeParticipant(ctx, txId, id(fd, "participantId"), formString(fd, "reason") ?? "Removed by coordinator");
    return { revalidate: [txPath(txId)] };
  });
}

export async function createTaskAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.createTask(ctx, txId, {
      title: formString(fd, "title") ?? "",
      description: formString(fd, "description"),
      assigneeParticipantId: formString(fd, "assigneeParticipantId"),
      priority: (formString(fd, "priority") ?? "normal") as "normal",
      dueDate: formString(fd, "dueDate"),
    });
    return { message: "Task created.", revalidate: [txPath(txId)] };
  });
}

export async function updateTaskAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.updateTaskStatus(ctx, txId, id(fd, "taskId"), { status: formString(fd, "status") as "complete", note: formString(fd, "note") });
    return { revalidate: [txPath(txId)] };
  });
}

// ----------------------------------------------------------------------------- identity, signatures, documents

export async function startIdentityAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let url: string | null = null;
  const txId = formString(fd, "transactionId") ?? "";
  const result = await runAction(async () => {
    const { ctx } = await requireContext();
    url = await core.startIdentityVerification(ctx, id(fd), `${await appUrl()}${txPath(txId)}?identity=done`);
  });
  if (result.ok && url) redirect(url);
  return result;
}

export async function startSigningAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let url: string | null = null;
  const txId = formString(fd, "transactionId") ?? "";
  const result = await runAction(async () => {
    const { ctx } = await requireContext();
    url = await core.startSigning(ctx, id(fd, "signatureId"), `${await appUrl()}${txPath(txId)}/documents?signed=1`);
  });
  if (result.ok && url) redirect(url);
  return result;
}

export async function requestSignaturesAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    const signers = fd.getAll("signers").map(String);
    if (!signers.length) throw core.badRequest("Choose at least one signer.");
    await core.requestSignatures(ctx, id(fd, "documentId"), { signerParticipantIds: signers, message: formString(fd, "message") });
    return { message: "Signature request sent.", revalidate: [txPath(txId)] };
  });
}

export async function uploadDocumentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, actor } = await requireContext();
    const rl = await rateLimit(`upload:${actor.userId}`, RATE_LIMITS.upload);
    if (!rl.allowed) throw core.badRequest("You're uploading too quickly. Please wait a moment.");
    const txId = id(fd);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw core.badRequest("Choose a file to upload.");
    const { document, version } = await core.uploadDocument(ctx, {
      transactionId: txId,
      documentId: formString(fd, "documentId"),
      name: formString(fd, "name") ?? file.name.replace(/\.[^.]+$/, ""),
      category: (formString(fd, "category") ?? "other") as DocumentCategory,
      accessLevel: (formString(fd, "accessLevel") ?? "all_participants") as "all_participants",
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return { message: `${document.name} v${version.version} uploaded, scanned and saved.`, revalidate: [txPath(txId)] };
  });
}

export async function reviewDocumentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.reviewDocument(ctx, id(fd, "documentId"), formString(fd, "decision") as "approved", formString(fd, "note"));
    return { revalidate: [txPath(txId)] };
  });
}

// ----------------------------------------------------------------------------- money

export async function startBankConnectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let url: string | null = null;
  const result = await runAction(async () => {
    const { ctx } = await requireContext();
    const txId = formString(fd, "transactionId");
    const started = await core.startBankConnection(ctx, { transactionId: txId, institutionId: formString(fd, "institutionId") ?? "", country: formString(fd, "country") ?? "US" }, `${await appUrl()}/api/v1/bank-connections/callback`);
    url = started.redirectUrl;
  });
  if (result.ok && url) redirect(url);
  return result;
}

export async function refreshBankAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const r = await core.refreshBankConnection(ctx, id(fd, "connectionId"));
    return { message: r.status === "connected" ? "Balances refreshed." : r.message ?? undefined, revalidate: ["/app"] };
  });
}

export async function disconnectBankAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    await core.disconnectBank(ctx, id(fd, "connectionId"));
    return { message: "Bank disconnected.", revalidate: ["/app"] };
  });
}

export async function initiatePaymentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    const amount = parseMoneyInput(formString(fd, "amount"));
    if (!amount) throw core.badRequest("Enter the amount to send.");
    const p = await core.initiatePayment(
      ctx,
      { transactionId: txId, type: formString(fd, "type"), rail: formString(fd, "rail") ?? "wire", amount, currency: formString(fd, "currency"), fromAccountId: formString(fd, "fromAccountId"), bankInstructionId: formString(fd, "bankInstructionId") },
      formString(fd, "idempotencyKey"),
    );
    return {
      message: p.status === "authorization_required" ? "Transfer created. Your escrow officer will approve it before it's sent." : "Transfer sent.",
      revalidate: [txPath(txId)],
    };
  });
}

export async function approvePaymentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.approvePayment(ctx, id(fd, "paymentId"));
    return { message: "Approved and sent to the bank.", revalidate: [txPath(txId)] };
  });
}

export async function cancelPaymentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.cancelPayment(ctx, id(fd, "paymentId"));
    return { revalidate: [txPath(txId)] };
  });
}

export async function createInstructionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    const ins = await core.createBankInstruction(ctx, txId, {
      purpose: formString(fd, "purpose") ?? "closing_funds_to_escrow",
      beneficiaryName: formString(fd, "beneficiaryName"),
      bankName: formString(fd, "bankName"),
      accountNumber: formString(fd, "accountNumber"),
      routingIdentifier: formString(fd, "routingIdentifier"),
      currency: formString(fd, "currency"),
    });
    return { message: `Instructions v${ins.version} saved. A second person must verify them before use.`, revalidate: [txPath(txId)] };
  });
}

export async function verifyInstructionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.verifyBankInstruction(ctx, id(fd, "instructionId"), formString(fd, "method") ?? "", formString(fd, "reference") ?? "");
    return { message: "Instructions verified.", revalidate: [txPath(txId)] };
  });
}

/** Full wire details for the payer. Returned to this request only; never cached or logged. */
export async function revealInstructionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const details = await core.revealBankInstruction(ctx, id(fd, "instructionId"));
    return { data: details };
  });
}

export async function recordEscrowMovementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    const kind = formString(fd, "kind") === "disbursement" ? "disbursement" : "receipt";
    await core.recordEscrowMovement(ctx, txId, { kind, amount: parseMoneyInput(formString(fd, "amount")) ?? 0, reference: formString(fd, "reference") ?? "" });
    return { message: kind === "receipt" ? "Funds received recorded." : "Payout recorded.", revalidate: [txPath(txId)] };
  });
}

export async function openEscrowAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.openEscrow(ctx, txId, { requiredAmount: parseMoneyInput(formString(fd, "requiredAmount")) ?? 0 });
    return { message: "Escrow opened.", revalidate: [txPath(txId)] };
  });
}

export async function addEscrowConditionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.addEscrowCondition(ctx, txId, formString(fd, "description") ?? "");
    return { revalidate: [txPath(txId)] };
  });
}

export async function satisfyEscrowConditionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.satisfyEscrowCondition(ctx, id(fd, "conditionId"));
    return { revalidate: [txPath(txId)] };
  });
}

export async function declareFundsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.declareSourceOfFunds(ctx, txId, {
      sourceType: formString(fd, "sourceType"),
      amount: parseMoneyInput(formString(fd, "amount")),
      currency: formString(fd, "currency"),
      description: formString(fd, "description"),
      evidenceDocumentId: formString(fd, "evidenceDocumentId"),
    });
    return { message: "Thank you. A compliance reviewer will look at this shortly.", revalidate: [txPath(txId)] };
  });
}

export async function decideComplianceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.decideComplianceCase(ctx, id(fd, "caseId"), { decision: formString(fd, "decision"), notes: formString(fd, "notes") });
    return { message: "Decision recorded.", revalidate: [txPath(txId)] };
  });
}

// ----------------------------------------------------------------------------- lender, title, recording

export async function openMortgageAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.openMortgage(ctx, txId, {
      lenderName: formString(fd, "lenderName"),
      loanAmount: parseMoneyInput(formString(fd, "loanAmount")),
      loanType: formString(fd, "loanType"),
      termMonths: formString(fd, "termMonths") ? Number(formString(fd, "termMonths")) : undefined,
      interestRateBps: formString(fd, "interestRate") ? Math.round(Number(formString(fd, "interestRate")) * 100) : undefined,
    });
    return { message: "Loan file opened.", revalidate: [txPath(txId)] };
  });
}

export async function updateMortgageAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.updateMortgage(ctx, txId, {
      status: formString(fd, "status"),
      appraisalStatus: formString(fd, "appraisalStatus"),
      underwritingStatus: formString(fd, "underwritingStatus"),
      note: formString(fd, "note"),
    });
    return { message: "Loan status updated.", revalidate: [txPath(txId)] };
  });
}

export async function addMortgageConditionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.addMortgageCondition(ctx, txId, formString(fd, "description") ?? "");
    return { revalidate: [txPath(txId)] };
  });
}

export async function satisfyMortgageConditionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.satisfyMortgageCondition(ctx, id(fd, "conditionId"));
    return { revalidate: [txPath(txId)] };
  });
}

export async function orderTitleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.orderTitle(ctx, txId, { titleCompany: formString(fd, "titleCompany") });
    return { message: "Title search started.", revalidate: [txPath(txId)] };
  });
}

export async function updateTitleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.updateTitle(ctx, txId, { status: formString(fd, "status"), insurancePolicyNumber: formString(fd, "insurancePolicyNumber") });
    return { message: "Title status updated.", revalidate: [txPath(txId)] };
  });
}

export async function addTitleIssueAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.addTitleIssue(ctx, txId, { kind: formString(fd, "kind"), description: formString(fd, "description"), amount: parseMoneyInput(formString(fd, "amount")) });
    return { revalidate: [txPath(txId)] };
  });
}

export async function resolveTitleIssueAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.resolveTitleIssue(ctx, id(fd, "issueId"));
    return { revalidate: [txPath(txId)] };
  });
}

export async function submitRecordingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.submitForRecording(ctx, txId);
    return { message: "Submitted for recording.", revalidate: [txPath(txId)] };
  });
}

export async function confirmRecordingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    const recordedAt = formString(fd, "recordedAt");
    await core.confirmRecording(ctx, txId, {
      recordingReference: formString(fd, "recordingReference"),
      registry: formString(fd, "registry"),
      recordedAt: recordedAt ? new Date(recordedAt).toISOString() : undefined,
      attestation: fd.get("attestation") === "on",
    });
    return { message: "Recording confirmed. Ownership has transferred.", revalidate: [txPath(txId), "/app"] };
  });
}

export async function requestDisbursementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.requestDisbursement(ctx, txId);
    return { message: "Disbursement requested from the escrow partner.", revalidate: [txPath(txId)] };
  });
}

// ----------------------------------------------------------------------------- messages & calendar

export async function sendMessageAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    await core.sendMessage(ctx, { threadId: id(fd, "threadId"), body: formString(fd, "body") ?? "", attachmentDocumentIds: fd.getAll("attachments").map(String) });
    return { revalidate: [`${txPath(txId)}/messages`] };
  });
}

export async function addCalendarEventAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const txId = id(fd);
    const startsAt = formString(fd, "startsAt");
    await core.addCalendarEvent(ctx, txId, {
      kind: formString(fd, "kind"),
      title: formString(fd, "title"),
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      location: formString(fd, "location"),
    });
    return { message: "Added to the transaction calendar.", revalidate: [txPath(txId)] };
  });
}
