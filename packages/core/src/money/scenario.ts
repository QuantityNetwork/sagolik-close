/**
 * The F1 money scenario (buyer wires from their own bank), shared by the
 * in-memory test and the integration test against the real Go money service.
 */
import { expect } from "vitest";
import { DEMO_TRANSACTION_ID } from "../demo/seed";
import { revealBankInstruction, verifyBankInstruction, createBankInstruction } from "../services/payments";
import { recordEscrowMovement } from "../services/escrow";
import type { TestHarness } from "../testing";
import { toAppError } from "../errors";

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return toAppError(e).code;
  }
}

export async function runF1Scenario(h: TestHarness) {
  const tx = DEMO_TRANSACTION_ID;
  const escrow = await h.as("marcus.lee", { stepUp: true });
  const title = await h.as("priya.shah", { stepUp: true });
  const buyer = await h.as("olivia.carter", { stepUp: true });
  const buyerNoStepUp = await h.as("olivia.carter");
  const agent = await h.as("jessica.morgan", { stepUp: true });

  const ins = await createBankInstruction(escrow, tx, {
    purpose: "earnest_money_to_escrow",
    beneficiaryName: "Maple Title & Escrow (Demo) — Trust Account",
    bankName: "Sandbox National Bank",
    accountNumber: "0005 5512 3456",
    routingIdentifier: "021000021",
    currency: "USD",
  });
  expect(ins).toMatchObject({ status: "pending_verification", accountMask: "3456", version: 1 });

  expect(await code(revealBankInstruction(buyer, ins.id))).toBe("bad_request"); // not verified yet
  expect(await code(verifyBankInstruction(escrow, ins.id, "out_of_band_call", "self"))).toBe("forbidden"); // author can't verify
  const verified = await verifyBankInstruction(title, ins.id, "out_of_band_call", "Called escrow on the number on file");
  expect(verified.status).toBe("verified");

  expect(await code(revealBankInstruction(buyerNoStepUp, ins.id))).toBe("step_up_required");
  expect(await code(revealBankInstruction(agent, ins.id))).toMatch(/forbidden|not_found/);
  const wire = await revealBankInstruction(buyer, ins.id);
  expect(wire).toMatchObject({ accountNumber: "000555123456", routingIdentifier: "021000021" });

  const before = (await h.db.escrow_accounts.findOne({ transactionId: tx }))!.receivedAmount;
  await recordEscrowMovement(escrow, tx, { kind: "receipt", amount: 1_000_000, reference: "Wire FW-20260924-7" });
  await recordEscrowMovement(escrow, tx, { kind: "receipt", amount: 1_000_000, reference: "Wire FW-20260924-7" }); // same entry
  const after = (await h.db.escrow_accounts.findOne({ transactionId: tx }))!.receivedAmount;
  expect(after - before).toBe(1_000_000);
  expect(await code(recordEscrowMovement(title, tx, { kind: "receipt", amount: 1, reference: "Wire X-1" }))).toBe("forbidden");
  expect(await code(recordEscrowMovement(escrow, tx, { kind: "disbursement", amount: after + 1, reference: "Payout P-1" }))).toBe("conflict");

  const audit = (await h.db.audit_events.find({ transactionId: tx })).map((e) => e.action);
  expect(audit).toEqual(expect.arrayContaining(["bank_instruction.created", "bank_instruction.verified", "bank_instruction.revealed", "escrow.movement_recorded"]));
  return { instructionId: ins.id, buyer };
}
