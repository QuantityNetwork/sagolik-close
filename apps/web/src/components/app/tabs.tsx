"use client";
import { cn, ProductIcon, type ProductIconName } from "@sagolik/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function TabNav({ tabs, label }: { tabs: Array<{ href: string; label: string; count?: number; exact?: boolean; icon?: ProductIconName }>; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="-mb-px overflow-x-auto">
      <ul className="flex gap-1 whitespace-nowrap">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex items-center gap-1.5 px-3 py-3.5 text-[13.5px] transition-colors duration-200",
                  "after:absolute after:inset-x-3 after:-bottom-px after:h-[2px] after:origin-left after:bg-navy-800 after:transition-transform after:duration-300 after:ease-out",
                  active ? "font-medium text-navy-900 after:scale-x-100" : "text-ink-3 after:scale-x-0 hover:text-ink hover:after:scale-x-100 hover:after:bg-line-strong",
                )}
              >
                {t.icon ? <ProductIcon name={t.icon} tone={active ? "brand" : "mono"} size={15} /> : null}
                {t.label}
                {t.count ? <span className="rounded-sm bg-attention-50 px-1.5 text-[11px] font-semibold text-attention num">{t.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
