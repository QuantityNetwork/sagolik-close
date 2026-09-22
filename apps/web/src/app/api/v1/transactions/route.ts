import { createTransaction, listTransactionsForActor } from "@sagolik/core";
import { buildTimeline, progressPercent } from "@sagolik/workflow";
import { api, jsonBody } from "@/lib/server/api";

/** GET /api/v1/transactions — transactions visible to the caller. */
export const GET = api(async ({ ctx }) => {
  const items = await listTransactionsForActor(ctx);
  return items.map(({ snapshot: s, myRoles }) => ({
    id: s.transaction.id,
    reference: s.transaction.reference,
    state: s.transaction.state,
    property: { addressLine1: s.property.addressLine1, city: s.property.city, region: s.property.region, country: s.property.country },
    expectedClosingDate: s.transaction.expectedClosingDate,
    progress: progressPercent(buildTimeline(s)),
    myRoles,
  }));
});

/** POST /api/v1/transactions — open a transaction for one of the caller's organizations. */
export const POST = api(async ({ req, ctx }) => {
  const tx = await createTransaction(ctx, (await jsonBody(req)) as Parameters<typeof createTransaction>[1]);
  return { id: tx.id, reference: tx.reference, state: tx.state };
});
