import { listAudit, STATE_LABELS } from "@sagolik/core";
import { formatDateTime } from "@sagolik/i18n";
import { Card, CardBody, CardHeader, Table, Td, Th } from "@sagolik/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuditExport } from "@/components/app/audit-export";
import { loadTx } from "@/lib/server/tx";

export const metadata: Metadata = { title: "Audit trail" };

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, can, locale } = await loadTx(id);
  if (!can("audit.view")) notFound();
  const { events, transitions, names } = await listAudit(ctx, id, { limit: 300 });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="State history"
          description="Every stage change with who, when, why and from where. Append-only."
          action={can("audit.export") ? <AuditExport transactionId={id} /> : null}
        />
        <CardBody>
          <ol className="space-y-2 text-sm">
            {transitions.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="font-medium text-ink">{t.toState ? STATE_LABELS[t.toState].label : t.eventType}</span>
                  <span className="text-ink-3"> — {t.reason}</span>
                </span>
                <span className="text-[12px] text-ink-3">
                  {t.actorId ? (names[t.actorId] ?? "User") : "Workflow engine"} · {formatDateTime(t.occurredAt, locale)}
                </span>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Audit events" description={`${events.length} most recent`} />
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Who</Th>
              <Th>Action</Th>
              <Th>Resource</Th>
              <Th>Details</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-[12.5px] text-ink-3">{formatDateTime(e.occurredAt, locale)}</Td>
                <Td className="text-[13px]">{e.actorId ? (names[e.actorId] ?? e.actorId.slice(0, 8)) : e.actorType}</Td>
                <Td>
                  <code className="rounded bg-canvas px-1.5 py-0.5 text-[12px]">{e.action}</code>
                </Td>
                <Td className="text-[12.5px] text-ink-3">{e.resourceType}</Td>
                <Td className="max-w-md truncate text-[12px] text-ink-3" title={JSON.stringify(e.metadata)}>
                  {JSON.stringify(e.metadata)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
