/**
 * Upload validation. The declared Content-Type is never trusted: the MIME
 * type is derived from magic bytes and must match an allow-list.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;
export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

function startsWith(buf: Uint8Array, sig: number[], offset = 0): boolean {
  return sig.every((b, i) => buf[offset + i] === b);
}

export function sniffMime(buf: Uint8Array): AllowedMime | null {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...buf.slice(8, 12));
    if (["heic", "heix", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    // A zip container. Only accept if it looks like a Word document.
    const head = new TextDecoder("latin1").decode(buf.slice(0, Math.min(buf.length, 4096)));
    if (head.includes("word/") || head.includes("[Content_Types].xml")) {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
  }
  return null;
}

export type UploadCheck =
  | { ok: true; mime: AllowedMime; safeName: string }
  | { ok: false; reason: "too_large" | "empty" | "unsupported_type" | "active_content" };

/** Rejects PDFs that carry JavaScript / auto-actions — a common malware vector. */
function pdfHasActiveContent(buf: Uint8Array): boolean {
  const text = new TextDecoder("latin1").decode(buf);
  return /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction\s*<<[^>]*\/JS)/.test(text);
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\s]+/, "")
    .slice(0, 150);
  return cleaned || "file";
}

export function checkUpload(buf: Uint8Array, filename: string): UploadCheck {
  if (buf.length === 0) return { ok: false, reason: "empty" };
  if (buf.length > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };
  const mime = sniffMime(buf);
  if (!mime) return { ok: false, reason: "unsupported_type" };
  if (mime === "application/pdf" && pdfHasActiveContent(buf)) return { ok: false, reason: "active_content" };
  return { ok: true, mime, safeName: sanitizeFilename(filename) };
}

/**
 * Malware scanning is delegated to a scanner service (ClamAV sidecar, cloud
 * AV API). The mock implementation flags the EICAR test string so the
 * quarantine path can be exercised end to end.
 */
export interface VirusScanner {
  scan(buf: Uint8Array): Promise<{ clean: boolean; signature?: string }>;
}

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export class MockVirusScanner implements VirusScanner {
  async scan(buf: Uint8Array) {
    const text = new TextDecoder("latin1").decode(buf);
    return text.includes(EICAR) ? { clean: false, signature: "EICAR-Test-File" } : { clean: true };
  }
}
