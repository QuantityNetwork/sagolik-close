import { buttonClasses, cn } from "@sagolik/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { loadPassport } from "@/lib/server/autopilot";

export const metadata: Metadata = { title: "Your property is live — Property Autopilot" };

const STATE = {
  done: { mark: "✓", className: "bg-success-50 text-success", label: "Done" },
  needs_you: { mark: "•", className: "bg-attention-50 text-[#8a5300]", label: "Needs you" },
  not_applicable: { mark: "–", className: "bg-canvas text-ink-3", label: "Not applicable" },
} as const;

/**
 * Close → Live. Each line is read back from what setup actually found, so a
 * check mark means something was found and a dot means Sagolik needs the
 * owner to confirm or add it. Nothing is shown as done that isn't.
 */
export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadPassport(id);
  const steps = view.liveSteps;
  const needs = steps.filter((s) => s.state === "needs_you").length;
  const acquired = view.passport.origin === "sagolik_closing";
  const step = 0.28;

  return (
    <div className="container-page py-10">
      <div className="mx-auto max-w-2xl">
        <p className="eyebrow text-teal-700 animate-rise">{acquired ? "Property acquired" : "Property added"}</p>
        <h1 className="mt-2 text-[36px] leading-tight text-navy-800 animate-rise">{view.passport.label}</h1>
        <p className="mt-1 text-ink-3 animate-rise">Preparing your property for ownership</p>

        <ol className="mt-8 space-y-2" aria-label="Setup steps">
          {steps.map((s, i) => {
            const st = STATE[s.state];
            return (
              <li key={s.key} className="animate-rise flex items-start gap-3 rounded-xl border border-line bg-paper px-4 py-3" style={{ animationDelay: `${0.4 + i * step}s` }}>
                <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold", st.className)} aria-label={st.label}>
                  {st.mark}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-ink">{s.label}</span>
                  <span className="block text-[13px] text-ink-3">{s.detail}</span>
                </span>
              </li>
            );
          })}
        </ol>

        <div className="animate-rise mt-8 rounded-[var(--radius-card)] border border-teal-100 bg-teal-50/50 p-6" style={{ animationDelay: `${0.6 + steps.length * step}s` }}>
          <p className="eyebrow text-teal-700">Your property is live</p>
          <p className="mt-1 text-[22px] leading-snug text-navy-800">Monitoring started.</p>
          <p className="mt-2 text-[14px] text-ink-2">
            Sagolik now watches this property's costs, balances and due dates, and tells you only when something needs attention. It never pays bills or moves money: your bank, autopay and mortgage servicer keep doing that.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={needs ? `/app/autopilot/${id}/costs` : `/app/autopilot/${id}`} className={buttonClasses("primary", "md")}>
              {needs ? `Review ${needs} ${needs === 1 ? "item" : "items"} that need you` : "Open the property"}
            </Link>
            <Link href="/app/autopilot" className={buttonClasses("ghost", "md")}>
              All properties
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
