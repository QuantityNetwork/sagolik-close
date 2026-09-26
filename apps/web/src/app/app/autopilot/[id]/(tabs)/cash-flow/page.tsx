import { Card, CardBody, CardHeader, cn } from "@sagolik/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { BASIS_LABEL, LineAmount, Metric, money, shortDate } from "@/components/app/autopilot";
import { loadPassport } from "@/lib/server/autopilot";

export const metadata: Metadata = { title: "Cash flow — Property Autopilot" };

const HORIZONS = [30, 60, 90] as const;

export default async function CashFlowPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ days?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const days = (HORIZONS as readonly number[]).includes(Number(sp.days)) ? (Number(sp.days) as 30 | 60 | 90) : 30;
  const { view } = await loadPassport(id);
  const f = view.forecasts[days];
  const cur = view.property?.currency ?? "USD";
  const funding = view.assessment.funding;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Horizon" className="flex gap-1">
          {HORIZONS.map((h) => (
            <Link key={h} href={`/app/autopilot/${id}/cash-flow?days=${h}`} aria-current={h === days ? "page" : undefined} className={cn("rounded-full px-3 py-1 text-[13px]", h === days ? "bg-navy-800 text-white" : "text-ink-2 hover:bg-navy-50")}>
              {h} days
            </Link>
          ))}
        </nav>
        <p className="text-[12.5px] text-ink-3">Bills received are actual. Everything else is a prediction from the cost's schedule and usual amount.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label={`Expected, next ${days} days`} value={money(f.total, cur)} />
        <Metric label="From bills received" value={money(f.billed, cur)} />
        <Metric label="Predicted" value={money(f.predicted, cur)} />
        <Metric label="Amounts not known" value={f.unknown} sub={f.unknown ? "Add usual amounts on the Costs tab" : "None"} tone={f.unknown ? "attention" : undefined} />
      </div>

      <Card>
        <CardHeader title="Payments expected" />
        {f.lines.length ? (
          <table className="w-full text-left text-[13.5px]">
            <thead className="border-b border-line text-[12px] uppercase tracking-wide text-ink-3">
              <tr>
                <th className="px-5 py-2 font-medium">Due</th>
                <th className="px-3 py-2 font-medium">Cost</th>
                <th className="px-3 py-2 font-medium">Basis</th>
                <th className="px-5 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {f.lines.map((l) => (
                <tr key={`${l.obligationId}-${l.dueOn}-${l.billId ?? "p"}`} className="border-b border-line last:border-b-0">
                  <td className={cn("px-5 py-2.5", l.overdue ? "font-medium text-danger" : "text-ink-3")}>{shortDate(l.dueOn)}</td>
                  <td className="px-3 py-2.5 text-ink">{l.label}</td>
                  <td className="px-3 py-2.5 text-[12.5px] text-ink-3">{l.overdue ? "Overdue" : BASIS_LABEL[l.basis]}</td>
                  <td className="px-5 py-2.5 text-right">
                    <LineAmount line={l} currency={cur} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-5 py-6 text-sm text-ink-3">Nothing expected in this period.</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Funding check (next 30 days)" description="Uses the high end of usual amounts, so warnings come early. Sagolik only recommends transfers; you make them." />
        <CardBody className="space-y-3 text-[13.5px]">
          {funding.length ? (
            funding.map((c) => (
              <div key={c.accountId ?? "none"}>
                <p className="font-medium text-ink">{c.accountLabel ?? "No paying account chosen"}</p>
                {c.reasons.map((r) => (
                  <p key={r} className="text-ink-2">
                    {r}
                  </p>
                ))}
              </div>
            ))
          ) : (
            <p className="text-ink-3">Nothing to fund in the next 30 days.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
