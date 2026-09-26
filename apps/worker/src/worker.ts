/**
 * Background worker: delivers outbox domain events (notifications, reactions,
 * workflow reconciliation), retries failed provider webhooks, and re-checks
 * Property Autopilot portfolios (dates move even when nothing else changes).
 *
 * In Supabase mode the web app only *records* events; this process is what
 * acts on them, so several instances can run safely — every row is claimed
 * with a conditional update before it is processed.
 */
import { drainOutbox, retryFailedWebhooks, runAutopilotChecks, type ServiceContext } from "@sagolik/core";

export interface TickResult {
  events: Record<string, number>;
  webhooksRetried: number;
  /** New Autopilot decisions logged this tick (null when the check didn't run). */
  autopilotDecisions: number | null;
}

/** Portfolio checks are idempotent but not free; once every 15 minutes is plenty for due dates. */
export const AUTOPILOT_CHECK_INTERVAL_MS = 15 * 60_000;
let lastAutopilotCheck = 0;

export async function tick(ctx: ServiceContext, now = Date.now()): Promise<TickResult> {
  const events = await drainOutbox(ctx, 100);
  const webhooksRetried = await retryFailedWebhooks(ctx, 25);
  let autopilotDecisions: number | null = null;
  if (now - lastAutopilotCheck >= AUTOPILOT_CHECK_INTERVAL_MS) {
    lastAutopilotCheck = now;
    autopilotDecisions = await runAutopilotChecks(ctx);
  }
  return { events, webhooksRetried, autopilotDecisions };
}

export interface LoopOptions {
  intervalMs: number;
  signal: AbortSignal;
  onTick?: (r: TickResult) => void;
  onError?: (e: unknown) => void;
}

/** Runs `tick` until aborted. A failing tick is logged and retried on the next interval — never crashes the loop. */
export async function runLoop(makeContext: () => Promise<ServiceContext>, opts: LoopOptions): Promise<void> {
  while (!opts.signal.aborted) {
    try {
      // Evaluate first: `onTick?.(await tick())` would skip the tick entirely when no callback is given.
      const result = await tick(await makeContext());
      opts.onTick?.(result);
    } catch (e) {
      opts.onError?.(e);
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, opts.intervalMs);
      opts.signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
    });
  }
}
