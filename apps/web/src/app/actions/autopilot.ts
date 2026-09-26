"use server";
/**
 * Property Autopilot actions. Monitoring only: nothing here pays or moves
 * money. Every action goes through @sagolik/core, which checks portfolio
 * membership and writes the audit trail.
 */
import * as core from "@sagolik/core";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { formString, parseAmount, runAction } from "@/lib/server/action";
import { requireContext } from "@/lib/server/context";

const base = (id: string) => `/app/autopilot/${id}`;

function amount(fd: FormData, key: string, label: string, required = false): number | null {
  const v = parseAmount(formString(fd, key));
  if (v === null) throw core.badRequest(`${label} must be an amount like 1,250.00.`);
  if (v === undefined) {
    if (required) throw core.badRequest(`Enter the ${label.toLowerCase()}.`);
    return null;
  }
  return v;
}

const orNull = (v: string | undefined) => v ?? null;

export async function setUpAutopilotAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target: string | null = null;
  const r = await runAction(async () => {
    const { ctx } = await requireContext();
    const passport = await core.setUpFromHomeRecord(ctx, formString(fd, "ownershipRecordId") ?? "");
    target = `${base(passport.id)}/live`;
    return { revalidate: ["/app"] };
  });
  if (r.ok && target) redirect(target);
  return r;
}

export async function importPropertyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target: string | null = null;
  const r = await runAction(async () => {
    const { ctx } = await requireContext();
    const passport = await core.importProperty(ctx, {
      organizationId: formString(fd, "organizationId"),
      label: formString(fd, "label"),
      addressLine1: formString(fd, "addressLine1"),
      city: formString(fd, "city"),
      region: formString(fd, "region")?.toUpperCase(),
      postalCode: formString(fd, "postalCode"),
      propertyType: formString(fd, "propertyType"),
      acquiredOn: formString(fd, "acquiredOn"),
    });
    target = `${base(passport.id)}/costs`;
    return { revalidate: ["/app"] };
  });
  if (r.ok && target) redirect(target);
  return r;
}

export async function addBillAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const passportId = formString(fd, "passportId") ?? "";
    const file = fd.get("file");
    const upload = file instanceof File && file.size > 0 ? { bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name } : undefined;
    await core.addBill(ctx, passportId, { obligationId: formString(fd, "obligationId"), amount: amount(fd, "amount", "Amount", true), dueOn: formString(fd, "dueOn"), periodLabel: orNull(formString(fd, "periodLabel")) }, upload);
    return { message: "Bill added. Sagolik has checked it against your rules.", revalidate: [base(passportId), "/app/autopilot"] };
  });
}

export async function markBillPaidAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    await core.markBillPaid(ctx, formString(fd, "billId") ?? "", { paidOn: formString(fd, "paidOn"), reference: formString(fd, "reference") });
    return { message: "Marked as paid.", revalidate: ["/app/autopilot"] };
  });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Read-only: compares the linked accounts' posted transactions and the lender's figures with this property's bills and costs. */
export async function checkBankActivityAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const r = await core.syncBankActivity(ctx, formString(fd, "passportId") ?? "");
    const found = [
      r.verified ? `${plural(r.verified, "payment", "payments")} confirmed` : null,
      r.suggested ? `${plural(r.suggested, "recurring cost", "recurring costs")} to confirm (Costs tab)` : null,
      r.lenderUpdates ? "mortgage updated from the lender" : null,
    ].filter(Boolean);
    const summary = found.length ? `Checked: ${found.join(", ")}.` : r.accountsRead ? "Checked: nothing new." : "Nothing was checked.";
    return { message: [summary, ...r.notes].join(" "), revalidate: ["/app/autopilot"] };
  });
}

export async function reviewBillAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    await core.reviewBill(ctx, formString(fd, "billId") ?? "");
    return { message: "Marked as reviewed.", revalidate: ["/app/autopilot"] };
  });
}

export async function billStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    await core.setBillStatus(ctx, formString(fd, "billId") ?? "", { status: formString(fd, "status") });
    return { revalidate: ["/app/autopilot"] };
  });
}

function obligationFields(fd: FormData) {
  return {
    kind: formString(fd, "kind"),
    label: formString(fd, "label"),
    priority: formString(fd, "priority"),
    amountType: formString(fd, "amountType"),
    expectedAmount: amount(fd, "expectedAmount", "Usual amount"),
    expectedMin: amount(fd, "expectedMin", "Low end"),
    expectedMax: amount(fd, "expectedMax", "High end"),
    frequency: formString(fd, "frequency"),
    nextDueOn: orNull(formString(fd, "nextDueOn")),
    graceDays: Number(formString(fd, "graceDays") ?? "0"),
    payMethod: formString(fd, "payMethod"),
    escrowStatus: formString(fd, "escrowStatus"),
    fundingAccountId: orNull(formString(fd, "fundingAccountId")),
    referenceLast4: orNull(formString(fd, "referenceLast4")),
    payeeMatch: orNull(formString(fd, "payeeMatch")),
    vendorName: orNull(formString(fd, "vendorName")),
    vendorCategory: null,
  };
}

export async function addObligationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const passportId = formString(fd, "passportId") ?? "";
    await core.addObligation(ctx, passportId, obligationFields(fd));
    return { message: "Cost added. Sagolik is now monitoring it.", revalidate: [base(passportId), "/app/autopilot"] };
  });
}

export async function updateObligationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const { kind: _k, ...fields } = obligationFields(fd);
    const status = formString(fd, "status");
    await core.updateObligation(ctx, formString(fd, "obligationId") ?? "", { ...fields, ...(status ? { status } : {}) });
    return { message: status === "active" ? "Confirmed. Sagolik is now monitoring it." : "Saved.", revalidate: ["/app/autopilot"] };
  });
}

export async function confirmObligationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    await core.updateObligation(ctx, formString(fd, "obligationId") ?? "", { status: formString(fd, "status") ?? "active" });
    return { revalidate: ["/app/autopilot"] };
  });
}

export async function updateFundingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const passportId = formString(fd, "passportId") ?? "";
    await core.updateFunding(ctx, passportId, {
      operatingAccountId: orNull(formString(fd, "operatingAccountId")),
      reserveAccountId: orNull(formString(fd, "reserveAccountId")),
      minOperatingBalance: amount(fd, "minOperatingBalance", "Minimum balance") ?? 0,
      targetOperatingBalance: amount(fd, "targetOperatingBalance", "Target balance") ?? 0,
    });
    return { message: "Funding rules saved.", revalidate: [base(passportId), "/app/autopilot"] };
  });
}

export async function savePolicyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    await core.savePolicy(ctx, formString(fd, "organizationId") ?? "", formString(fd, "policyId") ?? null, {
      name: formString(fd, "name"),
      obligationKind: orNull(formString(fd, "obligationKind")),
      minAmount: amount(fd, "minAmount", "From amount") ?? 0,
      maxAmount: amount(fd, "maxAmount", "Up to amount"),
      action: formString(fd, "action"),
      enabled: formString(fd, "enabled") !== "false",
    });
    return { message: "Rule saved.", revalidate: ["/app/autopilot"] };
  });
}

export async function setMonitoringAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const passportId = formString(fd, "passportId") ?? "";
    await core.setMonitoring(ctx, passportId, formString(fd, "monitoring") === "monitor" ? "monitor" : "off");
    return { revalidate: [base(passportId), "/app/autopilot"] };
  });
}
