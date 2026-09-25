import { buttonClasses, IconTile, ParticipantAvatar, ProductIcon, type ProductIconName, ProgressStepper } from "@sagolik/ui";
import { ArrowRight, Check, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SectionHeading, SiteFooter } from "@/components/landing/sections";
import { SiteHeader } from "@/components/landing/site-header";

export const metadata: Metadata = {
  title: "Business acquisitions (beta)",
  description: "The Sagolik Close workflow for buying a business: letter of intent, due diligence, financing, definitive agreement, funds flow and a confirmed ownership transfer — in one deal room.",
};

const JOURNEY: Array<[ProductIconName, string, string]> = [
  ["overview", "LOI & deal room", "The signed letter of intent opens a deal room for buyer, seller, advisors, counsel, lender and escrow."],
  ["title", "Due diligence", "Financials, quality of earnings, disclosure schedules and lien searches — each with an owner and a status."],
  ["financing", "Financing", "Lender conditions tracked next to the deal, so everyone sees what's left before funding."],
  ["signatures", "Definitive agreement", "The asset or stock purchase agreement and closing documents, signed through an e-signature provider."],
  ["escrow", "Funds flow", "Verified payment instructions, cooling-off on changes and escrow-reported receipts — never custody."],
  ["ownership", "Closing & transfer", "Ownership is marked transferred only when deal counsel confirms it with a reference."],
];

const MODULES: Array<[ProductIconName, string, string]> = [
  ["overview", "Deal room", "One place for the deal"],
  ["documents", "Diligence vault", "Versioned, access-controlled"],
  ["people", "People & roles", "Each side sees its share"],
  ["tasks", "Tasks", "Owners and due dates"],
  ["timeline", "Timeline", "LOI to closing"],
  ["financing", "Financing", "Lender conditions"],
  ["title", "Lien search", "UCC, tax, judgments"],
  ["signatures", "Signatures", "Via your e-sign provider"],
  ["identity", "Identity", "Parties verified"],
  ["payments", "Funds flow", "Escrow-reported"],
  ["messages", "Messages", "Deal-room threads"],
  ["ownership", "Transfer", "Confirmed by counsel"],
];

const ROLES: Array<[string, string]> = [
  ["Buyer", "Their tasks, the deal timeline, financing status and verified wire details when it's time to fund."],
  ["Seller", "What's still needed from them — schedules, consents, transfer documents — and when proceeds are released."],
  ["M&A advisor", "The whole file: who is blocking, what's due this week, and every party's progress."],
  ["Counsel", "Agreements, disclosure schedules, the lien search and the final confirmation of the transfer."],
  ["Accountant", "The diligence documents they review. No access to bank details or payment instructions."],
  ["Lender & escrow agent", "Their conditions and the funds flow — with second-person verification for any payment detail."],
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

function DealMockup() {
  const steps = ["LOI", "Diligence", "Financing", "Agreement", "Funds", "Transfer"];
  return (
    <figure>
      <div role="img" aria-label="Illustration of a business acquisition deal room" className="overflow-hidden rounded-2xl border border-line bg-paper shadow-[var(--shadow-float)]">
        <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <div className="flex items-center gap-3">
            <IconTile name="transactions" size="sm" />
            <div>
              <p className="font-display text-[20px] leading-tight text-navy-800">Blue Harbor Coffee</p>
              <p className="text-[12px] text-ink-3">LLC · Specialty coffee roasting · Asset purchase</p>
            </div>
          </div>
          <span className="rounded-full bg-attention-50 px-2.5 py-1 text-[11px] font-semibold text-attention">Due diligence</span>
        </div>
        <div className="px-6 py-5">
          <ProgressStepper steps={steps.map((s, i) => ({ key: s, label: s, state: i < 1 ? "complete" : i === 1 ? "current" : "upcoming" }))} />
        </div>
        <ul className="grid gap-2 border-t border-line px-6 py-4 text-[13px] sm:grid-cols-2">
          {[
            ["Grace Liu", "Accountant", "Quality of earnings — in review"],
            ["David Chen", "Counsel", "Disclosure schedules — draft"],
            ["Michael Reed", "Lender", "Underwriting — 3 conditions open"],
            ["Rachel Kim", "M&A advisor", "Landlord consent — requested"],
          ].map(([name, role, status]) => (
            <li key={name} className="flex items-center gap-2.5 rounded-lg bg-canvas px-3 py-2">
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
      <figcaption className="mt-3 text-center text-[12px] text-ink-3">Illustration with fictional demo data.</figcaption>
    </figure>
  );
}

export default function BusinessPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="relative overflow-hidden border-b border-line bg-gradient-to-b from-paper to-canvas">
          <div className="container-page grid items-center gap-12 py-16 lg:grid-cols-[1fr_1.05fr] lg:py-20">
            <div className="animate-rise">
              <p className="eyebrow flex items-center gap-2 text-teal-700">
                Sagolik Close for business
                <span className="rounded-full border border-teal-600/30 bg-teal-50 px-2 py-0.5 text-[10.5px] tracking-[0.14em]">Beta</span>
              </p>
              <h1 className="mt-4 text-[44px] leading-[1.05] text-navy-800 sm:text-[56px]">
                Buying a business, <span className="text-teal-600">closed with clarity.</span>
              </h1>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-2">
                The same closing infrastructure we build for property, shaped for acquisitions: one deal room from letter of intent to a confirmed ownership transfer — for buyers, sellers, advisors, counsel, lenders and escrow.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/sign-in" className={buttonClasses("primary", "lg")}>
                  Explore the demo deal <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link href="/contact?topic=access" className={buttonClasses("secondary", "lg")}>
                  Join the beta
                </Link>
              </div>
              <p className="mt-4 text-[12.5px] text-ink-3">In the demo, choose a person under “Business acquisition (beta)”.</p>
            </div>
            <div className="animate-rise [animation-delay:120ms]">
              <DealMockup />
            </div>
          </div>
        </section>

        <section className="py-20" aria-labelledby="journey-title">
          <div className="container-page">
            <SectionHeading eyebrow="From LOI to close" title="Every stage of the deal, owned and visible" id="journey-title">
              Each step has an owner, a status and the documents behind it. Nobody has to ask where the deal stands.
            </SectionHeading>
            <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {JOURNEY.map(([icon, title, body], i) => (
                <li key={title} className="rounded-xl border border-line bg-paper p-6">
                  <div className="flex items-center justify-between">
                    <IconTile name={icon} size="md" />
                    <span className="font-display text-[34px] leading-none text-navy-100">{String(i + 1).padStart(2, "0")}</span>
                  </div>
                  <h3 className="mt-5 font-sans text-[15px] font-semibold text-ink">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-3">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t border-line bg-gradient-to-b from-paper to-[#eef2f6] py-20" aria-labelledby="modules-title">
          <div className="container-page">
            <SectionHeading eyebrow="In the deal room" title="A complete acquisition closing. In one place." align="center" id="modules-title" />
            <ul className="mt-12 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
              {MODULES.map(([icon, title, caption]) => (
                <li key={title} className="flex flex-col items-center text-center">
                  <IconTile name={icon} size="lg" />
                  <h3 className="mt-3 font-sans text-[15px] font-semibold text-navy-800">{title}</h3>
                  <p className="mt-0.5 text-[10.5px] uppercase tracking-[0.14em] text-ink-3">{caption}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="py-20" aria-labelledby="roles-title">
          <div className="container-page">
            <SectionHeading eyebrow="Every side of the table" title="Each party sees exactly what they should" id="roles-title">
              Access is decided per deal and per role, and enforced in the database — not just hidden in the interface.
            </SectionHeading>
            <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {ROLES.map(([role, body]) => (
                <li key={role} className="rounded-xl border border-line bg-paper p-6">
                  <p className="font-sans text-[15px] font-semibold text-ink">{role}</p>
                  <p className="mt-2 text-sm leading-relaxed text-ink-3">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="bg-navy-900 py-20 text-white" aria-labelledby="money-title">
          <div className="container-page grid gap-10 lg:grid-cols-2">
            <div>
              <p className="eyebrow mb-3 text-teal-300">Money</p>
              <h2 id="money-title" className="text-[34px] leading-[1.1] sm:text-[42px]">
                Orchestration, never custody
              </h2>
              <p className="mt-4 text-[16px] leading-relaxed text-white/75">
                Purchase funds move from the buyer&apos;s bank to the escrow agent or paying agent — never through Sagolik. What we protect is the part fraud targets: where the money is told to go.
              </p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["identity", "Step-up for every change", "Changing or revealing payment details needs a fresh second factor."],
                  ["people", "A second person verifies", "Instructions are verified by someone other than their author, with a call reference."],
                  ["timeline", "Cooling-off on changes", "Changed details wait before they can be used, and every party is alerted."],
                  ["escrow", "Receipts from escrow", "Funds show as received only when the escrow agent records it."],
                ] as const
              ).map(([icon, t, b]) => (
                <li key={t} className="rounded-xl bg-white/5 p-5 ring-1 ring-white/10">
                  <ProductIcon name={icon} tone="light" size={24} />
                  <p className="mt-3 text-[15px] font-semibold">{t}</p>
                  <p className="mt-1 text-sm text-white/70">{b}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="py-20" aria-labelledby="scope-title">
          <div className="container-page">
            <SectionHeading eyebrow="Beta scope" title="What's in the beta — and what isn't yet" id="scope-title">
              We&apos;d rather tell you the limits than have you find them mid-deal.
            </SectionHeading>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-line bg-paper p-6">
                <p className="font-sans text-[15px] font-semibold text-ink">Included</p>
                <ul className="mt-4 space-y-2.5 text-sm text-ink-2">
                  {INCLUDED.map((x) => (
                    <li key={x} className="flex gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden />
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-dashed border-line-strong bg-paper/60 p-6">
                <p className="font-sans text-[15px] font-semibold text-ink">Not yet</p>
                <ul className="mt-4 space-y-2.5 text-sm text-ink-2">
                  {NOT_YET.map((x) => (
                    <li key={x} className="flex gap-2.5">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ink-4" aria-hidden />
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mt-6 max-w-3xl text-[13px] text-ink-3">
              Sagolik Close coordinates the deal; it doesn&apos;t give legal, tax or financial advice, hold funds or decide what a deal requires. Your counsel and advisors do.
            </p>
          </div>
        </section>

        <section className="border-t border-line bg-paper py-16" aria-labelledby="beta-cta">
          <div className="container-page flex flex-wrap items-center justify-between gap-6">
            <div className="max-w-xl">
              <h2 id="beta-cta" className="text-[30px] leading-tight text-navy-800">
                Running acquisitions? Shape the beta with us.
              </h2>
              <p className="mt-2 text-[15px] text-ink-2">We&apos;re looking for M&A advisors, deal counsel, lenders and escrow agents to pilot the workflow on real deals.</p>
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
