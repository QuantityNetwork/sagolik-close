import { exportDealRecord } from "@sagolik/core";
import { api } from "@/lib/server/api";

/** GET /api/v1/transactions/:id/deal-record — the receipts behind the on-chain deal record, to verify independently. */
export const GET = api<{ id: string }>(async ({ ctx, params }) => {
  const record = await exportDealRecord(ctx, params.id);
  return new Response(JSON.stringify(record, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="deal-record-${record.reference.replace(/[^A-Za-z0-9-]/g, "")}.json"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
