import { inviteParticipant } from "@sagolik/core";
import { api, jsonBody } from "@/lib/server/api";

/** POST /api/v1/transactions/:id/participants — { role, displayName, email }. */
export const POST = api<{ id: string }>(async ({ req, ctx, params }) => {
  const p = await inviteParticipant(ctx, params.id, (await jsonBody(req)) as Parameters<typeof inviteParticipant>[2]);
  return { id: p.id, role: p.role, displayName: p.displayName, status: p.status };
});
