/**
 * Inbound provider webhooks. The raw body is verified BEFORE parsing; the
 * pipeline enforces timestamps, schema, exactly-once recording and retries.
 * Responds 2xx only when the event is recorded (processed, duplicate or
 * ignored), so providers retry anything we failed to handle.
 */
import { getRuntime, handleWebhook, systemContext } from "@sagolik/core";
import { RATE_LIMITS } from "@sagolik/security";
import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/context";

const MAX_BODY_BYTES = 1_000_000;

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const rl = await rateLimit(`webhook:${provider}`, RATE_LIMITS.webhook);
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  const rt = await getRuntime();
  const outcome = await handleWebhook(systemContext(rt, `webhook:${provider}`), provider, raw, request.headers);
  return NextResponse.json({ status: outcome.status }, { status: outcome.httpStatus });
}
