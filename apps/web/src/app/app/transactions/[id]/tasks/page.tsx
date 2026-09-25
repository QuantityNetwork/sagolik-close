import { roleLabel } from "@sagolik/core";
import { formatDate } from "@sagolik/i18n";
import type { Task } from "@sagolik/types";
import { Card, CardBody, CardHeader, EmptyState, Field, Input, Select, StatusBadge, Textarea } from "@sagolik/ui";
import { MILESTONE_LABELS } from "@sagolik/workflow";
import { CheckCircle2, ListChecks } from "lucide-react";
import type { Metadata } from "next";
import { createTaskAction, updateTaskAction } from "@/app/actions/transaction";
import { TaskAction } from "@/components/app/next-step";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { loadTx } from "@/lib/server/tx";

export const metadata: Metadata = { title: "Tasks" };

const PRIORITY_TONE = { urgent: "blocked", high: "attention", normal: "progress", low: "neutral" } as const;
const STATUS_LABEL = { todo: "To do", in_progress: "In progress", blocked: "Blocked", waiting: "Waiting", complete: "Complete", waived: "Waived" } as const;
const SELF_COMPLETING = new Set(["verify_identity", "connect_bank", "sign_document", "transfer_funds", "declare_source_of_funds", "upload_document"]);

export default async function TasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { snapshot: s, view, can, locale, actor } = await loadTx(id);
  const mine = new Set(s.participants.filter((p) => p.userId === actor.userId).map((p) => p.id));
  const manager = can("task.manage");
  const open = view.openTasks;
  const done = s.tasks.filter((t) => t.status === "complete" || t.status === "waived");
  const assignee = (t: Task) => s.participants.find((p) => p.id === t.assigneeParticipantId);

  const row = (t: Task) => {
    const who = assignee(t);
    const isMine = !!t.assigneeParticipantId && mine.has(t.assigneeParticipantId);
    return (
      <li key={t.id} id={`task-${t.id}`} className="scroll-mt-24 border-b border-line px-5 py-4 last:border-b-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-ink">{t.title}</p>
            {t.description ? <p className="mt-0.5 text-sm text-ink-3">{t.description}</p> : null}
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
              <StatusBadge tone={PRIORITY_TONE[t.priority]}>{t.priority}</StatusBadge>
              <span>{STATUS_LABEL[t.status]}</span>
              {who ? <span>· {isMine ? "You" : `${who.displayName} (${roleLabel(who.role, s.transaction.jurisdiction)})`}</span> : null}
              {t.dueDate ? <span>· Due {formatDate(t.dueDate, locale)}</span> : null}
              {t.milestoneKey ? <span>· {MILESTONE_LABELS[t.milestoneKey]}</span> : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isMine ? <TaskAction task={t} transactionId={id} variant="primary" /> : null}
            {(isMine && !SELF_COMPLETING.has(t.actionKind)) || manager ? (
              <ActionButton action={updateTaskAction} fields={{ transactionId: id, taskId: t.id, status: "complete" }}>
                Mark done
              </ActionButton>
            ) : null}
            {manager ? (
              <ActionButton action={updateTaskAction} fields={{ transactionId: id, taskId: t.id, status: "waived" }} variant="ghost" confirm="Waive this task? It will no longer be required.">
                Waive
              </ActionButton>
            ) : null}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="For you" description="Tasks assigned to you that you can do now." />
          {view.myTasks.length ? (
            <ul>{view.myTasks.map(row)}</ul>
          ) : (
            <EmptyState title="You're all caught up" icon={<CheckCircle2 className="h-8 w-8" aria-hidden />}>
              We'll let you know when something needs you.
            </EmptyState>
          )}
        </Card>
        <Card>
          <CardHeader title="All open tasks" description={`${open.length} open across every party`} />
          {open.length ? <ul>{open.map(row)}</ul> : <EmptyState title="No open tasks" icon={<ListChecks className="h-8 w-8" aria-hidden />} />}
        </Card>
        {done.length ? (
          <details className="rounded-[var(--radius-card)] border border-line bg-paper">
            <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-ink">Completed ({done.length})</summary>
            <ul className="border-t border-line">
              {done.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 text-sm last:border-b-0">
                  <span className="text-ink-2">{t.title}</span>
                  <span className="text-[12px] text-ink-3">
                    {STATUS_LABEL[t.status]}
                    {t.completedAt ? ` · ${formatDate(t.completedAt, locale)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      {manager ? (
        <Card className="h-fit">
          <CardHeader title="Add a task" />
          <CardBody>
            <ActionForm action={createTaskAction} className="space-y-3" resetOnSuccess>
              <input type="hidden" name="transactionId" value={id} />
              <Field label="Title" htmlFor="title">
                <Input id="title" name="title" required minLength={3} maxLength={160} />
              </Field>
              <Field label="Details" htmlFor="description">
                <Textarea id="description" name="description" maxLength={2000} className="min-h-16" />
              </Field>
              <Field label="Assign to" htmlFor="assigneeParticipantId">
                <Select id="assigneeParticipantId" name="assigneeParticipantId" defaultValue="">
                  <option value="">Unassigned</option>
                  {s.participants
                    .filter((p) => p.status !== "removed")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName} — {roleLabel(p.role, s.transaction.jurisdiction)}
                      </option>
                    ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Priority" htmlFor="priority">
                  <Select id="priority" name="priority" defaultValue="normal">
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </Select>
                </Field>
                <Field label="Due" htmlFor="dueDate">
                  <Input id="dueDate" name="dueDate" type="date" />
                </Field>
              </div>
              <SubmitButton>Add task</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
