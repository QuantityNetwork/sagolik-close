/**
 * The public site, set like a well-made report: numbered sections, serif
 * headlines, hairline rules and exhibits that explain how the product works.
 * Every figure shown is from the fictional demo and labelled as such; nothing
 * here claims customers, certifications or results we don't have.
 */
import { buttonClasses, formatMoney } from "@sagolik/ui";
import { ArrowRight, ArrowUpRight, Check, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { delay, stagger } from "@/lib/motion";
import { Logo } from "../brand";
import { CountUp } from "../motion";
import { ClosingNetwork, ControlFlow, Exhibit, FundsFlow, Guilloche, JourneyLine } from "./exhibits";
import { HeroMockup } from "./hero-mockup";

export function SectionHeading({
  eyebrow,
  number,
  title,
  children,
  align = "left",
  id,
  tone = "light",
}: {
  eyebrow?: string;
  number?: string;
  title: ReactNode;
  children?: ReactNode;
  align?: "left" | "center";
  id?: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <div data-reveal className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      {eyebrow || number ? (
        <p className={`kicker ${dark ? "text-brass-300" : ""}`}>
          {number ? <span className="font-display text-[13px] tracking-[0.08em] num">{number}</span> : null}
          {eyebrow ? <span>{eyebrow}</span> : null}
        </p>
      ) : null}
      <h2 id={id} className={`mt-5 text-[34px] leading-[1.08] tracking-[-0.018em] sm:text-[46px] ${dark ? "text-white" : "text-navy-900"}`}>
        {title}
      </h2>
      {children ? <p className={`mt-5 text-[16.5px] leading-[1.7] ${dark ? "text-white/70" : "text-ink-2"}`}>{children}</p> : null}
    </div>
  );
}

function Section({ id, label, labelledBy, className, children }: { id?: string; label?: string; labelledBy?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} aria-label={label} aria-labelledby={labelledBy} className={`scroll-mt-28 py-24 lg:py-32 ${className ?? ""}`}>
      {children}
    </section>
  );
}

// ----------------------------------------------------------------------------- Hero

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-line" aria-labelledby="hero-title">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgb(15_42_71/0.045)_1px,transparent_1px)] bg-[size:calc(100%/12)_100%] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
      />
      <div className="container-page grid items-center gap-16 pt-16 pb-20 lg:grid-cols-[1.02fr_1fr] lg:gap-20 lg:pt-24 lg:pb-28">
        <div>
          <p className="kicker enter" style={delay(0)}>
            Real-estate closing infrastructure
          </p>
          <h1 id="hero-title" className="enter mt-7 text-[50px] leading-[0.98] tracking-[-0.03em] text-navy-900 sm:text-[78px]" style={delay(90)}>
            From Decision
            <br />
            to <em className="italic text-teal-700">Ownership.</em>
          </h1>
          <span aria-hidden className="enter-rule mt-9 block h-px w-28 bg-brass-500" style={delay(450)} />
          <p className="enter mt-9 max-w-[34rem] text-[18px] leading-[1.65] text-ink-2" style={delay(250)}>
            A modern closing infrastructure for buyers, sellers, agents, lenders, title partners and escrow providers — one structured record, from accepted offer to recorded deed.
          </p>
          <div className="enter mt-10 flex flex-wrap items-center gap-x-7 gap-y-4" style={delay(380)}>
            <Link href="/sign-in?intent=start" className={buttonClasses("primary", "lg")}>
              Start a closing <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link href="#platform" className="link-u inline-flex items-center gap-1.5 text-[15px] font-medium text-navy-800">
              See the platform
            </Link>
          </div>
          <dl className="enter mt-14 grid max-w-xl grid-cols-3 border-t border-line-strong" style={delay(520)}>
            {[
              ["Custody", "None — funds stay with licensed partners"],
              ["Audit", "Every step, append-only"],
              ["Compliance", "Decided by people, never by AI"],
            ].map(([k, v]) => (
              <div key={k} className="border-line py-4 pr-4 [&:not(:first-child)]:border-l [&:not(:first-child)]:pl-4">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brass-700">{k}</dt>
                <dd className="mt-1.5 text-[13px] leading-snug text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <ClosingNetwork />
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- Foundations rail

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii"];

export function TrustRail() {
  const items = [
    ["Secure identity", "Identity checks and fraud signals"],
    ["Digital signatures", "Through your e-signature provider"],
    ["Escrow coordination", "Real-time visibility, no custody"],
    ["Document vault", "Encrypted, hashed and versioned"],
    ["Audit trail", "Append-only and exportable"],
  ];
  return (
    <section aria-label="Platform foundations" className="border-b border-line bg-paper">
      <ol data-reveal className="container-page grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {items.map(([title, sub], i) => (
          <li key={title} className="follow border-line py-8 pr-5 lg:[&:not(:first-child)]:border-l lg:[&:not(:first-child)]:pl-6" style={stagger(i)}>
            <span className="font-display text-[14px] italic text-brass-700">{ROMAN[i]}.</span>
            <p className="mt-2 text-[14px] font-semibold text-ink">{title}</p>
            <p className="mt-1 text-[12.5px] leading-snug text-ink-3">{sub}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ----------------------------------------------------------------------------- 01 How it works

export function HowItWorks() {
  const steps = [
    ["Open the file", "Open a transaction, invite every party and set up the closing details. Each person gets the view their role allows."],
    ["Verify and collect", "Identities are checked by a specialist provider; documents arrive in one vault, scanned, hashed and versioned."],
    ["Coordinate and sign", "Tasks have owners and deadlines. Documents are reviewed and signed electronically, in the right order."],
    ["Close and transfer", "Funding is confirmed by the escrow partner, the deed is recorded, and only then is ownership marked transferred."],
  ];
  return (
    <Section id="how-it-works" labelledBy="how-title">
      <div className="container-page grid gap-14 lg:grid-cols-[0.85fr_1.25fr] lg:gap-20">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <SectionHeading number="01" eyebrow="How it works" title="Four stages. One accountable record." id="how-title">
            A closing involves many parties and one irreversible moment. Sagolik Close gives every step an owner, a status and the evidence behind it.
          </SectionHeading>
        </div>
        <ol className="border-b border-line">
          {steps.map(([title, body], i) => (
            <li key={title} data-reveal className="grid grid-cols-[72px_1fr] gap-6 border-t border-line py-9 sm:grid-cols-[96px_1fr]">
              <span className="font-display text-[44px] leading-none text-brass-600 num sm:text-[56px]">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3 className="text-[25px] leading-snug text-navy-900">{title}</h3>
                <p className="mt-3 max-w-xl text-[15px] leading-[1.7] text-ink-2">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- 02 Platform

export function Modules() {
  const modules = [
    ["Overview", "Your closing at a glance"],
    ["Documents", "Upload, review and sign"],
    ["Banking", "Connect accounts by consent"],
    ["Payments", "Track every movement"],
    ["Escrow", "Status from your partner"],
    ["Ownership", "Recorded, then transferred"],
    ["People", "Buyers, sellers and professionals"],
    ["Tasks", "Owners and deadlines"],
    ["Timeline", "The whole journey"],
    ["Property", "Details and data"],
    ["Signatures", "Via your e-sign provider"],
    ["Identity", "Verification and fraud checks"],
    ["Financing", "Mortgage and conditions"],
    ["Title", "Clear to close"],
    ["Insurance", "Cover that matters"],
    ["Messages", "Secure, per transaction"],
    ["Integrations", "Banks, APIs and partners"],
    ["Settings", "Security and preferences"],
  ];
  return (
    <Section id="platform" labelledBy="platform-title" className="border-t border-line bg-paper">
      <div className="container-page">
        <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <SectionHeading number="02" eyebrow="The platform" title="A complete closing journey. In one place." id="platform-title">
            Every part of the closing has its own place — with the right people, documents and status — so nothing lives in scattered emails.
          </SectionHeading>
          <Link href="#security" data-reveal className="link-u inline-flex items-center gap-1.5 self-end text-[14px] font-medium text-navy-800">
            How we keep it secure <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <div className="mt-16 grid gap-14 lg:grid-cols-[1.35fr_1fr] lg:gap-16">
          <Exhibit label="Exhibit 2" title="The transaction workspace, as the buyer sees it" note="Illustration with fictional demo data.">
            <HeroMockup />
          </Exhibit>
          <div data-reveal>
            <p className="eyebrow text-brass-700">Eighteen modules, one record</p>
            <ul className="mt-4 grid grid-cols-2 border-t border-line-strong">
              {modules.map(([title, caption], i) => (
                <li key={title} className="follow border-b border-line py-3 pr-3 odd:border-r odd:pr-4 even:pl-4" style={stagger(i % 8)}>
                  <p className="text-[14px] font-semibold text-navy-900">{title}</p>
                  <p className="text-[12px] text-ink-3">{caption}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- 03 Journey

export function Journey() {
  const stages = ["Offer accepted", "Transaction opened", "Identity verified", "Documents received", "Financing approved", "Inspection", "Title cleared", "Signing", "Funds received", "Recording", "Ownership"];
  const legend = [
    ["On track", "Moving as planned.", "bg-navy-700"],
    ["Needs attention", "A deadline is close or has passed.", "bg-attention"],
    ["Blocked", "Something must be resolved first.", "bg-danger"],
    ["Complete", "Verified and recorded.", "bg-success"],
  ];
  return (
    <Section labelledBy="journey-title">
      <div className="container-page">
        <SectionHeading number="03" eyebrow="The transaction journey" title="Every stage, owned and explained." id="journey-title">
          Each milestone has an owner, a deadline, its documents and its tasks. You always know what's done, what's next and who is responsible.
        </SectionHeading>
        <Exhibit
          className="mt-14"
          label="Exhibit 3"
          title="A purchase in progress: seven of eleven milestones complete"
          note="Illustrative. Milestones and their order follow each jurisdiction's workflow; this is a United States purchase with financing."
        >
          <JourneyLine stages={stages} current={7} />
          <dl className="mt-10 grid border-y border-line sm:grid-cols-2 lg:grid-cols-4">
            {legend.map(([t, d, c], i) => (
              <div key={t} className="follow flex items-start gap-3 border-line py-5 pr-5 max-lg:[&:nth-child(n+3)]:border-t lg:[&:not(:first-child)]:border-l lg:[&:not(:first-child)]:pl-5" style={stagger(i, 600)}>
                <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${c}`} aria-hidden />
                <div>
                  <dt className="text-[14px] font-semibold text-ink">{t}</dt>
                  <dd className="mt-0.5 text-[13px] text-ink-3">{d}</dd>
                </div>
              </div>
            ))}
          </dl>
        </Exhibit>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- 04 Buyers

export function BuyerExperience() {
  const steps: Array<[string, "done" | "now" | "next"]> = [
    ["Agreement", "done"],
    ["Identity", "done"],
    ["Financing", "done"],
    ["Title", "done"],
    ["Signing", "now"],
    ["Funds", "next"],
    ["Recording", "next"],
    ["Ownership", "next"],
  ];
  return (
    <Section id="buyers" labelledBy="buyers-title" className="border-t border-line bg-paper">
      <div className="container-page grid items-center gap-16 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <SectionHeading number="04" eyebrow="For buyers" title="Understand your closing at a glance." id="buyers-title">
            No jargon, no chasing emails. Your home screen shows how far along you are, the one thing that needs you next, where your money is and who is responsible for everything else.
          </SectionHeading>
          <div data-reveal className="mt-12">
            <p className="eyebrow text-brass-700">Messages the app shows, in plain language</p>
            <ul className="mt-5 space-y-5">
              {[
                "We're verifying your identity. Usually this takes less than a few minutes.",
                "Your transfer has been received and is being finalized.",
                "Your bank needs you to reconnect before we can refresh the account.",
              ].map((q, i) => (
                <li key={q} className="follow border-l-2 border-brass-500 pl-5" style={stagger(i)}>
                  <p className="font-display text-[19px] leading-snug text-navy-900 italic">“{q}”</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <figure data-reveal className="mx-auto w-full max-w-[360px]">
          <div className="rounded-[34px] bg-navy-900 p-2.5 shadow-[var(--shadow-float)]" role="img" aria-label="Illustration of the buyer home screen on a phone">
            <div className="overflow-hidden rounded-[26px] bg-canvas">
              <div className="px-5 pt-6 pb-5">
                <p className="text-[11.5px] text-ink-3">Good evening, Olivia.</p>
                <p className="mt-1 font-display text-[22px] leading-tight text-navy-900">1234 Maple Ridge Drive</p>
                <p className="text-[11.5px] text-ink-3">Closing in 6 days</p>
                <div className="mt-4 flex items-baseline justify-between text-[12.5px] text-ink-2">
                  <span>Your closing is complete to</span>
                  <CountUp value={64} suffix="%" className="font-display text-[22px] text-navy-900 num" />
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-navy-100">
                  <div className="grow h-full w-[64%] rounded-full bg-teal-600" style={stagger(0, 300)} />
                </div>
              </div>
              <div className="mx-4 rounded-card bg-navy-800 p-4 text-white">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-brass-300">Next step</p>
                <p className="mt-1.5 font-display text-[17px]">Review Closing Disclosure</p>
                <p className="text-[11.5px] text-white/65">Estimated time: 3 minutes</p>
                <span className="mt-3 inline-flex rounded-control bg-white px-3 py-1.5 text-[11.5px] font-medium text-navy-900">Review & Sign</span>
              </div>
              <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 px-5 text-[12px]">
                {steps.map(([l, s], i) => (
                  <li key={l} className="follow flex items-center gap-2" style={stagger(i, 400)}>
                    <span className={`h-2 w-2 rounded-full ${s === "done" ? "bg-navy-800" : s === "now" ? "border-2 border-teal-600" : "border border-line-strong"}`} aria-hidden />
                    <span className={s === "done" ? "text-ink-2" : s === "now" ? "font-semibold text-navy-900" : "text-ink-3"}>{l}</span>
                  </li>
                ))}
              </ul>
              <dl className="mx-5 mt-4 mb-5 space-y-1 border-t border-line pt-3 text-[12px] num">
                {[
                  ["Purchase price", formatMoney(82_500_000, "USD")],
                  ["Mortgage", formatMoney(60_000_000, "USD")],
                  ["Deposit", formatMoney(2_500_000, "USD")],
                  ["Remaining at closing", formatMoney(20_000_000, "USD")],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-ink-3">{k}</dt>
                    <dd className="font-medium text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          <figcaption className="mt-4 text-center text-[12px] text-ink-3">Illustration with fictional demo data.</figcaption>
        </figure>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- Sellers

export function SellerExperience() {
  const items = [
    ["Sign the deed securely", "Sign closing documents electronically, with a step-up check for the documents that transfer your property."],
    ["Know when proceeds release", "See payoff, conditions and disbursement status from your escrow partner — not guesses."],
    ["One place for every disclosure", "Upload disclosures once. Every professional sees the current version, and every version is kept."],
    ["Protected payout details", "Payout instructions are versioned, verified by a second person and guarded by a waiting period after any change."],
  ];
  return (
    <Section id="sellers" labelledBy="sellers-title" className="pt-0 lg:pt-0">
      <div className="container-page grid gap-12 border-t border-line pt-24 lg:grid-cols-[0.85fr_1.25fr] lg:gap-20 lg:pt-32">
        <SectionHeading eyebrow="For sellers" title="Sell without the paper chase." id="sellers-title" />
        <ul className="grid border-t border-line-strong sm:grid-cols-2">
          {items.map(([t, b], i) => (
            <li key={t} data-reveal className="border-b border-line py-8 sm:odd:border-r sm:odd:pr-8 sm:even:pl-8" style={stagger(i % 2)}>
              <span className="font-display text-[14px] italic text-brass-700">{ROMAN[i]}.</span>
              <h3 className="mt-2 text-[21px] leading-snug text-navy-900">{t}</h3>
              <p className="mt-2 text-[14.5px] leading-[1.7] text-ink-2">{b}</p>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- 05 Professionals

export function ProfessionalExperience() {
  const rows = [
    ["1234 Maple Ridge Drive", "Signing", 64, "On track", "text-success"],
    ["88 Barton Creek Blvd", "Clearing conditions", 55, "Title lien", "text-danger"],
    ["509 Lakeview Terrace", "Verifying identities", 18, "ID review", "text-attention"],
  ] as const;
  const filters = ["Closing this week", "Blocked files", "Awaiting lender", "Awaiting title", "Pending signatures", "Identity reviews"];
  return (
    <Section id="professionals" labelledBy="pro-title" className="border-t border-line bg-paper">
      <div className="container-page grid items-start gap-16 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <SectionHeading number="05" eyebrow="For professionals" title="Dozens of files. No spreadsheets." id="pro-title">
            Agents, coordinators, lenders, title and escrow officers get a portfolio command center: what's closing this week, what's blocked, what's waiting on whom — with every party's privacy intact.
          </SectionHeading>
          <ul data-reveal className="mt-10 grid grid-cols-2 border-t border-line-strong text-[14px]">
            {filters.map((f, i) => (
              <li key={f} className="follow flex items-center gap-2.5 border-b border-line py-3 pr-3 text-ink-2" style={stagger(i)}>
                <Check className="h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        </div>
        <Exhibit label="Exhibit 4" title="The command center: every file, ranked by what needs attention" note="Illustration with fictional demo data.">
          <div className="overflow-hidden rounded-card border border-line" role="img" aria-label="Illustration of the professional command center">
            <div className="flex items-center justify-between bg-navy-900 px-5 py-4 text-white">
              <p className="font-display text-[18px]">Command center</p>
              <p className="text-[11px] tracking-[0.14em] text-white/60 uppercase">This week</p>
            </div>
            <table className="w-full bg-paper text-left text-[12.5px]">
              <thead className="text-[10px] uppercase tracking-[0.16em] text-ink-3">
                <tr className="border-b border-navy-800/60">
                  <th className="px-5 py-2.5 font-semibold">Property</th>
                  <th className="hidden px-3 py-2.5 font-semibold sm:table-cell">Stage</th>
                  <th className="px-3 py-2.5 font-semibold">Progress</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Attention</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([p, s, v, a, tone], i) => (
                  <tr key={p} className="follow border-b border-line last:border-b-0" style={stagger(i, 200)}>
                    <td className="px-5 py-3.5 font-medium text-ink">{p}</td>
                    <td className="hidden px-3 py-3.5 text-ink-2 sm:table-cell">{s}</td>
                    <td className="px-3 py-3.5">
                      <span className="flex items-center gap-2.5">
                        <span className="block h-1 w-20 overflow-hidden rounded-full bg-navy-100">
                          <span className="grow block h-full rounded-full bg-navy-700" style={{ ...stagger(i, 500), width: `${v}%` }} />
                        </span>
                        <span className="text-[11.5px] text-ink-3 num">{v}%</span>
                      </span>
                    </td>
                    <td className={`px-5 py-3.5 text-right font-medium ${tone}`}>{a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Exhibit>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- 06 Bank connectivity

export function Banking() {
  const steps = [
    ["Choose your bank", "Pick your bank; we send you to its own secure consent page."],
    ["Approve on your bank's site", "Your bank asks you to confirm. Credentials never touch Sagolik Close."],
    ["We verify ownership", "We confirm the account is in your name and show only the last four digits."],
    ["See what's needed", "Funds required at closing, next to what's available — before you send anything."],
  ];
  return (
    <Section labelledBy="banking-title">
      <div className="container-page">
        <SectionHeading number="06" eyebrow="Bank connectivity" title="We never ask for your banking password." id="banking-title">
          You connect through your own bank's consent screen, through an open-banking provider such as Plaid. We see only what you allow — account ownership, masked account numbers and balances — and you can disconnect at any time.
        </SectionHeading>
        <ol data-reveal className="relative mt-16 grid gap-10 md:grid-cols-4 md:gap-8">
          <span aria-hidden className="grow absolute top-[19px] right-[12%] left-[12%] hidden h-px bg-navy-800/30 md:block" />
          {steps.map(([t, b], i) => (
            <li key={t} className="follow relative md:text-center" style={stagger(i, 250)}>
              <span className="relative z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-navy-800 bg-canvas font-display text-[16px] text-navy-900 num">{i + 1}</span>
              <p className="mt-5 text-[16px] font-semibold text-ink">{t}</p>
              <p className="mx-auto mt-2 max-w-[17rem] text-[14px] leading-relaxed text-ink-3">{b}</p>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- 07 Security

export function Security() {
  const controls = [
    ["Step-up authentication", "Moving money, changing payment details and signing closing documents require a fresh second factor."],
    ["Dual control", "A second authorized person approves transfers and verifies payment instructions — never the person who entered them."],
    ["Cooling-off on changes", "Changed payout details enter a waiting period, and every party is alerted to verify by phone."],
    ["Encryption and least privilege", "Tokens and account numbers are encrypted at rest; row-level security isolates every transaction and organization."],
    ["Append-only audit trail", "Who did what, when and from where — enforced in the database, exportable for auditors."],
    ["Humans decide compliance", "Automated checks flag; qualified people decide. AI never approves identity, anti-money-laundering or funds."],
  ];
  return (
    <section id="security" className="relative scroll-mt-28 overflow-hidden bg-navy-900 py-24 text-white lg:py-32" aria-labelledby="security-title">
      <Guilloche id="g-security" className="absolute inset-x-0 top-0 h-56 w-full opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]" tone="light" />
      <div className="container-page relative">
        <SectionHeading number="07" eyebrow="Security" title="Built for the most targeted moment in a home purchase." id="security-title" tone="dark">
          Closing fraud targets the day money moves. Sagolik Close treats every payment instruction as a protected, versioned object — not editable text in an email.
        </SectionHeading>
        <Exhibit className="mt-16 border-white/80 [&_.exhibit-label]:text-brass-300 [&_.exhibit-note]:border-white/15 [&_.exhibit-title]:text-white" label="Exhibit 5" title="The life of a payment instruction" note={<span className="text-white/55">How the product handles every new or changed instruction. Timings are set per transaction.</span>}>
          <ControlFlow />
        </Exhibit>
        <ul data-reveal className="mt-16 grid border-t border-white/15 md:grid-cols-2 lg:grid-cols-3">
          {controls.map(([t, b], i) => (
            <li key={t} className="follow border-b border-white/10 py-8 md:pr-8 lg:[&:nth-child(3n+2)]:border-x lg:[&:nth-child(3n+2)]:px-8 lg:[&:nth-child(3n)]:pl-8" style={stagger(i)}>
              <span className="font-display text-[14px] italic text-brass-300">{ROMAN[i]}.</span>
              <h3 className="mt-2 text-[20px] leading-snug text-white">{t}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-white/65">{b}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 08 Escrow, signatures, vault

export function EscrowSignaturesVault() {
  const blocks = [
    ["Escrow", "Orchestration, not custody", "Your licensed escrow or title partner holds the funds. Sagolik Close shows the required amount, what's received, what's outstanding, the conditions and the expected release — and records settlement only when the provider confirms it."],
    ["Electronic signatures", "Sign once, keep forever", "Signature requests go to the right people in the right order. The signed copy and the provider's completion certificate are stored as a new, immutable version — the original is never overwritten."],
    ["Document vault", "Every version, every hash", "Uploads are scanned, type-checked and hashed before storage. Access follows each document's classification, every view is audited, and extracted details stay suggestions until a person confirms them."],
  ];
  return (
    <Section label="Escrow, signatures and documents">
      <div className="container-page">
        <div className="grid gap-14 lg:grid-cols-[0.85fr_1.25fr] lg:gap-20">
          <SectionHeading number="08" eyebrow="Funds, signatures and records" title="Orchestration, not custody.">
            Sagolik Close coordinates the people and the paperwork around the money. The money itself moves only between banks and the licensed escrow or title partner.
          </SectionHeading>
          <Exhibit label="Exhibit 6" title="Who holds the money" note="Illustrative. Some closings fund through a title company or attorney trust account; the principle is the same.">
            <FundsFlow />
          </Exhibit>
        </div>
        <div className="mt-20 grid border-t border-line-strong lg:grid-cols-3">
          {blocks.map(([eyebrow, title, body], i) => (
            <article key={eyebrow} data-reveal className="border-b border-line py-9 lg:border-b-0 lg:[&:not(:first-child)]:border-l lg:[&:not(:first-child)]:pl-10 lg:[&:not(:last-child)]:pr-10" style={stagger(i)}>
              <p className="eyebrow text-brass-700">{eyebrow}</p>
              <h3 className="mt-3 text-[26px] leading-tight text-navy-900">{title}</h3>
              <p className="mt-3 text-[14.5px] leading-[1.7] text-ink-2">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- 09 Ownership

export function Ownership() {
  return (
    <Section labelledBy="ownership-title" className="border-t border-line bg-paper">
      <div className="container-page grid items-center gap-16 lg:grid-cols-2">
        <div data-reveal className="relative">
          <div className="relative aspect-[4/3] overflow-hidden rounded-card">
            <Image src="/images/scenes/ownership.jpg" alt="A modern home with a pool at dusk" fill sizes="(min-width: 1024px) 560px, 100vw" className="zoom-on-scroll object-cover saturate-[0.85]" />
          </div>
          <div className="follow absolute -bottom-6 left-6 flex items-center gap-4 rounded-card border border-line bg-paper px-5 py-4 shadow-[var(--shadow-float)] sm:left-10" style={stagger(0, 500)}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success text-white">
              <Check className="h-4 w-4" aria-hidden />
            </span>
            <div className="text-sm">
              <p className="font-semibold text-ink">Ownership recorded</p>
              <p className="text-[12px] text-ink-3">Registry reference confirmed</p>
            </div>
          </div>
        </div>
        <SectionHeading number="09" eyebrow="Ownership transfer" title="Never “transferred” because someone clicked a button." id="ownership-title">
          Ownership is marked transferred only after the deed is recorded — confirmed by a registry integration or by the authorized professional, with the recording reference. Then your permanent Home Record begins: signed documents, mortgage, insurance, warranties, renovations and receipts.
        </SectionHeading>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- Brighter tomorrow band

export function BrighterTomorrow() {
  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="tomorrow-title">
      <Image src="/images/scenes/brighter-tomorrow.jpg" alt="" fill sizes="100vw" className="zoom-on-scroll -z-10 object-cover" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-navy-950/95 via-navy-900/80 to-navy-900/20" />
      <div className="container-page py-28 lg:py-36">
        <div data-reveal className="max-w-2xl text-white">
          <p className="kicker text-brass-300">Real people. Real progress.</p>
          <h2 id="tomorrow-title" className="mt-6 text-[40px] leading-[1.06] tracking-[-0.02em] sm:text-[56px]">
            More than a transaction.
            <br />
            <em className="italic text-brass-100">A brighter tomorrow.</em>
          </h2>
          <p className="mt-6 max-w-md text-[16px] leading-relaxed text-white/75">Sagolik Close gives you the clarity, security and support to move forward with what matters most.</p>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 10 Parties and commitments

export function Parties() {
  const parties = [
    ["Buyers", "A simpler, clearer path to homeownership."],
    ["Agents", "Keep clients informed and deals on track."],
    ["Lenders", "Faster documentation and smoother coordination."],
    ["Title & escrow", "Structured workflows and verified instructions."],
  ];
  const commitments = [
    ["One workspace", "for every party and every document"],
    ["Every step audited", "append-only, exportable history"],
    ["No passwords shared", "bank consent happens at your bank"],
    ["People decide", "compliance and money never run on autopilot"],
  ];
  return (
    <Section labelledBy="parties-title">
      <div className="container-page">
        <SectionHeading number="10" eyebrow="Every side of the table" title="Designed for every party in the transaction." id="parties-title">
          Different roles. A better closing experience for all — with each party seeing exactly what they should.
        </SectionHeading>
        <ul className="mt-14 grid border-t border-line-strong sm:grid-cols-2 lg:grid-cols-4">
          {parties.map(([t, b], i) => (
            <li key={t} data-reveal className="border-b border-line py-7 sm:pr-6 lg:[&:not(:first-child)]:border-l lg:[&:not(:first-child)]:pl-6" style={stagger(i)}>
              <h3 className="text-[22px] text-navy-900">{t}</h3>
              <p className="mt-1.5 text-[14px] text-ink-3">{b}</p>
            </li>
          ))}
        </ul>
        <div data-reveal className="mt-20 rounded-card bg-navy-900 px-8 py-10 text-white sm:px-12">
          <p className="kicker text-brass-300">Our commitments</p>
          <ul className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {commitments.map(([a, b], i) => (
              <li key={a} className="follow" style={stagger(i, 200)}>
                <p className="font-display text-[24px] leading-tight">{a}</p>
                <p className="mt-1.5 text-[13.5px] text-white/60">{b}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- 11 Integrations

export function Integrations() {
  const groups = [
    ["Open banking", "Plaid, TrueLayer, Tink, GoCardless, Yapily"],
    ["Identity & KYC", "Persona, Veriff, Stripe Identity, Onfido, Signicat, BankID"],
    ["E-signatures", "DocuSign, Dropbox Sign, Adobe Acrobat Sign, SignNow"],
    ["Escrow & payments", "Licensed escrow and title partners, bank rails (ACH, wire, SEPA)"],
    ["Property & title", "Property-data providers, title plants, national land registries"],
    ["Messaging", "Email and SMS providers, calendar (Google, Microsoft, ICS)"],
  ];
  return (
    <Section id="resources" labelledBy="integrations-title" className="border-t border-line bg-paper">
      <div className="container-page grid gap-14 lg:grid-cols-[0.85fr_1.25fr] lg:gap-20">
        <div>
          <SectionHeading number="11" eyebrow="API & integrations" title="Provider-agnostic by design." id="integrations-title">
            Every regulated function sits behind a typed adapter, so each market can use the providers that are licensed there. A versioned REST API and signed webhooks let partner systems — and, with the same permissions as people, AI agents — work with Sagolik Close.
          </SectionHeading>
          <p data-reveal className="mt-6 text-[12px] leading-relaxed text-ink-3">Names are examples of compatible provider categories, not announced partnerships. Availability varies by market.</p>
        </div>
        <table data-reveal className="w-full self-start text-left">
          <caption className="sr-only">Provider categories and examples</caption>
          <thead>
            <tr className="border-b border-navy-800/70 text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
              <th className="py-3 pr-6 font-semibold">Category</th>
              <th className="py-3 font-semibold">Examples</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([t, b], i) => (
              <tr key={t} className="follow border-b border-line align-top" style={stagger(i)}>
                <th scope="row" className="py-4 pr-6 font-display text-[18px] font-normal whitespace-nowrap text-navy-900">
                  {t}
                </th>
                <td className="py-4 text-[14px] leading-relaxed text-ink-2">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- Pilot program

export function PilotProgram() {
  return (
    <Section labelledBy="pilot-title" className="py-20 lg:py-24">
      <div className="container-page">
        <div data-reveal className="grid gap-8 border-y border-line-strong py-12 md:grid-cols-[1fr_auto] md:items-center md:gap-16">
          <div className="max-w-2xl border-l-2 border-brass-500 pl-7">
            <p className="kicker">Pilot program</p>
            <h2 id="pilot-title" className="mt-4 text-[32px] leading-tight text-navy-900">
              We&apos;re early, and we say so.
            </h2>
            <p className="mt-3 text-[15.5px] leading-[1.7] text-ink-2">
              Sagolik Close is in its pilot phase. We don&apos;t show customer quotes, logos, ratings or usage figures until real customers have agreed to share them. If you run an agency, a title or escrow company, or a lending team, you can shape what we build next.
            </p>
          </div>
          <Link href="/contact?topic=access" className={buttonClasses("primary", "lg", "shrink-0")}>
            Join the pilot <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- 12 Pricing

export interface PlanView {
  key: string;
  name: string;
  audience: string;
  features: string[];
}

export function Pricing({ plans }: { plans: PlanView[] }) {
  return (
    <Section id="pricing" labelledBy="pricing-title" className="border-t border-line bg-paper">
      <div className="container-page">
        <SectionHeading number="12" eyebrow="Pricing" title="Plans for every side of the table." id="pricing-title">
          During the pilot, pricing is agreed with each customer. Buyers and sellers join when a professional on their transaction invites them.
        </SectionHeading>
        <ul className="mt-14 grid border-t border-line-strong md:grid-cols-2 lg:grid-cols-4">
          {plans.map((p, i) => {
            const featured = p.key === "professional";
            return (
              <li
                key={p.key}
                data-reveal
                className={`flex flex-col border-b border-line py-8 md:px-7 lg:[&:not(:first-child)]:border-l ${featured ? "relative bg-canvas before:absolute before:inset-x-0 before:-top-px before:h-[3px] before:bg-navy-800" : ""}`}
                style={stagger(i)}
              >
                <p className="eyebrow text-brass-700">{p.audience}</p>
                <h3 className="mt-3 text-[30px] text-navy-900">{p.name}</h3>
                <p className="mt-1 text-[13.5px] text-ink-3">{p.key === "consumer" ? "By invitation" : "Priced during the pilot"}</p>
                <ul className="mt-6 flex-1 space-y-2.5 text-[14px] text-ink-2">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2.5">
                      <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href={p.key === "consumer" ? "/sign-in" : "/contact"} className={buttonClasses(featured ? "primary" : "secondary", "md", "mt-8 w-full")}>
                  {p.key === "consumer" ? "Sign in" : "Contact sales"}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- 13 FAQ

export function Faq() {
  const qa = [
    ["Does Sagolik Close hold my money?", "No. Funds are held by the licensed escrow, title or trust-account provider on your transaction. Sagolik Close coordinates the instructions, approvals and status, and records settlement only when that provider confirms it."],
    ["Will you ever ask for my online-banking password?", "Never. Bank connections happen on your bank's own consent page through an open-banking provider. If anyone asks for your banking password in our name, it's fraud."],
    ["What if payment instructions change?", "Any change creates a new version that must be independently verified by a second person, triggers a security notice to every party and enters a waiting period before it can be used. Always confirm by phone using a number you already know."],
    ["Is my identity document stored by Sagolik Close?", "Identity checks are performed by a specialist provider. We store the minimum result needed — for example “verified” and which checks passed — not your ID images, unless a jurisdiction requires it."],
    ["Does the AI assistant make decisions?", "No. The assistant explains your transaction using the same structured data you see. It cannot move money, change bank details, approve checks, sign or transfer ownership."],
    ["Which markets are supported?", "Our workflow engine models each jurisdiction separately — the United States first. Rules for Texas, California, Sweden, Poland, Germany, Liechtenstein and Switzerland are modelled as a starting point and each needs local legal review before launch there. We don't pretend one workflow fits every market."],
  ];
  return (
    <Section labelledBy="faq-title">
      <div className="container-page grid gap-14 lg:grid-cols-[0.85fr_1.25fr] lg:gap-20">
        <SectionHeading number="13" eyebrow="Questions" title="Questions, answered plainly." id="faq-title" />
        <div data-reveal className="border-t border-line-strong">
          {qa.map(([q, a]) => (
            <details key={q} className="smooth group border-b border-line">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-6 font-display text-[19px] leading-snug text-navy-900 [&::-webkit-details-marker]:hidden">
                {q}
                <Plus aria-hidden className="mt-1 h-4 w-4 shrink-0 text-brass-600 transition-transform duration-300 group-open:rotate-45" />
              </summary>
              <p className="max-w-2xl pb-6 text-[15px] leading-[1.7] text-ink-2">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- Closing call to action

export function FinalCta() {
  return (
    <section className="relative isolate overflow-hidden bg-navy-900 text-white" aria-labelledby="cta-title">
      <Guilloche id="g-cta" className="absolute inset-0 -z-10 h-full w-full opacity-70" tone="light" lines={14} height={220} />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-navy-900 via-navy-900/90 to-navy-900/40" />
      <div className="container-page flex flex-col items-start justify-between gap-10 py-24 md:flex-row md:items-end">
        <div data-reveal>
          <p className="kicker text-brass-300">Same people. A brighter tomorrow.</p>
          <h2 id="cta-title" className="mt-5 text-[42px] leading-[1.04] tracking-[-0.02em] sm:text-[58px]">
            Close with confidence.
          </h2>
          <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-white/70">Sagolik Close helps turn complex transactions into a clear path to ownership.</p>
        </div>
        <div data-reveal className="flex flex-wrap gap-3" style={stagger(1)}>
          <Link href="/contact?topic=access" className={buttonClasses("light", "lg")}>
            Request access <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link href="/contact?topic=sales" className={buttonClasses("secondary", "lg", "bg-transparent text-white ring-white/40 hover:bg-white/10 hover:ring-white/70")}>
            Talk to sales
          </Link>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- Footer

export function SiteFooter() {
  const cols = [
    ["Platform", [["How it works", "/#how-it-works"], ["Features", "/#platform"], ["Security", "/#security"], ["Pricing", "/#pricing"], ["Business acquisitions (beta)", "/business"]]],
    ["Get started", [["Sign in", "/sign-in"], ["Start closing", "/sign-in?intent=start"], ["Book a demo", "/contact"]]],
    ["Legal", [["Privacy", "/legal/privacy"], ["Terms", "/legal/terms"], ["Compliance boundaries", "/legal/compliance"]]],
  ] as const;
  return (
    <footer className="bg-navy-950 text-white/70">
      <div className="container-page grid gap-12 py-16 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div>
          <Logo variant="light" className="h-9 w-auto" />
          <p className="mt-5 max-w-xs text-[13.5px] leading-relaxed text-white/55">Sagolik Close — the orchestration layer from decision to ownership. Part of Sagolik: Software That Works For People.</p>
        </div>
        {cols.map(([title, links]) => (
          <nav key={title} aria-label={title}>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-brass-300">{title}</p>
            <ul className="mt-4 space-y-2.5 text-[14px]">
              {links.map(([label, href]) => (
                <li key={label}>
                  <Link href={href} className="link-u text-white/70 hover:text-white">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="container-page flex flex-wrap items-start justify-between gap-x-10 gap-y-3 py-6 text-[12px] text-white/45">
          <p>© {new Date().getFullYear()} Sagolik. All rights reserved.</p>
          <p className="max-w-2xl">
            Sagolik Close is software that coordinates closings. It does not hold funds, give legal, tax or lending advice, or act as an escrow, title or settlement agent.{" "}
            <Link href="/legal/compliance" className="inline-flex items-center gap-0.5 text-white/65 underline-offset-2 hover:text-white hover:underline">
              Compliance boundaries <ArrowUpRight className="h-3 w-3" aria-hidden />
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
