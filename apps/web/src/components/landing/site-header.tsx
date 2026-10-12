import { buttonClasses } from "@sagolik/ui";
import { ArrowRight, Menu } from "lucide-react";
import Link from "next/link";
import { Logo } from "../brand";

// `wide` items only show in the top bar from 2xl up (they stay in the menu below that).
const NAV: Array<{ href: string; label: string; badge?: string; wide?: boolean }> = [
  { href: "/#platform", label: "Platform" },
  { href: "/#how-it-works", label: "How it works" },
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
    <>
      <div className="hidden bg-navy-950 text-[12px] text-white/60 md:block">
        <div className="container-page flex h-9 items-center justify-between">
          <p className="tracking-[0.02em]">
            <span className="text-brass-300">Pilot program</span> · United States first; other markets modelled, pending local legal review
          </p>
          <div className="flex items-center gap-5">
            <Link href="/legal/compliance" className="link-u hover:text-white">
              Compliance boundaries
            </Link>
            <Link href="/contact" className="link-u hover:text-white">
              Contact
            </Link>
          </div>
        </div>
      </div>
      <header className="site-header sticky top-0 z-40 border-b border-line/80 bg-canvas/95 backdrop-blur-md">
        <div className="container-page flex h-[76px] items-center justify-between gap-6">
          <Logo className="h-8 w-auto sm:h-9" />
          <nav aria-label="Main" className="hidden items-center gap-6 xl:flex 2xl:gap-7">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={`${n.wide ? "hidden 2xl:inline-flex " : "inline-flex "}link-u items-center whitespace-nowrap text-[13.5px] text-ink-2 transition-colors hover:text-navy-900`}>
                {n.label}
                {n.badge ? <span className="ml-1.5 rounded-sm border border-brass-500/50 px-1 py-px text-[9.5px] font-semibold uppercase tracking-[0.14em] text-brass-700">{n.badge}</span> : null}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            <Link href="/sign-in" className="link-u mr-3 text-[13.5px] font-medium text-navy-800">
              Sign in
            </Link>
            <Link href="/sign-in?intent=start" className={buttonClasses("secondary", "sm")}>
              Start a closing
            </Link>
            <Link href="/contact" className={buttonClasses("primary", "sm")}>
              Book a demo <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
          <details className="group relative lg:hidden">
            <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-control text-navy-800 ring-1 ring-line-strong hover:bg-paper [&::-webkit-details-marker]:hidden">
              <Menu className="h-5 w-5" aria-hidden />
              <span className="sr-only">Open menu</span>
            </summary>
            <div className="absolute right-0 mt-3 w-72 rounded-card border border-line bg-paper p-2 shadow-[var(--shadow-float)]">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="flex items-center justify-between rounded-sm px-3 py-2.5 text-[14px] text-ink-2 hover:bg-canvas">
                  {n.label}
                  {n.badge ? <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-brass-700">{n.badge}</span> : null}
                </Link>
              ))}
              <div className="mt-2 grid gap-2 border-t border-line p-2 pt-3">
                <Link href="/sign-in" className={buttonClasses("secondary", "sm", "w-full")}>
                  Sign in
                </Link>
                <Link href="/contact" className={buttonClasses("primary", "sm", "w-full")}>
                  Book a demo
                </Link>
              </div>
            </div>
          </details>
        </div>
        <span aria-hidden className="read-progress absolute inset-x-0 -bottom-px h-[2px] bg-brass-500" />
      </header>
    </>
  );
}
