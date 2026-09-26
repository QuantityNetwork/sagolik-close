"use client";
import { cn, ProductIcon, type ProductIconName } from "@sagolik/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS = {
  home: "overview",
  transactions: "transactions",
  command: "dashboard",
  record: "ownership",
  autopilot: "property",
  notifications: "notifications",
  settings: "settings",
  admin: "identity",
  tasks: "tasks",
  documents: "documents",
  messages: "messages",
  more: "more",
  dashboard: "dashboard",
} as const satisfies Record<string, ProductIconName>;
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
        const active = isActive(pathname, item);
        return (
          <li key={`${item.href}:${item.label}`}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors",
                active ? "bg-white/12 text-white" : "text-white/70 hover:bg-white/6 hover:text-white",
              )}
            >
              <ProductIcon name={ICONS[item.icon]} tone="light" size={18} className={active ? "" : "opacity-70"} />
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
          const active = isActive(pathname, item);
          return (
            <li key={`${item.href}:${item.label}`}>
              <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-navy-800" : "text-ink-3")}>
                <ProductIcon name={ICONS[item.icon]} tone={active ? "brand" : "mono"} size={22} />
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
