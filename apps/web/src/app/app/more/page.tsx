import { ProductIcon, type ProductIconName } from "@sagolik/ui";
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { requireActor } from "@/lib/server/session";

export const metadata: Metadata = { title: "More" };

export default async function MorePage() {
  const actor = await requireActor("/app/more");
  const links: Array<[string, string, ProductIconName]> = [
    ["Transactions", "/app/transactions", "transactions"],
    ...(actor.memberships.length ? [["Command center", "/app/command-center", "dashboard"] as [string, string, ProductIconName]] : []),
    ["Property Autopilot", "/app/autopilot", "property"],
    ["Home Record", "/app/ownership", "ownership"],
    ["Notifications", "/app/notifications", "notifications"],
    ["Profile", "/app/settings", "people"],
    ["Security", "/app/settings/security", "identity"],
    ["Notification settings", "/app/settings/notifications", "settings"],
    ["Connected banks", "/app/settings/banks", "banking"],
    ["Privacy center", "/app/settings/privacy", "escrow"],
    ...(actor.isPlatformAdmin ? [["Admin", "/admin", "integrations"] as [string, string, ProductIconName]] : []),
  ];
  return (
    <div className="container-page max-w-xl py-6">
      <h1 className="text-[30px] text-navy-800">More</h1>
      <ul className="mt-4 divide-y divide-line rounded-[var(--radius-card)] border border-line bg-paper">
        {links.map(([label, href, icon]) => (
          <li key={href}>
            <Link href={href} className="flex items-center gap-3 px-4 py-3.5 text-[15px] text-ink">
              <ProductIcon name={icon} size={22} />
              <span className="flex-1">{label}</span>
              <ChevronRight className="h-4 w-4 text-ink-4" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <form action={signOut} className="mt-6">
        <button type="submit" className="w-full rounded-[var(--radius-card)] border border-line bg-paper px-4 py-3.5 text-left text-[15px] text-danger">
          Sign out
        </button>
      </form>
    </div>
  );
}
