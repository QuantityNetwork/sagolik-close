import { getTransaction, transactionView } from "@sagolik/core";
import { api } from "@/lib/server/api";

/** GET /api/v1/transactions/:id/timeline — milestones with status, owner, deadline and health, plus closing blockers. */
export const GET = api<{ id: string }>(async ({ ctx, params }) => {
  const view = transactionView(ctx, await getTransaction(ctx, params.id));
  return {
    state: view.snapshot.transaction.state,
    stateLabel: view.stateLabel.label,
    progress: view.progress,
    currentMilestone: view.phase?.key ?? null,
    milestones: view.timeline.map((m) => ({
      key: m.key,
      label: m.label,
      health: m.health,
      complete: m.complete,
      current: m.current,
      detail: m.detail,
      ownerRole: m.ownerRole,
      owner: m.owner ? { id: m.owner.id, displayName: m.owner.displayName } : null,
      dueDate: m.dueDate,
      exceptions: m.exceptions,
      taskIds: m.tasks.map((t) => t.id),
      documentIds: m.documentIds,
    })),
    blockers: view.blockers.map((b) => ({ label: b.label, detail: b.detail, responsibleRole: b.responsibleRole })),
  };
});
