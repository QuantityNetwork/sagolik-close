import { adminOverview, adminSearchAudit, getRuntime } from "@sagolik/core";
import { OutboxEmailProvider } from "@sagolik/integrations";
import { formatDateTime } from "@sagolik/i18n";
import { Alert, Card, CardBody, CardHeader, IntegrationStatus, StatusBadge, Table, Td, Th } from "@sagolik/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminRetryWebhookAction, adminSetFlagAction } from "@/app/actions/governance";
import { Logo } from "@/components/brand";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { requireContext } from "@/lib/server/context";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const sp = await searchParams;
  const { ctx, actor } = await requireContext("/admin");
  if (!actor.isPlatformAdmin) notFound();
  const o = await adminOverview(ctx);
  const audit = await adminSearchAudit(ctx, { action: sp.action || undefined, limit: 50 });
  const rt = await getRuntime();
  const outbox = rt.providers.email instanceof OutboxEmailProvider ? rt.providers.email.sent.slice(0, 15) : null;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-navy-800">
        <div className="container-page flex h-16 items-center justify-between">
          <Logo variant="light" className="h-7 w-auto" href="/app" />
          <span className="rounded-full bg-white/10 px-3 py-1 text-[12px] font-medium text-white">Internal admin</span>
        </div>
      </header>
      <main id="main" className="container-page space-y-6 py-8">
        <Alert tone="info" title="Privileged access is audited">
          Every view here is recorded in the audit log. This console shows operational metadata only — no documents, balances or account numbers — and grants no access to transaction contents.
        </Alert>

        <div className="grid gap-4 md:grid-cols-4">
          {[
            ["Organizations", o.organizations.length],
            ["Users", o.users.length],
            ["Transactions", o.totalTransactions],
            ["Unresolved security signals", o.securitySignals.length],
          ].map(([k, v]) => (
            <Card key={k as string} className="p-4">
              <p className="font-display text-[32px] text-navy-800 num">{v}</p>
              <p className="text-[13px] text-ink-3">{k}</p>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Integration health" description="Mode per provider. Production refuses to start on sandbox adapters for regulated functions." />
            <ul>
              {o.integrations.map((i) => (
                <li key={i.id} className="flex items-center justify-between border-b border-line px-5 py-2.5 text-sm last:border-b-0">
                  <span>
                    {i.displayName} <code className="text-[11px] text-ink-3">{i.id}</code>
                  </span>
                  <IntegrationStatus mode={i.mode} />
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Feature flags" description="Gradual rollout per environment and organization. Changes require step-up." />
            <ul>
              {o.flags.map((f) => (
                <li key={f.key} className="border-b border-line px-5 py-3 last:border-b-0">
                  <ActionForm action={adminSetFlagAction} className="flex flex-wrap items-center justify-between gap-2">
                    <input type="hidden" name="key" value={f.key} />
                    <span className="text-sm">
                      <code className="text-[12px]">{f.key}</code>
                      <span className="block text-[12px] text-ink-3">{f.description}</span>
                    </span>
                    <span className="flex items-center gap-2 text-[13px]">
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" name="enabled" defaultChecked={f.enabled} className="accent-navy-800" /> On
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="number" name="rolloutPercent" min={0} max={100} defaultValue={f.rolloutPercent} className="w-16 rounded border border-line-strong px-1.5 py-0.5" aria-label="Rollout percent" />%
                      </label>
                      <SubmitButton size="sm" variant="ghost">
                        Save
                      </SubmitButton>
                    </span>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Webhook failures" description="Failed and dead-lettered provider events." />
            {o.failedWebhooks.length ? (
              <ul>
                {o.failedWebhooks.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5 text-[13px] last:border-b-0">
                    <span>
                      <code>{w.provider}</code> · {w.eventType} · {w.attempts} attempt(s)
                      <span className="block text-ink-3">{w.error}</span>
                    </span>
                    <ActionButton action={adminRetryWebhookAction} fields={{ webhookEventId: w.id }}>
                      Retry
                    </ActionButton>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody className="text-sm text-ink-3">No failures.</CardBody>
            )}
          </Card>
          <Card>
            <CardHeader title="Security signals" />
            {o.securitySignals.length ? (
              <ul>
                {o.securitySignals.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5 text-[13px] last:border-b-0">
                    <span>
                      {s.kind.replace(/_/g, " ")} · controls: {s.controls.join(", ")}
                      <span className="block text-ink-3">{formatDateTime(s.createdAt, "en")}</span>
                    </span>
                    <StatusBadge tone={s.riskLevel === "critical" || s.riskLevel === "high" ? "blocked" : "attention"}>{s.riskLevel}</StatusBadge>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody className="text-sm text-ink-3">No unresolved signals.</CardBody>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader title="Organizations" />
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Jurisdiction</Th>
                <Th>Transactions</Th>
              </tr>
            </thead>
            <tbody>
              {o.organizations.map((org) => (
                <tr key={org.id}>
                  <Td>{org.name}</Td>
                  <Td>{org.type.replace(/_/g, " ")}</Td>
                  <Td>{org.jurisdiction}</Td>
                  <Td className="num">{org.transactions}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Audit search" description="Platform-wide, most recent first." />
          <CardBody>
            <form className="flex gap-2" action="/admin">
              <label htmlFor="action" className="sr-only">
                Action
              </label>
              <input id="action" name="action" defaultValue={sp.action ?? ""} placeholder="e.g. payment.settled" className="h-9 flex-1 rounded-lg border border-line-strong px-3 text-sm" />
              <button className="rounded-full bg-navy-800 px-4 text-sm text-white">Search</button>
            </form>
          </CardBody>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Action</Th>
                <Th>Actor</Th>
                <Th>Transaction</Th>
              </tr>
            </thead>
            <tbody>
              {audit.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-[12.5px] text-ink-3">{formatDateTime(e.occurredAt, "en")}</Td>
                  <Td>
                    <code className="text-[12px]">{e.action}</code>
                  </Td>
                  <Td className="text-[12.5px]">{e.actorId ? (o.users.find((u) => u.id === e.actorId)?.fullName ?? e.actorId.slice(0, 8)) : e.actorType}</Td>
                  <Td className="text-[12px] text-ink-3">{e.transactionId?.slice(0, 8) ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        {outbox ? (
          <Card>
            <CardHeader title="Email outbox (demo)" description="In demo mode emails are captured here instead of being sent." />
            <ul>
              {outbox.map((m) => (
                <li key={m.id} className="border-b border-line px-5 py-2.5 text-[13px] last:border-b-0">
                  <span className="font-medium">{m.subject}</span> → {m.to} <span className="text-ink-3">· {formatDateTime(m.at, "en")}</span>
                </li>
              ))}
              {outbox.length === 0 ? <li className="px-5 py-3 text-sm text-ink-3">Nothing sent yet.</li> : null}
            </ul>
          </Card>
        ) : null}
        <p className="text-sm text-ink-3">
          <Link href="/app" className="text-teal-700 hover:underline">
            Back to the app
          </Link>
        </p>
      </main>
    </div>
  );
}
