/** A bill's uploaded document, for members of the owning portfolio only (audited). */
import { billFile, toAppError } from "@sagolik/core";
import { NextResponse } from "next/server";
import { contextFor } from "@/lib/server/context";
import { getActor } from "@/lib/server/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: { code: "unauthenticated", message: "Please sign in." } }, { status: 401 });
  const { id } = await params;
  try {
    const f = await billFile(await contextFor(actor), id);
    const type = f.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : f.name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    return new NextResponse(Buffer.from(f.bytes), {
      headers: {
        "content-type": type,
        "content-disposition": `inline; filename="${f.name.replace(/"/g, "")}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    const err = toAppError(e);
    return NextResponse.json({ error: { code: err.code, message: err.userMessage } }, { status: err.code === "not_found" ? 404 : err.status });
  }
}
