import { initiatePayment } from "@sagolik/core";
import { api, jsonBody } from "@/lib/server/api";

/**
 * POST /api/v1/payments — initiate a transfer to verified instructions.
 * Requires a fresh step-up and (by default) a second approver. Send an
 * Idempotency-Key header; retries with the same key return the same payment.
 */
export const POST = api(async ({ req, ctx }) => {
  const p = await initiatePayment(ctx, await jsonBody(req), req.headers.get("idempotency-key") ?? undefined);
  return { id: p.id, status: p.status, amount: p.amount, currency: p.currency, requiresDualApproval: p.requiresDualApproval };
});
