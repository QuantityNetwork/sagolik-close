import { openDocument } from "@sagolik/core";
import { api } from "@/lib/server/api";

/** GET /api/v1/documents/:id/download?version=n&inline=1 — authorized, audited, integrity-checked download. */
export const GET = api<{ id: string }>(async ({ req, ctx, params }) => {
  const sp = new URL(req.url).searchParams;
  const v = sp.get("version");
  const file = await openDocument(ctx, params.id, v ? Number(v) : undefined);
  if (file.kind === "redirect") return Response.redirect(file.url, 302);
  return new Response(Buffer.from(file.bytes), {
    headers: {
      "content-type": file.mimeType,
      "content-disposition": `${sp.get("inline") === "1" ? "inline" : "attachment"}; filename="${file.filename.replace(/["\r\n]/g, "")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      // Uploaded content is rendered in a sandbox so it can't run script in our origin.
      "content-security-policy": "sandbox",
    },
  });
});
