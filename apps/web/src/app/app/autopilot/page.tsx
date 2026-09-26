import { autopilotHome, OWNER_ORG_TYPE_LABELS } from "@sagolik/core";
import { buttonClasses, Card, CardHeader, EmptyState, IconTile } from "@sagolik/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { setUpAutopilotAction } from "@/app/actions/autopilot";
import { ActionForm, SubmitButton } from "@/components/forms";
import { AttentionList, BASIS_LABEL, ContinuityBadge, LineAmount, Metric, MonitoringNote, money, SeverityTag, shortDate } from "@/components/app/autopilot";
import { requireContext } from "@/lib/server/context";

export const metadata: Metadata = { title: "Property Autopilot" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "protected", label: "Protected" },
] as const;

export default async function AutopilotHome({ searchParams }: { searchParams: Promise<{ status?: string; scope?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireContext("/app/autopilot");
  const home = await autopilotHome(ctx);
  const { summary } = home;
  const monitored = summary.properties - summary.notMonitored;
  const filter = FILTERS.some((f) => f.key === sp.status) ? sp.status! : "all";
  const rows = home.properties.filter((p) => (filter === "all" ? true : filter === "protected" ? p.assessment.status === "protected" : p.assessment.status === "attention" || p.assessment.status === "at_risk")).filter((p) => !sp.scope || p.scope.id === sp.scope);

  // The next 14 days across the portfolio, soonest first.
  const soon = home.properties
    .filter((p) => p.passport.monitoring === "monitor")
    .flatMap((p) => p.assessment.next30.lines.filter((l) => l.dueOn <= new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)).map((l) => ({ line: l, property: p })))
    .sort((a, b) => a.line.dueOn.localeCompare(b.line.dueOn))
    .slice(0, 12);

  const urgent = summary.attentionItems.filter((a) => a.severity === "urgent" || a.severity === "critical").length;

  return (
    <div className="container-page animate-rise py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-teal-700">Property Autopilot</p>
          <h1 className="mt-1 text-[34px] leading-tight text-navy-800">Your properties, continuously monitored.</h1>
          <div className="mt-2">
            <MonitoringNote />
          </div>
        </div>
        <Link href="/app/autopilot/import" className={buttonClasses("secondary", "sm")}>
          Add a property
        </Link>
      </div>

      {home.setup.map((s) => (
        <Card key={s.ownershipRecordId} className="mt-6 border-teal-100 bg-teal-50/40">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="font-medium text-navy-800">{s.address} closed through Sagolik</p>
              <p className="text-[13px] text-ink-2">Start monitoring it: Sagolik prepares its costs from the closing, and you confirm what it can't know for sure.</p>
            </div>
            <ActionForm action={setUpAutopilotAction}>
              <input type="hidden" name="ownershipRecordId" value={s.ownershipRecordId} />
              <SubmitButton pendingLabel="Preparing…">Set up Autopilot</SubmitButton>
            </ActionForm>
          </div>
        </Card>
      ))}

      {summary.properties === 0 ? (
        <Card className="mt-6">
          <EmptyState title="No properties yet" icon={<IconTile name="property" size="sm" />} action={<Link href="/app/autopilot/import" className={buttonClasses("primary", "sm")}>Add a property</Link>}>
            When you close through Sagolik, the property moves here automatically. You can also add a property you already own.
          </EmptyState>
        </Card>
      ) : (
        <>
          <section aria-label="Portfolio status" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Properties protected" value={`${summary.protected} of ${monitored}`} sub={summary.atRisk ? `${summary.atRisk} at risk` : summary.attention ? `${summary.attention} need attention` : "All clear"} tone={summary.protected === monitored ? "done" : undefined} />
            <Metric label="Next 30 days" value={money(summary.next30)} sub={`${money(summary.next7)} in the next 7 days`} />
            <Metric label="Funding coverage" value={summary.coverage === null ? "—" : `${(Math.floor(summary.coverage * 1000) / 10).toFixed(1)}%`} sub={`${money(summary.operatingAvailable)} in paying accounts${summary.suggestedTransfers ? ` · move ${money(summary.suggestedTransfers)} from reserves` : ""}`} tone={summary.coverage !== null && summary.coverage < 1 ? "attention" : undefined} />
            <Metric label="Needs attention" value={summary.attentionItems.length} sub={urgent ? `${urgent} urgent` : "Nothing urgent"} tone={urgent ? "attention" : undefined} />
          </section>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
            <Card>
              <CardHeader title="Needs attention" description="Everything else is running normally." />
              <AttentionList items={summary.attentionItems} empty="Nothing needs your attention. Everything is running normally." />
            </Card>

            <Card>
              <CardHeader title="Upcoming" description="The next 14 days. Predicted amounts are marked as expected." />
              {soon.length ? (
                <ul>
                  {soon.map(({ line, property }) => (
                    <li key={`${property.passport.id}-${line.obligationId}-${line.dueOn}`} className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 text-[13.5px] last:border-b-0">
                      <span className="w-14 shrink-0 text-ink-3">{shortDate(line.dueOn)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink">{line.label}</span>
                        <span className="block truncate text-[12px] text-ink-3">
                          {property.passport.label} · {BASIS_LABEL[line.basis]}
                        </span>
                      </span>
                      <LineAmount line={line} currency={property.property?.currency} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-6 text-sm text-ink-3">Nothing due in the next 14 days.</p>
              )}
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader
              title="Portfolio"
              description={`${summary.properties} ${summary.properties === 1 ? "property" : "properties"}`}
              action={
                <nav aria-label="Filter" className="flex gap-1">
                  {FILTERS.map((f) => (
                    <Link key={f.key} href={f.key === "all" ? "/app/autopilot" : `/app/autopilot?status=${f.key}`} aria-current={filter === f.key ? "page" : undefined} className={filter === f.key ? "rounded-full bg-navy-800 px-3 py-1 text-[12px] text-white" : "rounded-full px-3 py-1 text-[12px] text-ink-2 hover:bg-navy-50"}>
                      {f.label}
                    </Link>
                  ))}
                </nav>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13.5px]">
                <thead className="border-b border-line text-[12px] uppercase tracking-wide text-ink-3">
                  <tr>
                    <th className="px-5 py-2 font-medium">Property</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Next 30 days</th>
                    <th className="px-3 py-2 font-medium">Paying account</th>
                    <th className="px-5 py-2 font-medium">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const f = p.assessment.funding[0];
                    return (
                      <tr key={p.passport.id} className="border-b border-line last:border-b-0 hover:bg-canvas/60">
                        <td className="px-5 py-3">
                          <Link href={`/app/autopilot/${p.passport.id}`} className="font-medium text-navy-800 hover:underline">
                            {p.passport.label}
                          </Link>
                          <span className="block text-[12px] text-ink-3">{p.property ? `${p.property.city}, ${p.property.region}` : ""}</span>
                        </td>
                        <td className="px-3 py-3">
                          <ContinuityBadge status={p.assessment.status} />
                          {p.assessment.attention.length ? <span className="ml-2 text-[12px] text-ink-3">{p.assessment.attention.length} open</span> : null}
                        </td>
                        <td className="num px-3 py-3 text-right">{money(p.assessment.next30.total, p.property?.currency)}</td>
                        <td className="px-3 py-3 text-[12.5px] text-ink-2">{!f ? "—" : f.status === "covered" ? "Covered" : f.status === "shortfall_reserve_can_cover" ? `Short ${money(f.shortfall)} · reserve can cover` : f.status === "shortfall" ? `Short ${money(f.shortfall)}` : f.status === "no_account" ? "Not set" : "Balance unavailable"}</td>
                        <td className="px-5 py-3 text-[12.5px] text-ink-3">{p.scope.name}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {home.recent.length ? (
            <Card className="mt-6">
              <CardHeader title="Recent activity" description="What Sagolik concluded, and why. Routine items stay here instead of notifying you." />
              <ul>
                {home.recent.map((d) => (
                  <li key={d.id} className="flex items-start gap-3 border-b border-line px-5 py-3 text-[13.5px] last:border-b-0">
                    <span className="w-14 shrink-0 text-ink-3">{shortDate(d.createdAt.slice(0, 10))}</span>
                    <span className="min-w-0 flex-1">
                      <span className="text-ink">{d.summary}</span>
                      <span className="block text-[12px] text-ink-3">{home.properties.find((p) => p.passport.id === d.passportId)?.passport.label}</span>
                    </span>
                    {d.severity !== "info" ? <SeverityTag severity={d.severity} /> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {home.scopes.length > 1 ? (
            <p className="mt-4 text-[12.5px] text-ink-3">
              Portfolios:{" "}
              {home.scopes.map((s, i) => (
                <span key={s.id}>
                  {i ? " · " : ""}
                  <Link href={`/app/autopilot?scope=${s.id}`} className="hover:underline">
                    {s.name}
                  </Link>{" "}
                  ({OWNER_ORG_TYPE_LABELS[s.type as keyof typeof OWNER_ORG_TYPE_LABELS]})
                </span>
              ))}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
