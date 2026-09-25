import { formatDate } from "@sagolik/i18n";
import { StatusBadge } from "@sagolik/ui";
import Image from "next/image";
import Link from "next/link";
import { TabNav } from "@/components/app/tabs";
import { loadTx } from "@/lib/server/tx";

const TYPE_LABEL = { purchase: "Purchase", sale: "Sale", refinance: "Refinance", ownership_transfer: "Ownership transfer", business_acquisition: "Business acquisition" } as const;
const TONE = { neutral: "neutral", progress: "progress", attention: "attention", done: "done", stopped: "stopped" } as const;

export default async function TransactionLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { snapshot: s, view, can, locale } = await loadTx(id);
  const base = `/app/transactions/${id}`;
  const openTasks = view.myTasks.length;
  const complianceOpen = s.complianceCases.filter((c) => c.status === "review_required" || c.status === "escalated").length;

  const tabs = [
    { href: base, label: "Overview", exact: true, icon: "overview" as const },
    { href: `${base}/tasks`, label: "Tasks", count: openTasks, icon: "tasks" as const },
    { href: `${base}/documents`, label: "Documents", count: view.documents.needsAttention, icon: "documents" as const },
    ...(can("financial.view") ? [{ href: `${base}/money`, label: "Money", icon: "payments" as const }] : []),
    ...(s.mortgage || can("mortgage.update") ? [{ href: `${base}/mortgage`, label: "Financing", icon: "financing" as const }] : []),
    ...(s.titleCase || can("title.update") ? [{ href: `${base}/title`, label: "Title", icon: "title" as const }] : []),
    { href: `${base}/people`, label: "People", icon: "people" as const },
    { href: `${base}/messages`, label: "Messages", icon: "messages" as const },
    { href: `${base}/calendar`, label: "Calendar", icon: "timeline" as const },
    ...(can("compliance.review") ? [{ href: `${base}/compliance`, label: "Compliance", count: complianceOpen, icon: "identity" as const }] : []),
    { href: `${base}/closing`, label: "Closing", icon: "ownership" as const },
    ...(can("audit.view") ? [{ href: `${base}/audit`, label: "Audit", icon: "integrations" as const }] : []),
  ];

  return (
    <div>
      <div className="border-b border-line bg-paper">
        <div className="container-page pt-6">
          <nav aria-label="Breadcrumb" className="text-[12px] text-ink-3">
            <Link href="/app/transactions" className="hover:text-navy-800">
              Transactions
            </Link>{" "}
            / <span className="num">{s.transaction.reference}</span>
          </nav>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              {s.property.imageUrls[0] ? (
                <Image src={s.property.imageUrls[0]} alt="" width={72} height={72} className="hidden h-[72px] w-[72px] rounded-lg object-cover sm:block" />
              ) : null}
              <div>
                <h1 className="text-[28px] leading-tight text-navy-800">{s.property.addressLine1}</h1>
                <p className="mt-0.5 text-sm text-ink-3">
                  {[s.property.city, s.property.region, s.property.postalCode].filter(Boolean).join(", ")} · {TYPE_LABEL[s.transaction.type]} ·{" "}
                  {s.transaction.expectedClosingDate ? `Closing ${formatDate(s.transaction.expectedClosingDate, locale, { month: "long", day: "numeric", year: "numeric" })}` : "Closing date to be confirmed"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <StatusBadge tone={TONE[view.stateLabel.tone]}>{view.stateLabel.label}</StatusBadge>
              <span className="text-ink-3">
                <span className="font-semibold text-navy-800 num">{view.progress}%</span> complete
              </span>
              {view.coordinator ? <span className="hidden text-ink-3 md:inline">Coordinator: {view.coordinator.displayName}</span> : null}
            </div>
          </div>
          <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-navy-100" aria-hidden>
            <div className="h-full bg-teal-600" style={{ width: `${view.progress}%` }} />
          </div>
          <div className="mt-2">
            <TabNav tabs={tabs} label="Transaction sections" />
          </div>
        </div>
      </div>
      <div className="container-page animate-rise py-6">{children}</div>
    </div>
  );
}
