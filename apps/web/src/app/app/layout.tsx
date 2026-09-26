import { getRuntime, isOwnerOrganizationType } from "@sagolik/core";
import { translator } from "@sagolik/i18n";
import { ParticipantAvatar } from "@sagolik/ui";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { Logo } from "@/components/brand";
import { BottomNav, type NavItem, SidebarNav } from "@/components/app/nav";
import { requireActor } from "@/lib/server/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor("/app");
  const rt = await getRuntime();
  const db = rt.serviceDb;
  const [profile, participations, unread, records, allMemberships] = await Promise.all([
    db.profiles.get(actor.userId),
    db.transaction_participants.find({ userId: actor.userId, status: ["invited", "active"] }, { orderBy: "createdAt" }),
    db.notifications.count({ userId: actor.userId, readAt: null }),
    db.ownership_records.find({}),
    db.organization_members.find({ userId: actor.userId }),
  ]);
  const t = translator(profile?.locale ?? "en");
  const professional = actor.memberships.length > 0 || participations.some((p) => !["buyer", "co_buyer", "seller", "co_seller"].includes(p.role));
  const primaryTx = participations[0]?.transactionId;
  const hasRecord = records.some((r) => r.ownerUserIds.includes(actor.userId));
  // Owners: anyone with a Home Record or a membership in an owner portfolio.
  const ownerOrgs = allMemberships.length ? (await db.organizations.find({ id: allMemberships.map((m) => m.organizationId) })).filter((o) => isOwnerOrganizationType(o.type)) : [];
  const hasAutopilot = hasRecord || ownerOrgs.length > 0;

  const nav: NavItem[] = [
    { href: "/app", label: t("nav.home"), icon: "home", exact: true },
    ...(professional ? [{ href: "/app/command-center", label: t("nav.commandCenter"), icon: "command" as const }] : []),
    { href: "/app/transactions", label: t("nav.transactions"), icon: "transactions" },
    ...(hasAutopilot ? [{ href: "/app/autopilot", label: t("nav.autopilot"), icon: "autopilot" as const }] : []),
    ...(hasRecord ? [{ href: "/app/ownership", label: t("nav.homeRecord"), icon: "record" as const }] : []),
    { href: "/app/notifications", label: t("nav.notifications"), icon: "notifications", badge: unread },
    { href: "/app/settings", label: t("nav.settings"), icon: "settings" },
    ...(actor.isPlatformAdmin ? [{ href: "/admin", label: t("nav.admin"), icon: "admin" as const }] : []),
  ];

  const base = primaryTx ? `/app/transactions/${primaryTx}` : "/app/transactions";
  const bottom: NavItem[] = [
    { href: "/app", label: t("nav.home"), icon: "home", exact: true },
    { href: primaryTx ? `${base}/tasks` : "/app/transactions", label: t("nav.tasks"), icon: "tasks" },
    { href: primaryTx ? `${base}/documents` : "/app/transactions", label: t("nav.documents"), icon: "documents" },
    { href: primaryTx ? `${base}/messages` : "/app/notifications", label: t("nav.messages"), icon: "messages", badge: unread },
    { href: "/app/more", label: t("nav.more"), icon: "more" },
  ];

  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[248px_1fr]">
      <div className="hidden bg-navy-800 lg:block">
      <aside className="sticky top-0 flex h-screen flex-col px-4 py-5">
        <div className="px-2 pb-6">
          <Logo variant="light" className="h-8 w-auto" href="/app" />
        </div>
        <nav aria-label="Main" className="flex-1">
          <SidebarNav items={nav} />
        </nav>
        <div className="border-t border-white/10 pt-4">
          <div className="flex items-center gap-3 px-2">
            <ParticipantAvatar name={actor.displayName} size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{actor.displayName}</p>
              <p className="truncate text-[12px] text-white/60">{actor.email}</p>
            </div>
            <form action={signOut}>
              <button type="submit" className="rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label={t("nav.signOut")} title={t("nav.signOut")}>
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </form>
          </div>
        </div>
      </aside>
      </div>

      <div className="min-w-0">
        {rt.env.demoMode ? (
          <div role="note" className="border-b border-attention/20 bg-attention-50 px-4 py-2 text-center text-[12.5px] text-[#6b4000]">
            {t("demo.banner")}
          </div>
        ) : null}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-paper/95 px-4 backdrop-blur lg:hidden">
          <Logo className="h-6 w-auto" href="/app" />
          <Link href="/app/notifications" className="text-sm text-navy-800">
            {t("nav.notifications")}
            {unread ? <span className="ml-1 rounded-full bg-teal-600 px-1.5 text-[11px] text-white">{unread}</span> : null}
          </Link>
        </header>
        <main id="main" className="pb-24 lg:pb-10">
          {children}
        </main>
      </div>
      <BottomNav items={bottom} />
    </div>
  );
}
