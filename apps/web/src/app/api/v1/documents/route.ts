import { AppError, uploadDocument } from "@sagolik/core";
import { RATE_LIMITS } from "@sagolik/security";
import type { AccessLevel, DocumentCategory } from "@sagolik/types";
import { api } from "@/lib/server/api";

/** POST /api/v1/documents — multipart: file, transactionId, name, category, accessLevel?, documentId? (new version). */
export const POST = api(
  async ({ req, ctx }) => {
    const fd = await req.formData().catch(() => null);
    const file = fd?.get("file");
    if (!fd || !(file instanceof File)) throw new AppError("bad_request", "Send multipart/form-data with a file.", 400);
    const { document, version } = await uploadDocument(ctx, {
      transactionId: String(fd.get("transactionId") ?? ""),
      documentId: fd.get("documentId") ? String(fd.get("documentId")) : undefined,
      name: String(fd.get("name") ?? file.name),
      category: String(fd.get("category") ?? "other") as DocumentCategory,
      accessLevel: fd.get("accessLevel") ? (String(fd.get("accessLevel")) as AccessLevel) : undefined,
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return {
      document,
      version: { version: version.version, sha256: version.sha256, sizeBytes: version.sizeBytes, mimeType: version.mimeType, extractedFields: version.extractedFields },
    };
  },
  { rateLimit: RATE_LIMITS.upload },
);
