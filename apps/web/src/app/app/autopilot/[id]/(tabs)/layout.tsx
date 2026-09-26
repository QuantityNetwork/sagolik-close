import { OWNER_ORG_TYPE_LABELS } from "@sagolik/core";
import { IconTile } from "@sagolik/ui";
import Link from "next/link";
import { ContinuityBadge, Metric, MonitoringNote, money } from "@/components/app/autopilot";
import { TabNav } from "@/components/app/tabs";
import { loadPassport } from "@/lib/server/autopilot";

export default async function PassportLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadPassport(id);
  const { passport, property, assessment } = view;
  const base = `/app/autopilot/${id}`;
  const cur = property?.currency ?? "USD";
  const operating = view.fundingAccounts.find((a) => a.id === view.funding?.operatingAccountId);
  const reserve = view.fundingAccounts.find((a) => a.id === view.funding?.reserveAccountId);
  const openBills = view.bills.filter((b) => b.status === "received").length;
  const toConfirm = view.obligations.filter((o) => o.status === "suggested").length;

  const tabs = [
    { href: base, label: "Overview", exact: true, icon: "overview" as const, count: assessment.attention.length },
    { href: `${base}/bills`, label: "Bills", icon: "payments" as const, count: openBills },
    { href: `${base}/costs`, label: "Costs", icon: "financing" as const, count: toConfirm },
    { href: `${base}/cash-flow`, label: "Cash flow", icon: "timeline" as const },
    { href: `${base}/rules`, label: "Rules & funding", icon: "settings" as const },
    { href: `${base}/activity`, label: "Activity", icon: "integrations" as const },
  ];

  return (
    <div>
      <div className="border-b border-line bg-paper">
        <div className="container-page pt-6">
          <nav aria-label="Breadcrumb" className="text-[12px] text-ink-3">
            <Link href="/app/autopilot" className="hover:text-navy-800">
              Property Autopilot
            </Link>{" "}
            / {passport.label}
          </nav>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <IconTile name="property" size="md" className="hidden sm:inline-flex" />
              <div>
                <h1 className="text-[28px] leading-tight text-navy-800">{passport.label}</h1>
                <p className="mt-0.5 text-sm text-ink-3">
                  {property ? [property.addressLine1, property.city, property.region].filter(Boolean).join(", ") : ""} · {view.scope.name} ({OWNER_ORG_TYPE_LABELS[view.scope.type as keyof typeof OWNER_ORG_TYPE_LABELS]})
                  {passport.origin === "imported" ? " · Added by you" : ""}
                </p>
                <div className="mt-2">
                  <MonitoringNote />
                </div>
              </div>
            </div>
            <div className="text-right">
              <ContinuityBadge status={assessment.status} />
              <p className="mt-1 max-w-sm text-[13px] text-ink-2">{assessment.headline}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label="Next 30 days" value={money(assessment.next30.total, cur)} sub={assessment.next30.unknown ? `${assessment.next30.unknown} amount${assessment.next30.unknown === 1 ? "" : "s"} not known yet` : `${money(assessment.next30.billed, cur)} billed · ${money(assessment.next30.predicted, cur)} expected`} />
            <Metric label="Paying account" value={operating?.available != null ? money(operating.available, cur) : "—"} sub={operating ? `${operating.label} •••• ${operating.mask}` : "Not chosen yet"} />
            <Metric label="Reserve" value={reserve?.available != null ? money(reserve.available, cur) : "—"} sub={reserve ? `${reserve.label} •••• ${reserve.mask}` : "No reserve account set"} />
          </div>
          <div className="mt-4">
            <TabNav tabs={tabs} label="Property sections" />
          </div>
        </div>
      </div>
      <div className="container-page animate-rise py-6">{children}</div>
    </div>
  );
}
