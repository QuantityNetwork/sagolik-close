import { Card, CardHeader } from "@sagolik/ui";
import type { Metadata } from "next";
import { money, SeverityTag, shortDate } from "@/components/app/autopilot";
import { loadPassport } from "@/lib/server/autopilot";

export const metadata: Metadata = { title: "Activity — Property Autopilot" };

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadPassport(id);
  return (
    <Card>
      <CardHeader title="Activity" description="Every conclusion Sagolik reached for this property, with its reasons and the rule it applied. This log is append-only." />
      {view.decisions.length ? (
        <ul>
          {view.decisions.map((d) => (
            <li key={d.id} className="border-b border-line px-5 py-4 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] text-ink-3">{shortDate(d.createdAt.slice(0, 10))}</span>
                {d.severity !== "info" ? <SeverityTag severity={d.severity} /> : null}
                <span className="font-medium text-ink">{d.summary}</span>
                {d.amount !== null && d.currency ? <span className="num text-[12.5px] text-ink-3">{money(d.amount, d.currency)}</span> : null}
              </div>
              <ul className="mt-1 space-y-0.5 text-[13px] text-ink-2">
                {d.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {d.rule ? <p className="mt-1 text-[12px] text-ink-3">Rule: {d.rule}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-6 text-sm text-ink-3">Nothing yet.</p>
      )}
    </Card>
  );
}
