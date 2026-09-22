/**
 * Webhook signature verification.
 *
 * Canonical scheme (used by our mock providers and compatible with Stripe's):
 *   header:  t=<unix seconds>,v1=<hex hmac-sha256(secret, `${t}.${rawBody}`)>
 *
 * Real provider adapters map their own scheme onto `WebhookVerifier`.
 * Verification ALWAYS runs on the raw request body, before JSON parsing.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_WEBHOOK_TOLERANCE_SEC = 300;

export type WebhookVerification =
  | { ok: true; timestamp: number }
  | { ok: false; reason: "missing_header" | "malformed_header" | "timestamp_out_of_range" | "bad_signature" };

export function signWebhookPayload(rawBody: string, secret: string, timestampSec = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${timestampSec}.${rawBody}`).digest("hex");
  return `t=${timestampSec},v1=${sig}`;
}

export function verifyWebhookSignature(opts: {
  rawBody: string;
  header: string | null | undefined;
  secret: string;
  toleranceSec?: number;
  nowSec?: number;
}): WebhookVerification {
  const { rawBody, header, secret } = opts;
  if (!header) return { ok: false, reason: "missing_header" };
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return i === -1 ? [kv.trim(), ""] : [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return { ok: false, reason: "malformed_header" };
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceSec ?? DEFAULT_WEBHOOK_TOLERANCE_SEC;
  if (Math.abs(now - t) > tolerance) return { ok: false, reason: "timestamp_out_of_range" };
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(v1, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };
  return { ok: true, timestamp: t };
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}
