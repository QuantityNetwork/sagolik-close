import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { requireActor } from "@/lib/server/session";

export const metadata: Metadata = { title: "More" };

export default async function MorePage() {
  const actor = await requireActor("/app/more");
  const links = [
    ["Transactions", "/app/transactions"],
    ...(actor.memberships.length ? [["Command center", "/app/command-center"]] : []),
    ["Home Record", "/app/ownership"],
    ["Notifications", "/app/notifications"],
    ["Profile", "/app/settings"],
    ["Security", "/app/settings/security"],
    ["Notification settings", "/app/settings/notifications"],
    ["Connected banks", "/app/settings/banks"],
    ["Privacy center", "/app/settings/privacy"],
    ...(actor.isPlatformAdmin ? [["Admin", "/admin"]] : []),
  ];
  return (
    <div className="container-page max-w-xl py-6">
      <h1 className="text-[30px] text-navy-800">More</h1>
      <ul className="mt-4 divide-y divide-line rounded-[var(--radius-card)] border border-line bg-paper">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href!} className="flex items-center justify-between px-4 py-3.5 text-[15px] text-ink">
              {label}
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
