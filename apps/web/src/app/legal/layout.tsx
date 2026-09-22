import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/sections";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="container-page py-14">
        <article className="legal mx-auto max-w-3xl">
          <p className="mb-6 rounded-lg border border-attention/30 bg-attention-50 px-4 py-3 text-[13px] text-[#6b4000]">
            Draft for review. This text describes how the software is built; it has not yet been reviewed by counsel and is not a binding agreement.
          </p>
          {children}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
