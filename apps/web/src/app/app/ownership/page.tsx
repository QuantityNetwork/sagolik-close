import { myOwnershipRecords } from "@sagolik/core";
import { formatDate } from "@sagolik/i18n";
import { Card, EmptyState, formatMoney } from "@sagolik/ui";
import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/server/context";

export const metadata: Metadata = { title: "Home Record" };

export default async function OwnershipIndex() {
  const { ctx } = await requireContext("/app/ownership");
  const records = await myOwnershipRecords(ctx);
  if (records.length === 1) redirect(`/app/ownership/${records[0]!.id}`);
  const props = await Promise.all(records.map((r) => ctx.db.properties.get(r.propertyId)));
  return (
    <div className="container-page animate-rise py-8">
      <h1 className="text-[34px] text-navy-800">Your Home Record</h1>
      <p className="text-sm text-ink-3">A permanent record for every home you own through Sagolik Close.</p>
      {records.length === 0 ? (
        <Card className="mt-6">
          <EmptyState title="No homes yet" icon={<KeyRound className="h-8 w-8" aria-hidden />}>
            When ownership of a home is recorded, its Home Record starts here — signed documents, mortgage, insurance, warranties and more.
          </EmptyState>
        </Card>
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {records.map((r, i) => (
            <li key={r.id}>
              <Link href={`/app/ownership/${r.id}`} className="flex gap-4 rounded-[var(--radius-card)] border border-line bg-paper p-4 hover:border-navy-800/25">
                {props[i]?.imageUrls[0] ? <Image src={props[i]!.imageUrls[0]!} alt="" width={96} height={96} className="h-24 w-24 rounded-lg object-cover" /> : null}
                <div>
                  <p className="font-display text-xl text-navy-800">{props[i]?.addressLine1}</p>
                  <p className="text-sm text-ink-3">
                    Owned since {formatDate(r.purchaseDate, "en", { month: "long", day: "numeric", year: "numeric" })} · {formatMoney(r.purchaseAmount, r.currency)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
