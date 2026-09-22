import { getRuntime, portfolio, type PortfolioFilter } from "@sagolik/core";
import { buttonClasses, Card, cn } from "@sagolik/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { PortfolioTable } from "@/components/app/portfolio-table";
import { requireContext } from "@/lib/server/context";

export const metadata: Metadata = { title: "Transactions" };

const FILTERS: Array<{ key: PortfolioFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "closing_this_week", label: "Closing this week" },
  { key: "blocked", label: "Blocked" },
  { key: "awaiting_buyer", label: "Awaiting buyer" },
  { key: "awaiting_lender", label: "Awaiting lender" },
  { key: "awaiting_title", label: "Awaiting title" },
  { key: "awaiting_escrow", label: "Awaiting escrow" },
];

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const sp = await searchParams;
  const filter = (FILTERS.find((f) => f.key === sp.filter)?.key ?? "all") as PortfolioFilter;
  const { ctx, actor } = await requireContext("/app/transactions");
  const rt = await getRuntime();
  const profile = await rt.serviceDb.profiles.get(actor.userId);
  const { rows, total } = await portfolio(ctx, filter);

  return (
    <div className="container-page animate-rise py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] text-navy-800">Transactions</h1>
          <p className="text-sm text-ink-3">
            {rows.length} of {total} shown
          </p>
        </div>
        {actor.memberships.length ? (
          <Link href="/app/transactions/new" className={buttonClasses("primary")}>
            New transaction
          </Link>
        ) : null}
      </div>
      <nav aria-label="Filters" className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/app/transactions" : `/app/transactions?filter=${f.key}`}
            aria-current={filter === f.key ? "page" : undefined}
            className={cn("rounded-full px-3 py-1.5 text-[13px] ring-1 ring-inset", filter === f.key ? "bg-navy-800 text-white ring-navy-800" : "bg-paper text-ink-2 ring-line-strong hover:bg-sand")}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      <Card className="mt-4">
        <PortfolioTable rows={rows} locale={profile?.locale ?? "en"} />
      </Card>
    </div>
  );
}
