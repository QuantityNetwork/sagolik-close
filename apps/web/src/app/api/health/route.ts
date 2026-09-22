import { getRuntime } from "@sagolik/core";
import { NextResponse } from "next/server";

/** Liveness + configuration summary (no secrets). */
export async function GET() {
  const rt = await getRuntime();
  const started = Date.now();
  let database = "ok";
  try {
    await rt.serviceDb.plans.count({});
  } catch {
    database = "error";
  }
  return NextResponse.json(
    {
      status: database === "ok" ? "ok" : "degraded",
      mode: rt.mode,
      environment: rt.env.APP_ENV,
      demo: rt.env.demoMode,
      database,
      latencyMs: Date.now() - started,
      providers: Object.fromEntries((["banking", "identity", "signatures", "payments", "escrow", "email", "sms"] as const).map((k) => [k, rt.providers[k].info.mode])),
    },
    { status: database === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
