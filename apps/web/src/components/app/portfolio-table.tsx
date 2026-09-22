import type { PortfolioRow } from "@sagolik/core";
import { formatDate } from "@sagolik/i18n";
import type { Locale } from "@sagolik/types";
import { EmptyState, ProgressBar, StatusBadge, Table, Td, Th } from "@sagolik/ui";
import { Building2 } from "lucide-react";
import Link from "next/link";

const TONE = { neutral: "neutral", progress: "progress", attention: "attention", done: "done", stopped: "stopped" } as const;

export function PortfolioTable({ rows, locale }: { rows: PortfolioRow[]; locale: Locale }) {
  if (!rows.length) return <EmptyState title="No transactions match" icon={<Building2 className="h-8 w-8" aria-hidden />} />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Property</Th>
          <Th>Buyer</Th>
          <Th>Seller</Th>
          <Th>Closing</Th>
          <Th>Stage</Th>
          <Th>Progress</Th>
          <Th>Attention required</Th>
          <Th>Coordinator</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-canvas/60">
            <Td>
              <Link href={`/app/transactions/${r.id}`} className="font-medium text-navy-800 hover:underline">
                {r.property}
              </Link>
              <p className="text-[12px] text-ink-3">{r.city}</p>
            </Td>
            <Td className="text-sm">{r.buyer}</Td>
            <Td className="text-sm">{r.seller}</Td>
            <Td className="whitespace-nowrap text-sm num">{r.closingDate ? formatDate(r.closingDate, locale, { month: "short", day: "numeric" }) : "—"}</Td>
            <Td>
              <StatusBadge tone={TONE[r.stateTone as keyof typeof TONE] ?? "neutral"}>{r.stage}</StatusBadge>
            </Td>
            <Td className="min-w-28">
              <div className="flex items-center gap-2">
                <ProgressBar value={r.progress} label={`${r.property} progress`} className="w-20" />
                <span className="text-[12px] text-ink-3 num">{r.progress}%</span>
              </div>
            </Td>
            <Td className="max-w-64 text-[12.5px]">
              {r.attention.length ? <span className={r.blocked ? "text-danger" : "text-attention"}>{r.attention.slice(0, 2).join(" · ")}</span> : <span className="text-success">On track</span>}
            </Td>
            <Td className="text-sm text-ink-3">{r.coordinator ?? "—"}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
