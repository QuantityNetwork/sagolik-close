import { commandCenter, getRuntime } from "@sagolik/core";
import { buttonClasses, Card, CardHeader } from "@sagolik/ui";
import { AlertOctagon, CalendarClock, FileSignature, Fingerprint, Hourglass, Landmark, Layers, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PortfolioTable } from "@/components/app/portfolio-table";
import { requireContext } from "@/lib/server/context";

export const metadata: Metadata = { title: "Command center" };

export default async function CommandCenterPage() {
  const { ctx, actor } = await requireContext("/app/command-center");
  const rt = await getRuntime();
  const profile = await rt.serviceDb.profiles.get(actor.userId);
  const { kpis, rows } = await commandCenter(ctx);
  const tiles = [
    { label: "Open transactions", value: kpis.openTransactions, icon: Layers, href: "/app/transactions" },
    { label: "Closing this week", value: kpis.closingThisWeek, icon: CalendarClock, href: "/app/transactions?filter=closing_this_week" },
    { label: "Blocked", value: kpis.blocked, icon: AlertOctagon, href: "/app/transactions?filter=blocked", alert: kpis.blocked > 0 },
    { label: "Pending signatures", value: kpis.pendingSignatures, icon: FileSignature },
    { label: "Payments in flight", value: kpis.pendingPayments, icon: Landmark },
    { label: "Title issues", value: kpis.titleIssues, icon: ScrollText, href: "/app/transactions?filter=awaiting_title", alert: kpis.titleIssues > 0 },
    { label: "Identity reviews", value: kpis.identityReviews, icon: Fingerprint, alert: kpis.identityReviews > 0 },
    { label: "Past closing date", value: kpis.delayed, icon: Hourglass, alert: kpis.delayed > 0 },
  ];

  return (
    <div className="container-page animate-rise py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Command center</p>
          <h1 className="mt-1 text-[34px] text-navy-800">Good to see you, {actor.displayName.split(" ")[0]}.</h1>
          <p className="text-sm text-ink-3">Live numbers across the transactions you can see. Nothing here is estimated.</p>
        </div>
        {actor.memberships.length ? (
          <Link href="/app/transactions/new" className={buttonClasses("primary")}>
            New transaction
          </Link>
        ) : null}
      </div>
      <ul className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(({ label, value, icon: Icon, href, alert }) => {
          const inner = (
            <>
              <Icon className={`h-5 w-5 ${alert ? "text-danger" : "text-teal-600"}`} strokeWidth={1.6} aria-hidden />
              <p className={`mt-3 font-display text-[34px] leading-none num ${alert ? "text-danger" : "text-navy-800"}`}>{value}</p>
              <p className="mt-1 text-[13px] text-ink-3">{label}</p>
            </>
          );
          return (
            <li key={label}>
              {href ? (
                <Link href={href} className="block h-full rounded-[var(--radius-card)] border border-line bg-paper p-4 transition-colors hover:border-navy-800/25">
                  {inner}
                </Link>
              ) : (
                <div className="h-full rounded-[var(--radius-card)] border border-line bg-paper p-4">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
      <Card className="mt-8">
        <CardHeader title="Portfolio" description="Every file you're on, most urgent closings first." action={<Link href="/app/transactions" className="text-sm font-medium text-teal-700 hover:underline">Filters</Link>} />
        <PortfolioTable rows={rows} locale={profile?.locale ?? "en"} />
      </Card>
    </div>
  );
}
