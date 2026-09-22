import { can } from "@sagolik/auth";
import { accessContext, AppError, getTransaction } from "@sagolik/core";
import { api } from "@/lib/server/api";

/** GET /api/v1/escrow/:transactionId — escrow status, conditions, ledger and verified instructions (financial.view). */
export const GET = api<{ transactionId: string }>(async ({ ctx, actor, params }) => {
  const s = await getTransaction(ctx, params.transactionId);
  if (!can(actor, "financial.view", accessContext(s))) throw new AppError("forbidden", "You don't have access to escrow details on this transaction.", 403);
  const ledger = s.escrow ? await ctx.db.escrow_transactions.find({ escrowAccountId: s.escrow.id }, { orderBy: "occurredAt" }) : [];
  return {
    escrow: s.escrow,
    outstanding: s.escrow ? Math.max(0, s.escrow.requiredAmount - s.escrow.receivedAmount) : null,
    conditions: s.escrowConditions,
    ledger,
    instructions: s.bankInstructions.map(({ encryptedAccountNumber: _secret, ...rest }) => rest),
  };
});
