import type { AttentionItem, ContinuityStatus, ForecastLine } from "@sagolik/workflow";
import { cn, formatMoney, StatusBadge } from "@sagolik/ui";
import type { DecisionSeverity } from "@sagolik/types";
import type { ReactNode } from "react";
import Link from "next/link";

export const CONTINUITY: Record<ContinuityStatus, { label: string; tone: "done" | "attention" | "blocked" | "stopped" }> = {
  protected: { label: "Protected", tone: "done" },
  attention: { label: "Needs attention", tone: "attention" },
  at_risk: { label: "At risk", tone: "blocked" },
  not_monitored: { label: "Not monitored", tone: "stopped" },
};

export function ContinuityBadge({ status }: { status: ContinuityStatus }) {
  const c = CONTINUITY[status];
  return <StatusBadge tone={c.tone}>{c.label}</StatusBadge>;
}

const SEVERITY: Record<DecisionSeverity, { label: string; className: string }> = {
  critical: { label: "Critical", className: "bg-danger-50 text-[#7a1810]" },
  urgent: { label: "Urgent", className: "bg-attention-50 text-[#6b4000]" },
  action_required: { label: "Action required", className: "bg-navy-50 text-navy-800" },
  info: { label: "Info", className: "bg-canvas text-ink-3" },
};

export function SeverityTag({ severity }: { severity: DecisionSeverity }) {
  const s = SEVERITY[severity];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", s.className)}>{s.label}</span>;
}

/** A plain, factual metric: label, value, one line of context. */
export function Metric({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "attention" | "done" }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-paper px-5 py-4">
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className={cn("num mt-1 text-[28px] leading-tight", tone === "attention" ? "text-[#8a5300]" : tone === "done" ? "text-success" : "text-navy-800")}>{value}</p>
      {sub ? <p className="mt-1 text-[12.5px] text-ink-3">{sub}</p> : null}
    </div>
  );
}

export const money = (minor: number | null, currency = "USD") => (minor === null ? "—" : formatMoney(minor, currency, "en-US", { cents: minor % 100 !== 0 }));

/** Amount for a forecast line: the real bill, a fixed amount, or an estimate shown as a range. */
export function LineAmount({ line, currency = "USD" }: { line: ForecastLine; currency?: string }) {
  if (line.basis === "escrow") return <span className="text-ink-3">Paid from escrow</span>;
  if (line.basis === "unknown" || line.amount === null) return <span className="text-ink-3">Amount not known yet</span>;
  if (line.basis === "estimate") return <span className="num text-ink-2">Expected {line.range ? `${money(line.range[0], currency)}–${money(line.range[1], currency)}` : `~${money(line.amount, currency)}`}</span>;
  return <span className="num text-ink">{money(line.amount, currency)}</span>;
}

export const BASIS_LABEL: Record<ForecastLine["basis"], string> = {
  bill: "Bill received",
  fixed: "Scheduled",
  estimate: "Awaiting bill",
  unknown: "Details needed",
  escrow: "Covered through escrow",
};

export function AttentionList({ items, showProperty = true, empty }: { items: AttentionItem[]; showProperty?: boolean; empty?: ReactNode }) {
  if (!items.length) return <p className="px-5 py-6 text-sm text-ink-3">{empty ?? "Nothing needs your attention."}</p>;
  return (
    <ul>
      {items.map((a) => (
        <li key={a.id} className="border-b border-line px-5 py-4 last:border-b-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityTag severity={a.severity} />
            {showProperty ? (
              <Link href={`/app/autopilot/${a.passportId}`} className="text-[13px] font-medium text-navy-800 hover:underline">
                {a.passportLabel}
              </Link>
            ) : null}
            {a.deadline ? <span className="text-[12px] text-ink-3">· by {new Date(`${a.deadline}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span> : null}
          </div>
          <p className="mt-1.5 font-medium text-ink">{a.title}</p>
          <p className="mt-1 text-[13px] text-ink-2">
            <span className="font-medium text-ink-3">Why this matters: </span>
            {a.why}
          </p>
          <p className="mt-1 text-[13px] text-ink-2">
            <span className="font-medium text-ink-3">Recommended: </span>
            {a.action}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Always visible on Autopilot pages: what Sagolik does and doesn't do. */
export function MonitoringNote() {
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-[12px] text-ink-3">
      <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden />
      Monitoring only · Sagolik never pays bills or moves money
    </p>
  );
}

export function shortDate(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
