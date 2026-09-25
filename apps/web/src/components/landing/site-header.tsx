import { buttonClasses } from "@sagolik/ui";
import { ArrowRight, Menu } from "lucide-react";
import Link from "next/link";
import { Logo } from "../brand";

// `wide` items only show in the top bar from 2xl up (they stay in the menu below that).
const NAV: Array<{ href: string; label: string; badge?: string; wide?: boolean }> = [
  { href: "/#platform", label: "Platform" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/#buyers", label: "Buyers" },
  { href: "/#sellers", label: "Sellers", wide: true },
  { href: "/#professionals", label: "Professionals" },
  { href: "/business", label: "Business", badge: "Beta" },
  { href: "/#security", label: "Security" },
  { href: "/#pricing", label: "Pricing", wide: true },
  { href: "/#resources", label: "Resources", wide: true },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/90 backdrop-blur supports-[backdrop-filter]:bg-canvas/75">
      <div className="container-page flex h-[72px] items-center justify-between gap-6">
        <Logo className="h-8 w-auto sm:h-9" />
        <nav aria-label="Main" className="hidden items-center gap-4 xl:flex 2xl:gap-5">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`${n.wide ? "hidden 2xl:inline " : ""}whitespace-nowrap text-[13.5px] text-ink-2 transition-colors hover:text-navy-800`}>
              {n.label}
              {n.badge ? <span className="ml-1 rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">{n.badge}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Link href="/sign-in" className={buttonClasses("ghost", "sm")}>
            Sign In
          </Link>
          <Link href="/sign-in?intent=start" className={buttonClasses("secondary", "sm")}>
            Start Closing
          </Link>
          <Link href="/contact" className={buttonClasses("primary", "sm")}>
            Book Demo <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        <details className="relative lg:hidden">
          <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full text-navy-800 hover:bg-navy-50 [&::-webkit-details-marker]:hidden">
            <Menu className="h-5 w-5" aria-hidden />
            <span className="sr-only">Open menu</span>
          </summary>
          <div className="absolute right-0 mt-2 w-64 rounded-xl border border-line bg-paper p-2 shadow-[var(--shadow-float)]">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="block rounded-md px-3 py-2 text-sm text-ink-2 hover:bg-canvas">
                {n.label}
              </Link>
            ))}
            <div className="mt-2 grid gap-2 border-t border-line p-2 pt-3">
              <Link href="/sign-in" className={buttonClasses("secondary", "sm", "w-full")}>
                Sign In
              </Link>
              <Link href="/contact" className={buttonClasses("primary", "sm", "w-full")}>
                Book Demo
              </Link>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
