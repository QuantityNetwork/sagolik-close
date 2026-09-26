import { Card, CardBody, CardHeader, cn } from "@sagolik/ui";
import type { ChecklistItem } from "@sagolik/workflow";
import type { Metadata } from "next";
import Link from "next/link";
import { AttentionList, BASIS_LABEL, LineAmount, shortDate } from "@/components/app/autopilot";
import { loadPassport } from "@/lib/server/autopilot";

export const metadata: Metadata = { title: "Property Autopilot" };

const MARK: Record<ChecklistItem["state"], { symbol: string; className: string; label: string }> = {
  ok: { symbol: "✓", className: "text-success", label: "Covered" },
  escrow: { symbol: "✓", className: "text-success", label: "Covered through escrow" },
  attention: { symbol: "!", className: "text-[#8a5300]", label: "Needs attention" },
  at_risk: { symbol: "!", className: "text-danger", label: "At risk" },
  missing: { symbol: "?", className: "text-ink-3", label: "Not set up" },
  to_confirm: { symbol: "?", className: "text-ink-3", label: "To confirm" },
};

const CRITICAL_KINDS = new Set(["mortgage", "property_tax", "insurance", "hoa", "electricity", "water", "gas"]);

function Checklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((c) => {
        const m = MARK[c.state];
        return (
          <li key={c.kind} className="flex items-start gap-3 py-2.5 text-[13.5px]">
            <span className={cn("w-4 shrink-0 text-center font-semibold", m.className)} aria-label={m.label}>
              {m.symbol}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-ink">{c.label}</span>
              <span className="block text-[12.5px] text-ink-3">{c.detail}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default async function PassportOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadPassport(id);
  const a = view.assessment;
  const critical = a.checklist.filter((c) => CRITICAL_KINDS.has(c.kind));
  const other = a.checklist.filter((c) => !CRITICAL_KINDS.has(c.kind));
  const cur = view.property?.currency ?? "USD";

  return (
    <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader title={a.status === "protected" ? "Why it's protected" : "Why it needs attention"} />
          <CardBody>
            <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-ink-2">
              {a.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Needs attention" />
          <AttentionList items={a.attention} showProperty={false} empty="Nothing needs your attention for this property." />
        </Card>

        <Card>
          <CardHeader title="Upcoming" description="Next 30 days. Expected amounts are predictions until the bill arrives." />
          {a.next30.lines.length ? (
            <ul>
              {a.next30.lines.map((l) => (
                <li key={`${l.obligationId}-${l.dueOn}-${l.billId ?? "p"}`} className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 text-[13.5px] last:border-b-0">
                  <span className={cn("w-14 shrink-0", l.overdue ? "font-medium text-danger" : "text-ink-3")}>{shortDate(l.dueOn)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-ink">{l.label}</span>
                    <span className="block text-[12px] text-ink-3">{l.overdue ? "Overdue" : BASIS_LABEL[l.basis]}</span>
                  </span>
                  <LineAmount line={l} currency={cur} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-ink-3">Nothing due in the next 30 days.</p>
          )}
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Critical" description="What keeps the property owned, insured and running." />
          <CardBody className="pt-0">
            <Checklist items={critical} />
          </CardBody>
        </Card>
        {other.length ? (
          <Card>
            <CardHeader title="Other" />
            <CardBody className="pt-0">
              <Checklist items={other} />
            </CardBody>
          </Card>
        ) : null}
        <Card>
          <CardHeader title="Property Passport" />
          <CardBody className="space-y-2 text-[13.5px]">
            {view.passport.ownershipRecordId ? (
              <p>
                <Link href={`/app/ownership/${view.passport.ownershipRecordId}`} className="text-navy-800 underline">
                  Home Record
                </Link>{" "}
                <span className="text-ink-3">— signed documents, recording and history from the closing.</span>
              </p>
            ) : (
              <p className="text-ink-3">Added by you, not bought through Sagolik, so there's no closing record.</p>
            )}
            <p>
              <Link href={`/app/autopilot/${id}/live`} className="text-navy-800 underline">
                Setup checklist
              </Link>{" "}
              <span className="text-ink-3">— what was found at setup and what still needs you.</span>
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
