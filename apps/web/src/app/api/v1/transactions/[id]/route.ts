import { getTransaction, updateTransaction } from "@sagolik/core";
import { api, jsonBody } from "@/lib/server/api";
import { serializeSnapshot } from "@/lib/server/serialize";

type P = { id: string };

/** GET /api/v1/transactions/:id — the full transaction, filtered by the caller's permissions. */
export const GET = api<P>(async ({ ctx, params }) => serializeSnapshot(ctx, await getTransaction(ctx, params.id)));

/** PATCH /api/v1/transactions/:id — closing date, price, coordinator (optimistic concurrency via expectedVersion). */
export const PATCH = api<P>(async ({ req, ctx, params }) => {
  const tx = await updateTransaction(ctx, params.id, (await jsonBody(req)) as Parameters<typeof updateTransaction>[2]);
  return { id: tx.id, version: tx.version, expectedClosingDate: tx.expectedClosingDate, salePrice: tx.salePrice };
});
