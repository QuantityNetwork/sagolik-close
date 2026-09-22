import { listAudit } from "@sagolik/core";
import { api } from "@/lib/server/api";

/** GET /api/v1/audit/:transactionId?action=… — audit trail and state history (audit.view). */
export const GET = api<{ transactionId: string }>(async ({ req, ctx, params }) => {
  const action = new URL(req.url).searchParams.get("action") ?? undefined;
  const { events, transitions } = await listAudit(ctx, params.transactionId, { action });
  return { events, stateTransitions: transitions };
});
