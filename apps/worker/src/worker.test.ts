import { DEMO_TRANSACTION_ID, sendMessage } from "@sagolik/core";
import { createTestHarness } from "@sagolik/core/testing";
import { describe, expect, it } from "vitest";
import { runLoop, tick } from "./worker";

describe("worker", () => {
  it("delivers events queued by the web app in worker mode", async () => {
    const h = await createTestHarness();
    const olivia = { ...(await h.as("olivia.carter")), outboxMode: "worker" as const };
    const thread = (await h.db.message_threads.find({ transactionId: DEMO_TRANSACTION_ID })).find((t) => t.kind === "transaction_room") ?? (await h.db.message_threads.find({ transactionId: DEMO_TRANSACTION_ID }))[0]!;
    const before = await h.db.notifications.count({});
    await sendMessage(olivia, { threadId: thread.id, body: "@Jessica is the walkthrough still on Friday?", attachmentDocumentIds: [] });

    const pending = await h.db.domain_events.find({ status: "pending" });
    expect(pending.some((e) => e.eventType === "message.posted")).toBe(true);
    expect(await h.db.notifications.count({})).toBe(before); // nothing delivered yet

    const r = await tick(h.system("worker"));
    expect(Object.values(r.events).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(await h.db.domain_events.count({ status: "pending" })).toBe(0);
    expect(await h.db.notifications.count({})).toBeGreaterThan(before);
    // Bank activity (sandbox bank): the demo's snow removal, lawn care and lender figures.
    expect(r.bankActivityChanges).toBeGreaterThanOrEqual(3);

    // Idempotent: a second tick finds nothing to do.
    const again = await tick(h.system("worker"));
    expect(Object.values(again.events).reduce((a, b) => a + b, 0)).toBe(0);
    expect(again.bankActivityChanges).toBeNull(); // four times a day, not every tick
  }, 20_000);

  it("keeps looping after a failing tick and stops on abort", async () => {
    const controller = new AbortController();
    let calls = 0;
    const errors: unknown[] = [];
    const h = await createTestHarness({ seed: false });
    await runLoop(
      async () => {
        calls++;
        if (calls === 1) throw new Error("database unavailable");
        if (calls === 3) controller.abort();
        return h.system("worker");
      },
      { intervalMs: 1, signal: controller.signal, onError: (e) => errors.push(e) },
    );
    expect(errors).toHaveLength(1);
    expect(calls).toBe(3);
  }, 20_000);
});
