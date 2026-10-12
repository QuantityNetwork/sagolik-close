import { buttonClasses, ParticipantAvatar, ProgressStepper } from "@sagolik/ui";
import { ArrowRight, Check, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Exhibit, Guilloche } from "@/components/landing/exhibits";
import { SectionHeading, SiteFooter } from "@/components/landing/sections";
import { SiteHeader } from "@/components/landing/site-header";
import { delay, stagger } from "@/lib/motion";

export const metadata: Metadata = {
  title: "Business acquisitions (beta)",
  description: "The Sagolik Close workflow for buying a business: letter of intent, due diligence, financing, definitive agreement, funds flow and a confirmed ownership transfer — in one deal room.",
};

const JOURNEY: Array<[string, string]> = [
  ["LOI & deal room", "The signed letter of intent opens a deal room for buyer, seller, advisors, counsel, lender and escrow."],
  ["Due diligence", "Financials, quality of earnings, disclosure schedules and lien searches — each with an owner and a status."],
  ["Financing", "Lender conditions tracked next to the deal, so everyone sees what's left before funding."],
  ["Definitive agreement", "The asset or stock purchase agreement and closing documents, signed through an e-signature provider."],
  ["Funds flow", "Verified payment instructions, cooling-off on changes and escrow-reported receipts — never custody."],
  ["Closing & transfer", "Ownership is marked transferred only when deal counsel confirms it with a reference."],
];

const MODULES: Array<[string, string]> = [
  ["Deal room", "One place for the deal"],
  ["Diligence vault", "Versioned, access-controlled"],
  ["People & roles", "Each side sees its share"],
  ["Tasks", "Owners and due dates"],
  ["Timeline", "LOI to closing"],
  ["Financing", "Lender conditions"],
  ["Lien search", "UCC, tax, judgments"],
  ["Signatures", "Via your e-sign provider"],
  ["Identity", "Parties verified"],
  ["Funds flow", "Escrow-reported"],
  ["Messages", "Deal-room threads"],
  ["Transfer", "Confirmed by counsel"],
];

const ROLES: Array<[string, string]> = [
  ["Buyer", "Their tasks, the deal timeline, financing status and verified wire details when it's time to fund."],
  ["Seller", "What's still needed from them — schedules, consents, transfer documents — and when proceeds are released."],
  ["M&A advisor", "The whole file: who is blocking, what's due this week, and every party's progress."],
  ["Counsel", "Agreements, disclosure schedules, the lien search and the final confirmation of the transfer."],
  ["Accountant", "The diligence documents they review. No access to bank details or payment instructions."],
  ["Lender & escrow agent", "Their conditions and the funds flow — with second-person verification for any payment detail."],
];

const CONTROLS: Array<[string, string]> = [
  ["Step-up for every change", "Changing or revealing payment details needs a fresh second factor."],
  ["A second person verifies", "Instructions are verified by someone other than their author, with a call reference."],
  ["Cooling-off on changes", "Changed details wait before they can be used, and every party is alerted."],
  ["Receipts from escrow", "Funds show as received only when the escrow agent records it."],
];

const INCLUDED = [
  "A US workflow for asset, stock and membership-interest purchases",
  "Deal room with roles, tasks, owners and due dates",
  "Diligence documents with per-document access levels and version history",
  "Accountant role with document access but no money access",
  "Financing conditions and lien-search findings tracked to resolution",
  "Verified payment instructions, cooling-off on changes and escrow-reported receipts",
  "Ownership transfer confirmed by counsel with a reference — never by a click",
];

const NOT_YET = [
  "State-specific rules (bulk-sale notices, tax clearance) — tracked as tasks for now",
  "Working-capital adjustments, holdbacks and earn-outs after closing",
  "Cap-table, data-room and accounting-system integrations",
  "Regulatory filings such as HSR for larger deals",
];

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi"];

function DealMockup() {
  const steps = ["LOI", "Diligence", "Financing", "Agreement", "Funds", "Transfer"];
  return (
    <div role="img" aria-label="Illustration of a business acquisition deal room" className="overflow-hidden rounded-card border border-line bg-paper shadow-[var(--shadow-float)]">
      <div className="flex items-start justify-between gap-4 bg-navy-900 px-6 py-5 text-white">
        <div>
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-brass-300">Asset purchase · LLC</p>
          <p className="mt-1 font-display text-[22px] leading-tight">Blue Harbor Coffee</p>
          <p className="text-[12px] text-white/60">Specialty coffee roasting</p>
        </div>
        <span className="rounded-sm border border-brass-300/50 px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-brass-300">Due diligence</span>
      </div>
      <div className="px-6 py-5">
        <ProgressStepper steps={steps.map((s, i) => ({ key: s, label: s, state: i < 1 ? "complete" : i === 1 ? "current" : "upcoming" }))} />
      </div>
      <ul className="grid border-t border-line text-[13px] sm:grid-cols-2">
        {[
          ["Grace Liu", "Accountant", "Quality of earnings — in review"],
          ["David Chen", "Counsel", "Disclosure schedules — draft"],
          ["Michael Reed", "Lender", "Underwriting — 3 conditions open"],
          ["Rachel Kim", "M&A advisor", "Landlord consent — requested"],
        ].map(([name, role, status], i) => (
          <li key={name} className="follow flex items-center gap-3 border-b border-line px-6 py-3 sm:odd:border-r" style={stagger(i, 300)}>
            <ParticipantAvatar name={name!} size={28} />
            <span className="min-w-0">
              <span className="block font-medium text-ink">
                {name} <span className="font-normal text-ink-3">· {role}</span>
              </span>
              <span className="block truncate text-[12px] text-ink-3">{status}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function BusinessPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="relative overflow-hidden border-b border-line" aria-labelledby="business-title">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgb(15_42_71/0.045)_1px,transparent_1px)] bg-[size:calc(100%/12)_100%] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
          />
          <div className="container-page grid items-center gap-16 py-16 lg:grid-cols-[1fr_1.05fr] lg:py-24">
            <div>
              <p className="kicker enter" style={delay(0)}>
                Sagolik Close for business
                <span className="rounded-sm border border-brass-500/50 px-1.5 py-0.5 text-[10px] tracking-[0.16em]">Beta</span>
              </p>
              <h1 id="business-title" className="enter mt-7 text-[46px] leading-[1.02] tracking-[-0.028em] text-navy-900 sm:text-[64px]" style={delay(90)}>
                Buying a business, <em className="italic text-teal-700">closed with clarity.</em>
              </h1>
              <span aria-hidden className="enter-rule mt-8 block h-px w-28 bg-brass-500" style={delay(450)} />
              <p className="enter mt-8 max-w-xl text-[17.5px] leading-[1.65] text-ink-2" style={delay(250)}>
                The same closing infrastructure we build for property, shaped for acquisitions: one deal room from letter of intent to a confirmed ownership transfer — for buyers, sellers, advisors, counsel, lenders and escrow.
              </p>
              <div className="enter mt-10 flex flex-wrap items-center gap-x-7 gap-y-4" style={delay(380)}>
                <Link href="/sign-in" className={buttonClasses("primary", "lg")}>
                  Explore the demo deal <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link href="/contact?topic=access" className="link-u text-[15px] font-medium text-navy-800">
                  Join the beta
                </Link>
              </div>
              <p className="enter mt-5 text-[12.5px] text-ink-3" style={delay(460)}>
                In the demo, choose a person under “Business acquisition (beta)”.
              </p>
            </div>
            <figure className="exhibit enter" style={delay(250)}>
              <p className="exhibit-label">Exhibit 1</p>
              <p className="exhibit-title">The deal room, two weeks after the letter of intent</p>
              <div className="mt-5">
                <DealMockup />
              </div>
              <figcaption className="exhibit-note">Illustration with fictional demo data.</figcaption>
            </figure>
          </div>
        </section>

        <section className="py-24 lg:py-32" aria-labelledby="journey-title">
          <div className="container-page grid gap-14 lg:grid-cols-[0.85fr_1.25fr] lg:gap-20">
            <div className="lg:sticky lg:top-32 lg:self-start">
              <SectionHeading number="01" eyebrow="From LOI to close" title="Every stage of the deal, owned and visible." id="journey-title">
                Each step has an owner, a status and the documents behind it. Nobody has to ask where the deal stands.
              </SectionHeading>
            </div>
            <ol className="border-b border-line">
              {JOURNEY.map(([title, body], i) => (
                <li key={title} data-reveal className="grid grid-cols-[72px_1fr] gap-6 border-t border-line py-8 sm:grid-cols-[96px_1fr]">
                  <span className="font-display text-[44px] leading-none text-brass-600 num sm:text-[52px]">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className="text-[23px] leading-snug text-navy-900">{title}</h3>
                    <p className="mt-2.5 max-w-xl text-[15px] leading-[1.7] text-ink-2">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t border-line bg-paper py-24 lg:py-32" aria-labelledby="modules-title">
          <div className="container-page grid gap-14 lg:grid-cols-[0.85fr_1.25fr] lg:gap-20">
            <SectionHeading number="02" eyebrow="In the deal room" title="A complete acquisition closing. In one place." id="modules-title" />
            <ul data-reveal className="grid grid-cols-2 border-t border-line-strong sm:grid-cols-3">
              {MODULES.map(([title, caption], i) => (
                <li key={title} className="follow border-b border-line py-4 pr-4" style={stagger(i % 6)}>
                  <p className="text-[15px] font-semibold text-navy-900">{title}</p>
                  <p className="mt-0.5 text-[12.5px] text-ink-3">{caption}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="py-24 lg:py-32" aria-labelledby="roles-title">
          <div className="container-page">
            <SectionHeading number="03" eyebrow="Every side of the table" title="Each party sees exactly what they should." id="roles-title">
              Access is decided per deal and per role, and enforced in the database — not just hidden in the interface.
            </SectionHeading>
            <ul className="mt-14 grid border-t border-line-strong md:grid-cols-2 lg:grid-cols-3">
              {ROLES.map(([role, body], i) => (
                <li key={role} data-reveal className="border-b border-line py-7 md:pr-8 lg:[&:nth-child(3n+2)]:border-x lg:[&:nth-child(3n+2)]:px-8 lg:[&:nth-child(3n)]:pl-8" style={stagger(i % 3)}>
                  <span className="font-display text-[14px] italic text-brass-700">{ROMAN[i]}.</span>
                  <h3 className="mt-2 text-[21px] text-navy-900">{role}</h3>
                  <p className="mt-2 text-[14.5px] leading-[1.7] text-ink-2">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="relative overflow-hidden bg-navy-900 py-24 text-white lg:py-32" aria-labelledby="money-title">
          <Guilloche id="g-business" className="absolute inset-x-0 top-0 h-56 w-full opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]" tone="light" />
          <div className="container-page relative grid gap-14 lg:grid-cols-[0.85fr_1.25fr] lg:gap-20">
            <SectionHeading number="04" eyebrow="Money" title="Orchestration, never custody." id="money-title" tone="dark">
              Purchase funds move from the buyer&apos;s bank to the escrow agent or paying agent — never through Sagolik. What we protect is the part fraud targets: where the money is told to go.
            </SectionHeading>
            <ul data-reveal className="grid self-end border-t border-white/15 sm:grid-cols-2">
              {CONTROLS.map(([t, b], i) => (
                <li key={t} className="follow border-b border-white/10 py-7 sm:odd:border-r sm:odd:pr-8 sm:even:pl-8" style={stagger(i)}>
                  <span className="font-display text-[14px] italic text-brass-300">{ROMAN[i]}.</span>
                  <p className="mt-2 font-display text-[20px] leading-snug">{t}</p>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-white/65">{b}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="py-24 lg:py-32" aria-labelledby="scope-title">
          <div className="container-page">
            <SectionHeading number="05" eyebrow="Beta scope" title="What's in the beta — and what isn't yet." id="scope-title">
              We&apos;d rather tell you the limits than have you find them mid-deal.
            </SectionHeading>
            <div className="mt-14 grid gap-12 md:grid-cols-2">
              <Exhibit label="Included" title="Ready to pilot on real deals" reveal>
                <ul className="divide-y divide-line border-b border-line text-[14.5px] text-ink-2">
                  {INCLUDED.map((x, i) => (
                    <li key={x} className="follow flex gap-3 py-3" style={stagger(i)}>
                      <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden />
                      {x}
                    </li>
                  ))}
                </ul>
              </Exhibit>
              <Exhibit label="Not yet" title="Tracked as tasks, or on the roadmap" className="border-line-strong" reveal>
                <ul className="divide-y divide-line border-b border-line text-[14.5px] text-ink-2">
                  {NOT_YET.map((x, i) => (
                    <li key={x} className="follow flex gap-3 py-3" style={stagger(i)}>
                      <Clock className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden />
                      {x}
                    </li>
                  ))}
                </ul>
              </Exhibit>
            </div>
            <p data-reveal className="mt-10 max-w-3xl border-l-2 border-brass-500 pl-5 text-[13.5px] leading-relaxed text-ink-3">
              Sagolik Close coordinates the deal; it doesn&apos;t give legal, tax or financial advice, hold funds or decide what a deal requires. Your counsel and advisors do.
            </p>
          </div>
        </section>

        <section className="border-t border-line bg-paper py-20" aria-labelledby="beta-cta">
          <div data-reveal className="container-page flex flex-wrap items-end justify-between gap-8">
            <div className="max-w-2xl">
              <p className="kicker">Beta program</p>
              <h2 id="beta-cta" className="mt-4 text-[34px] leading-tight text-navy-900">
                Running acquisitions? Shape the beta with us.
              </h2>
              <p className="mt-3 text-[15.5px] leading-relaxed text-ink-2">We&apos;re looking for M&A advisors, deal counsel, lenders and escrow agents to pilot the workflow on real deals.</p>
            </div>
            <Link href="/contact?topic=access" className={buttonClasses("primary", "lg")}>
              Join the beta <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
