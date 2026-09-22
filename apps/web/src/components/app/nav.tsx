"use client";
import { cn } from "@sagolik/ui";
import { Bell, Building2, FileText, Gauge, Home, KeyRound, LayoutDashboard, ListChecks, MessageSquare, MoreHorizontal, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS = { home: Home, transactions: Building2, command: Gauge, record: KeyRound, notifications: Bell, settings: Settings, admin: ShieldCheck, tasks: ListChecks, documents: FileText, messages: MessageSquare, more: MoreHorizontal, dashboard: LayoutDashboard } as const;
export type NavIcon = keyof typeof ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  badge?: number;
  exact?: boolean;
}

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors",
                active ? "bg-white/12 text-white" : "text-white/70 hover:bg-white/6 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1">{item.label}</span>
              {item.badge ? <span className="rounded-full bg-teal-500 px-1.5 text-[11px] font-semibold text-white">{item.badge}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-navy-800" : "text-ink-3")}>
                <Icon className="h-5 w-5" aria-hidden />
                {item.label}
                {item.badge ? <span className="absolute top-1 right-[calc(50%-18px)] h-2 w-2 rounded-full bg-teal-600" aria-label={`${item.badge} unread`} /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
