import { exportCalendarIcs } from "@sagolik/core";
import { api } from "@/lib/server/api";

/** GET /api/v1/transactions/:id/calendar — ICS feed for Google, Outlook and Apple calendars. */
export const GET = api<{ id: string }>(async ({ ctx, params }) => {
  const ics = await exportCalendarIcs(ctx, params.id);
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="closing-${params.id.slice(0, 8)}.ics"`,
      "cache-control": "private, no-store",
    },
  });
});
