import { transitionTransaction } from "@sagolik/core";
import { api, jsonBody } from "@/lib/server/api";

/** POST /api/v1/transactions/:id/transitions — { to, reason, expectedVersion }. Guards and permissions apply. */
export const POST = api<{ id: string }>(async ({ req, ctx, params }) => {
  const tx = await transitionTransaction(ctx, params.id, (await jsonBody(req)) as Parameters<typeof transitionTransaction>[2]);
  return { id: tx.id, state: tx.state, version: tx.version };
});
