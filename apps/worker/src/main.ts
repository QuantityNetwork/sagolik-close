import { getRuntime, loadFlags, systemContext } from "@sagolik/core";
import { runLoop, tick } from "./worker";

const log = (level: "info" | "error", msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, msg, service: "worker", at: new Date().toISOString(), ...extra }));

const rt = await getRuntime();
const makeContext = async () => systemContext(rt, "worker", await loadFlags(rt));
if (rt.mode === "memory") {
  log("info", "Demo mode uses an in-process store; events are processed inline by the web app. Nothing for the worker to do.");
  process.exit(0);
}

if (process.argv.includes("--once")) {
  log("info", "tick", { ...(await tick(await makeContext())) });
  process.exit(0);
}

const controller = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log("info", `received ${sig}, finishing current tick`);
    controller.abort();
  });
}
const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 2000);
log("info", "worker started", { intervalMs });
await runLoop(makeContext, {
  intervalMs,
  signal: controller.signal,
  onTick: (r) => {
    if (r.webhooksRetried || Object.values(r.events).some((n) => n > 0)) log("info", "tick", { ...r });
  },
  onError: (e) => log("error", "tick failed", { error: e instanceof Error ? e.message : String(e) }),
});
log("info", "worker stopped");
