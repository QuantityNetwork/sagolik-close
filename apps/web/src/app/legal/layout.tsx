import Link from "next/link";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/sections";

const DOCS = [
  ["Privacy", "/legal/privacy"],
  ["Terms", "/legal/terms"],
  ["Compliance boundaries", "/legal/compliance"],
] as const;

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="container-page grid gap-12 py-16 lg:grid-cols-[220px_1fr] lg:gap-20 lg:py-24">
        <aside className="lg:sticky lg:top-32 lg:self-start">
          <p className="kicker">Legal</p>
          <nav aria-label="Legal documents" className="mt-6 border-t border-line-strong">
            <ul>
              {DOCS.map(([label, href]) => (
                <li key={href} className="border-b border-line">
                  <Link href={href} className="block py-3 text-[14px] text-ink-2 transition-colors hover:text-navy-900">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <article className="legal animate-rise max-w-3xl">
          <p className="mb-10 border-l-2 border-attention bg-attention-50/60 px-4 py-3 text-[13px] leading-relaxed text-[#5f3a00]">
            Draft for review. This text describes how the software is built; it has not yet been reviewed by counsel and is not a binding agreement.
          </p>
          {children}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
