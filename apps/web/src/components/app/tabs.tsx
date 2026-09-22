"use client";
import { cn } from "@sagolik/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function TabNav({ tabs, label }: { tabs: Array<{ href: string; label: string; count?: number; exact?: boolean }>; label: string }) {
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
                  "inline-flex items-center gap-1.5 border-b-2 px-3 py-3 text-[13.5px] transition-colors",
                  active ? "border-navy-800 font-medium text-navy-800" : "border-transparent text-ink-3 hover:text-ink",
                )}
              >
                {t.label}
                {t.count ? <span className="rounded-full bg-attention-50 px-1.5 text-[11px] font-semibold text-attention">{t.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
