import { requestSignatures } from "@sagolik/core";
import { api, jsonBody } from "@/lib/server/api";

/** POST /api/v1/documents/:id/signature-request — { signerParticipantIds, message? }. */
export const POST = api<{ id: string }>(async ({ req, ctx, params }) => {
  const sig = await requestSignatures(ctx, params.id, await jsonBody(req));
  return { id: sig.id, status: sig.status, provider: sig.provider, recipients: sig.recipients };
});
