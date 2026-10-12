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
                "relative flex items-center gap-3 rounded-sm px-3 py-2.5 text-[13.5px] transition-colors duration-200",
                "before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:origin-center before:bg-brass-300 before:transition-transform before:duration-300",
                active ? "bg-white/[0.07] text-white before:scale-y-100" : "text-white/65 before:scale-y-0 hover:bg-white/[0.04] hover:text-white",
              )}
            >
              <ProductIcon name={ICONS[item.icon]} tone="light" size={17} className={active ? "" : "opacity-60"} />
              <span className="flex-1">{item.label}</span>
              {item.badge ? <span className="rounded-sm bg-teal-600 px-1.5 text-[11px] font-semibold text-white num">{item.badge}</span> : null}
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
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={`${item.href}:${item.label}`}>
              <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[11px] before:absolute before:inset-x-5 before:top-0 before:h-[2px] before:bg-navy-800 before:transition-transform before:duration-300", active ? "font-medium text-navy-900 before:scale-x-100" : "text-ink-3 before:scale-x-0")}>
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
