import { buttonClasses, formatMoney, ProgressStepper } from "@sagolik/ui";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Bell,
  Building2,
  CalendarClock,
  Check,
  FileLock2,
  FileSignature,
  Fingerprint,
  FolderLock,
  Home,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Lock,
  PenLine,
  Scale,
  ScrollText,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  Workflow,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "../brand";
import { HeroMockup } from "./hero-mockup";

function SectionHeading({ eyebrow, title, children, align = "left", id }: { eyebrow?: string; title: ReactNode; children?: ReactNode; align?: "left" | "center"; id?: string }) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      {eyebrow ? <p className="eyebrow mb-3 text-teal-700">{eyebrow}</p> : null}
      <h2 id={id} className="text-[34px] leading-[1.1] text-navy-800 sm:text-[42px]">
        {title}
      </h2>
      {children ? <p className="mt-4 text-[16px] leading-relaxed text-ink-2">{children}</p> : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- 01 Hero

export function Hero() {
  return (
    <section className="relative overflow-hidden" aria-labelledby="hero-title">
      <div className="absolute inset-0 -z-10">
        <Image src="/images/scenes/hero-interior.jpg" alt="" fill priority sizes="100vw" className="object-cover object-left opacity-[0.22]" />
        <div className="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/90 to-canvas/60" />
      </div>
      <div className="container-page grid items-center gap-12 pt-14 pb-16 lg:grid-cols-[1fr_1.15fr] lg:pt-20 lg:pb-24">
        <div className="animate-rise">
          <p className="eyebrow text-teal-700">A simpler, more certain way to close</p>
          <h1 id="hero-title" className="mt-4 text-[48px] leading-[1.02] text-navy-800 sm:text-[64px]">
            From Decision
            <br />
            to <span className="text-teal-600">Ownership.</span>
          </h1>
          <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-ink-2">
            A modern closing infrastructure for buyers, sellers, agents, lenders, title partners and escrow providers.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sign-in?intent=start" className={buttonClasses("primary", "lg")}>
              Start Closing <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link href="#platform" className={buttonClasses("secondary", "lg")}>
              See Platform
            </Link>
          </div>
          <ul className="mt-10 grid max-w-lg grid-cols-3 gap-4 text-[12px]">
            {[
              [Lock, "Secure", "by design"],
              [Workflow, "Structured", "workflows"],
              [Landmark, "Partner", "ready"],
            ].map(([Icon, a, b]) => {
              const I = Icon as typeof Lock;
              return (
                <li key={a as string} className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-paper text-teal-700">
                    <I className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="leading-tight">
                    <span className="block font-semibold text-ink">{a as string}</span>
                    <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-3">{b as string}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="animate-rise [animation-delay:120ms]">
          <HeroMockup />
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 02 Trust rail

export function TrustRail() {
  const items = [
    [Fingerprint, "Secure Identity", "KYC & fraud protection"],
    [PenLine, "Digital Signatures", "eSign compliant"],
    [Landmark, "Escrow Coordination", "Real-time visibility"],
    [FolderLock, "Document Vault", "Encrypted & versioned"],
    [ShieldCheck, "Audit Trails", "Complete transparency"],
  ] as const;
  return (
    <section aria-label="Platform foundations" className="border-y border-line bg-paper">
      <ul className="container-page grid grid-cols-2 gap-y-6 py-7 sm:grid-cols-3 lg:grid-cols-5">
        {items.map(([Icon, title, sub]) => (
          <li key={title} className="flex items-center gap-3 lg:justify-center">
            <Icon className="h-6 w-6 shrink-0 text-navy-800" strokeWidth={1.5} aria-hidden />
            <span className="leading-tight">
              <span className="block text-[13.5px] font-semibold text-ink">{title}</span>
              <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-3">{sub}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ----------------------------------------------------------------------------- 03 How it works

export function HowItWorks() {
  const steps = [
    [Building2, "Start the file", "Open a transaction, invite every party and set up your closing details in minutes."],
    [UserRound, "Verify & collect", "Verify identities securely and collect documents from every party in one place."],
    [FileSignature, "Coordinate & sign", "Keep everyone aligned, review documents and sign electronically with confidence."],
    [Home, "Close & transfer ownership", "Confirm funding, record the deed and complete the handoff — from decision to ownership."],
  ] as const;
  return (
    <section id="how-it-works" className="scroll-mt-24 py-20" aria-labelledby="how-title">
      <div className="container-page">
        <SectionHeading eyebrow="A clearer path for everyone" title="How Sagolik Close Works" align="center" id="how-title" />
        <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {steps.map(([Icon, title, body], i) => (
            <li key={title} className="relative rounded-xl border border-line bg-paper p-6">
              <div className="flex items-center gap-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong font-display text-lg text-navy-800">{i + 1}</span>
                <Icon className="h-6 w-6 text-teal-600" strokeWidth={1.5} aria-hidden />
              </div>
              <h3 className="mt-5 font-sans text-[15px] font-semibold text-ink">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-3">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 04 Product modules

export function Modules() {
  const modules = [
    [LayoutDashboard, "Closing Dashboard", "End-to-end visibility across every transaction, deadline and party."],
    [FolderLock, "Document Vault", "Encrypted storage, immutable versions, hashes and access control per document."],
    [ShieldCheck, "Identity & Compliance", "KYC, sanctions and source-of-funds checks — always with a human reviewer."],
    [Landmark, "Escrow Coordination", "Verified instructions, deposits and conditions with your licensed escrow partner."],
    [Bell, "Smart Notifications", "The right person, the right moment, the right channel — never sensitive data by SMS."],
    [CalendarClock, "Ownership Timeline", "A clear, trackable record from contract to recording — and beyond."],
  ] as const;
  return (
    <section id="platform" className="scroll-mt-24 border-t border-line bg-paper py-20" aria-labelledby="platform-title">
      <div className="container-page">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading title="Built for Modern Closings" id="platform-title">
            Everything you need for a faster, more secure and more transparent closing.
          </SectionHeading>
          <Link href="#security" className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:text-teal-800">
            How we keep it secure <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {modules.map(([Icon, title, body]) => (
            <li key={title} className="flex gap-4 rounded-xl border border-line bg-canvas/40 p-6">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-800">
                <Icon className="h-5 w-5" strokeWidth={1.6} aria-hidden />
              </span>
              <div>
                <h3 className="font-sans text-[15px] font-semibold text-ink">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 05 Transaction journey

export function Journey() {
  const stages = ["Offer accepted", "Transaction opened", "Identity verified", "Documents received", "Financing approved", "Inspection", "Title cleared", "Signing", "Funds received", "Recording", "Ownership"];
  return (
    <section className="py-20" aria-labelledby="journey-title">
      <div className="container-page">
        <SectionHeading eyebrow="The transaction journey" title="Every stage, owned and explained" id="journey-title">
          Each milestone has an owner, a deadline, its documents and its tasks. You always know what's done, what's next and who is responsible.
        </SectionHeading>
        <div className="mt-10 overflow-x-auto rounded-xl border border-line bg-paper p-6">
          <div className="min-w-[760px]">
            <ProgressStepper steps={stages.map((s, i) => ({ key: s, label: s, state: i < 7 ? "complete" : i === 7 ? "current" : "upcoming" }))} />
          </div>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {[
            ["Normal", "Moving as planned.", "bg-navy-600"],
            ["Needs attention", "A deadline is close or passed.", "bg-attention"],
            ["Blocked", "Something must be resolved first.", "bg-danger"],
            ["Complete", "Verified and recorded.", "bg-success"],
          ].map(([t, d, c]) => (
            <div key={t} className="flex items-start gap-3 rounded-lg border border-line bg-paper p-4">
              <span className={`mt-1.5 h-2 w-2 rounded-full ${c}`} aria-hidden />
              <div>
                <p className="text-sm font-semibold text-ink">{t}</p>
                <p className="text-[13px] text-ink-3">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 06 Buyer experience

export function BuyerExperience() {
  return (
    <section id="buyers" className="scroll-mt-24 border-t border-line bg-paper py-20" aria-labelledby="buyers-title">
      <div className="container-page grid items-center gap-12 lg:grid-cols-2">
        <div>
          <SectionHeading eyebrow="For buyers" title="Understand your closing in ten seconds" id="buyers-title">
            No jargon, no chasing emails. Your home screen shows how far along you are, the one thing that needs you next, where your money is and who is responsible for everything else.
          </SectionHeading>
          <ul className="mt-8 space-y-3 text-[15px] text-ink-2">
            {[
              "“We're verifying your identity. Usually this takes less than a few minutes.”",
              "“Your transfer has been received and is being finalized.”",
              "“Your bank needs you to reconnect before we can refresh the account.”",
            ].map((q) => (
              <li key={q} className="flex gap-3">
                <Check className="mt-1 h-4 w-4 shrink-0 text-teal-600" aria-hidden />
                <span className="italic">{q}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="mx-auto w-full max-w-sm rounded-[28px] border border-line-strong bg-canvas p-3 shadow-[var(--shadow-float)]" role="img" aria-label="Illustration of the buyer home screen on a phone">
          <div className="rounded-[20px] bg-paper p-5">
            <p className="text-[12px] text-ink-3">Good evening, Olivia.</p>
            <p className="mt-1 font-display text-[22px] leading-tight text-navy-800">1234 Maple Ridge Drive</p>
            <p className="text-[12px] text-ink-3">Closing in 6 days</p>
            <p className="mt-4 text-sm text-ink-2">Your closing is <span className="font-semibold text-navy-800">64% complete</span>.</p>
            <div className="mt-4 rounded-xl bg-navy-800 p-4 text-white">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-300">Next step</p>
              <p className="mt-1 text-[15px] font-medium">Review Closing Disclosure</p>
              <p className="text-[12px] text-white/70">Estimated time: 3 minutes</p>
              <span className="mt-3 inline-flex rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-navy-800">Review & Sign</span>
            </div>
            <ul className="mt-4 space-y-1.5 text-[12.5px]">
              {[
                ["Agreement", true],
                ["Identity", true],
                ["Financing", true],
                ["Title", true],
                ["Signing", false],
                ["Funds", false],
                ["Recording", false],
                ["Ownership", false],
              ].map(([l, d], i) => (
                <li key={l as string} className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${d ? "bg-teal-600" : i === 4 ? "border-2 border-navy-800" : "border border-line-strong"}`} aria-hidden />
                  <span className={d ? "text-ink-2" : i === 4 ? "font-semibold text-navy-800" : "text-ink-3"}>{l as string}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-1 border-t border-line pt-3 text-[12px] num">
              {[
                ["Purchase price", formatMoney(82_500_000, "USD")],
                ["Mortgage", formatMoney(60_000_000, "USD")],
                ["Deposit", formatMoney(2_500_000, "USD")],
                ["Remaining at closing", formatMoney(20_000_000, "USD")],
              ].map(([k, v]) => (
                <p key={k} className="flex justify-between">
                  <span className="text-ink-3">{k}</span>
                  <span className="font-medium text-ink">{v}</span>
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- Sellers

export function SellerExperience() {
  return (
    <section id="sellers" className="scroll-mt-24 py-20" aria-labelledby="sellers-title">
      <div className="container-page grid gap-10 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <SectionHeading eyebrow="For sellers" title="Sell without the paper chase" id="sellers-title" />
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          {[
            [FileSignature, "Sign the deed securely", "Sign closing documents electronically, with a step-up check for the documents that transfer your property."],
            [Banknote, "Know when proceeds release", "See payoff, conditions and disbursement status from your escrow partner — not guesses."],
            [ScrollText, "One place for every disclosure", "Upload disclosures once. Every professional sees the current version, and every version is kept."],
            [BadgeCheck, "Protected payout details", "Payout instructions are versioned, verified by a second person and guarded by a waiting period after any change."],
          ].map(([Icon, t, b]) => {
            const I = Icon as typeof Home;
            return (
              <li key={t as string} className="rounded-xl border border-line bg-paper p-6">
                <I className="h-5 w-5 text-teal-600" strokeWidth={1.6} aria-hidden />
                <h3 className="mt-3 font-sans text-[15px] font-semibold text-ink">{t as string}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{b as string}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 07 Professional experience

export function ProfessionalExperience() {
  const rows = [
    ["1234 Maple Ridge Drive", "Signing", 64, "On track", "progress"],
    ["88 Barton Creek Blvd", "Clearing conditions", 55, "Title lien", "blocked"],
    ["509 Lakeview Terrace", "Verifying identities", 18, "ID review", "attention"],
  ] as const;
  return (
    <section id="professionals" className="scroll-mt-24 border-t border-line bg-paper py-20" aria-labelledby="pro-title">
      <div className="container-page grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <SectionHeading eyebrow="For professionals" title="Dozens of files. No spreadsheets." id="pro-title">
            Agents, coordinators, lenders, title and escrow officers get a portfolio command center: what's closing this week, what's blocked, what's waiting on whom — with every party's privacy intact.
          </SectionHeading>
          <div className="mt-8 grid grid-cols-2 gap-3 text-sm">
            {["Closing this week", "Blocked files", "Awaiting lender", "Awaiting title", "Pending signatures", "Identity reviews"].map((f) => (
              <span key={f} className="rounded-full border border-line px-3 py-1.5 text-center text-ink-2">
                {f}
              </span>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-line shadow-[var(--shadow-float)]" role="img" aria-label="Illustration of the professional command center">
          <div className="relative h-40">
            <Image src="/images/scenes/professionals.jpg" alt="" fill sizes="(min-width: 1024px) 600px, 100vw" className="object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-navy-900/70 to-transparent" />
            <p className="absolute bottom-3 left-4 font-display text-xl text-white">Command center</p>
          </div>
          <table className="w-full bg-paper text-left text-[12.5px]">
            <thead className="text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              <tr>
                <th className="px-4 py-2 font-semibold">Property</th>
                <th className="px-4 py-2 font-semibold">Stage</th>
                <th className="px-4 py-2 font-semibold">Progress</th>
                <th className="px-4 py-2 font-semibold">Attention</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([p, s, v, a, tone]) => (
                <tr key={p} className="border-t border-line">
                  <td className="px-4 py-2.5 font-medium text-ink">{p}</td>
                  <td className="px-4 py-2.5 text-ink-2">{s}</td>
                  <td className="px-4 py-2.5">
                    <span className="block h-1.5 w-20 rounded-full bg-navy-100">
                      <span className="block h-full rounded-full bg-teal-600" style={{ width: `${v}%` }} />
                    </span>
                  </td>
                  <td className={`px-4 py-2.5 ${tone === "blocked" ? "text-danger" : tone === "attention" ? "text-attention" : "text-success"}`}>{a}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 08 Open banking

export function Banking() {
  return (
    <section className="py-20" aria-labelledby="banking-title">
      <div className="container-page grid gap-12 lg:grid-cols-2">
        <SectionHeading eyebrow="Bank & open-banking connectivity" title="We never ask for your banking password" id="banking-title">
          You connect through your own bank's consent screen, via a regulated open-banking provider. We see only what you allow — account ownership, masked account numbers and balances — and you can disconnect at any time.
        </SectionHeading>
        <ol className="space-y-3">
          {[
            ["Choose your bank", "Pick your bank; we send you to its own secure consent page."],
            ["Approve access on your bank's site", "Your bank asks you to confirm. Credentials never touch Sagolik Close."],
            ["We verify ownership", "We confirm the account is in your name and show only the last four digits."],
            ["See what's needed", "Funds required at closing, next to what's available — before you send anything."],
          ].map(([t, b], i) => (
            <li key={t} className="flex gap-4 rounded-xl border border-line bg-paper p-5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 font-semibold text-teal-700">{i + 1}</span>
              <div>
                <p className="font-medium text-ink">{t}</p>
                <p className="mt-0.5 text-sm text-ink-3">{b}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 09 Security

export function Security() {
  const controls = [
    [KeyRound, "Step-up authentication", "Moving money, changing payment details and signing closing documents require a fresh second factor."],
    [Users, "Dual control", "A second authorized person approves transfers and verifies payment instructions — never the person who entered them."],
    [CalendarClock, "Cooling-off on changes", "Changed payout details enter a waiting period, and every party is alerted to verify by phone."],
    [FileLock2, "Encryption & least privilege", "Tokens and account numbers are encrypted at rest; row-level security isolates every transaction and organization."],
    [ScrollText, "Append-only audit trail", "Who did what, when and from where — enforced in the database, exportable for auditors."],
    [Scale, "Humans decide compliance", "Automated checks flag; qualified people decide. AI never approves KYC, AML or funds."],
  ] as const;
  return (
    <section id="security" className="scroll-mt-24 bg-navy-900 py-20 text-white" aria-labelledby="security-title">
      <div className="container-page">
        <div className="max-w-2xl">
          <p className="eyebrow mb-3 text-teal-300">Security</p>
          <h2 id="security-title" className="text-[34px] leading-[1.1] sm:text-[42px]">
            Built for the most targeted moment in a home purchase
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-white/75">
            Closing fraud targets the day money moves. Sagolik Close treats every payment instruction as a protected, versioned object — not editable text in an email.
          </p>
        </div>
        <ul className="mt-12 grid gap-px overflow-hidden rounded-xl bg-white/10 md:grid-cols-2 lg:grid-cols-3">
          {controls.map(([Icon, t, b]) => (
            <li key={t} className="bg-navy-900 p-6">
              <Icon className="h-5 w-5 text-teal-300" strokeWidth={1.6} aria-hidden />
              <h3 className="mt-3 font-sans text-[15px] font-semibold">{t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-white/70">{b}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 10–12 Escrow, signatures, vault

export function EscrowSignaturesVault() {
  const blocks = [
    {
      icon: Landmark,
      eyebrow: "Escrow",
      title: "Orchestration, not custody",
      body: "Your licensed escrow or title partner holds the funds. Sagolik Close shows the required amount, what's received, what's outstanding, the conditions and the expected release — and records settlement only when the provider confirms it.",
    },
    {
      icon: PenLine,
      eyebrow: "Electronic signatures",
      title: "Sign once, keep forever",
      body: "Signature requests go to the right people in the right order. The signed copy and the provider's completion certificate are stored as a new, immutable version — the original is never overwritten.",
    },
    {
      icon: FolderLock,
      eyebrow: "Document vault",
      title: "Every version, every hash",
      body: "Uploads are scanned, type-checked and hashed before storage. Access follows each document's classification, every view is audited, and extracted details stay suggestions until a person confirms them.",
    },
  ];
  return (
    <section className="py-20" aria-label="Escrow, signatures and documents">
      <div className="container-page grid gap-6 lg:grid-cols-3">
        {blocks.map(({ icon: Icon, eyebrow, title, body }) => (
          <article key={eyebrow} className="rounded-xl border border-line bg-paper p-7">
            <Icon className="h-6 w-6 text-teal-600" strokeWidth={1.5} aria-hidden />
            <p className="eyebrow mt-5">{eyebrow}</p>
            <h3 className="mt-2 text-[26px] leading-tight text-navy-800">{title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-ink-2">{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 13 Ownership transfer

export function Ownership() {
  return (
    <section className="border-t border-line bg-paper py-20" aria-labelledby="ownership-title">
      <div className="container-page grid items-center gap-12 lg:grid-cols-2">
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl">
          <Image src="/images/scenes/ownership.jpg" alt="A modern home with a pool at dusk" fill sizes="(min-width: 1024px) 560px, 100vw" className="object-cover" />
          <div className="absolute bottom-4 left-4 flex items-center gap-3 rounded-lg bg-paper/95 px-4 py-3 shadow-[var(--shadow-float)]">
            <BadgeCheck className="h-6 w-6 text-success" aria-hidden />
            <div className="text-sm">
              <p className="font-semibold text-ink">Ownership recorded</p>
              <p className="text-[12px] text-ink-3">Registry reference confirmed</p>
            </div>
          </div>
        </div>
        <div>
          <SectionHeading eyebrow="Ownership transfer" title="Never “transferred” because someone clicked a button" id="ownership-title">
            Ownership is marked transferred only after the deed is recorded — confirmed by a registry integration or by the authorized professional, with the recording reference. Then your permanent Home Record begins: signed documents, mortgage, insurance, warranties, renovations and receipts.
          </SectionHeading>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- Brighter tomorrow band

export function BrighterTomorrow() {
  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="tomorrow-title">
      <Image src="/images/scenes/brighter-tomorrow.jpg" alt="" fill sizes="100vw" className="-z-10 object-cover" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-navy-950/90 via-navy-900/70 to-navy-900/10" />
      <div className="container-page grid gap-10 py-20 lg:grid-cols-2">
        <div className="text-white">
          <p className="eyebrow text-teal-300">Real people. Real progress.</p>
          <h2 id="tomorrow-title" className="mt-3 text-[38px] leading-[1.08] sm:text-[46px]">
            More than a transaction.
            <br />A brighter tomorrow.
          </h2>
          <p className="mt-5 max-w-md text-white/80">Sagolik Close gives you the clarity, security and support to move forward with what matters most.</p>
        </div>
        <div className="flex items-center lg:justify-end">
          <div className="flex items-center gap-4 rounded-xl bg-paper/95 p-5 shadow-[var(--shadow-float)]">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-success text-white">
              <Check className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="font-semibold text-ink">Closing complete</p>
              <p className="text-sm text-ink-3">Ownership transferred · Home Record created</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- Parties

export function Parties() {
  const parties = [
    [Home, "Buyers", "A simpler, clearer path to homeownership."],
    [UserRound, "Agents", "Keep clients informed and deals on track."],
    [Landmark, "Lenders", "Faster documentation and smoother coordination."],
    [ScrollText, "Title & Escrow", "Structured workflows and verified instructions."],
  ] as const;
  return (
    <section className="py-20" aria-labelledby="parties-title">
      <div className="container-page">
        <SectionHeading title="Designed for Every Party in the Transaction" align="center" id="parties-title">
          Different roles. A better closing experience for all — with each party seeing exactly what they should.
        </SectionHeading>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {parties.map(([Icon, t, b]) => (
            <li key={t} className="rounded-xl border border-line bg-paper p-6">
              <Icon className="h-6 w-6 text-navy-800" strokeWidth={1.5} aria-hidden />
              <h3 className="mt-4 font-sans text-[15px] font-semibold text-ink">{t}</h3>
              <p className="mt-1.5 text-sm text-ink-3">{b}</p>
            </li>
          ))}
        </ul>
        <ul className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["One workspace", "for every party and every document"],
            ["Every step audited", "append-only, exportable history"],
            ["No passwords shared", "bank consent happens at your bank"],
            ["People decide", "compliance and money never run on autopilot"],
          ].map(([a, b]) => (
            <li key={a} className="bg-paper p-6">
              <p className="font-display text-[22px] text-navy-800">{a}</p>
              <p className="mt-1 text-sm text-ink-3">{b}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 14 Integrations

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
    <section id="resources" className="scroll-mt-24 border-t border-line bg-paper py-20" aria-labelledby="integrations-title">
      <div className="container-page grid gap-12 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <SectionHeading eyebrow="API & integration ecosystem" title="Provider-agnostic by design" id="integrations-title">
            Every regulated function sits behind a typed adapter, so each market can use the providers that are licensed there. A versioned REST API and signed webhooks let partner systems — and, with the same permissions as people, AI agents — work with Sagolik Close.
          </SectionHeading>
          <p className="mt-4 text-[12px] text-ink-3">Names are examples of compatible provider categories, not announced partnerships. Availability varies by market.</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.map(([t, b]) => (
            <li key={t} className="rounded-lg border border-line p-4">
              <p className="text-sm font-semibold text-ink">{t}</p>
              <p className="mt-1 text-[13px] text-ink-3">{b}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 15 Testimonials (placeholders)

export function Testimonials() {
  return (
    <section className="py-20" aria-labelledby="stories-title">
      <div className="container-page">
        <SectionHeading eyebrow="Customer stories" title="Real results, when they're real" id="stories-title">
          We publish customer stories and metrics only after they happen. Our pilot program is open to agencies, title companies and lenders.
        </SectionHeading>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {["Agency pilot", "Title & escrow pilot", "Lender pilot"].map((t) => (
            <div key={t} className="rounded-xl border-2 border-dashed border-line-strong bg-paper/60 p-6">
              <p className="eyebrow">Placeholder</p>
              <p className="mt-2 font-display text-xl text-navy-800">{t}</p>
              <p className="mt-2 text-sm text-ink-3">This space is reserved for a verified customer story.</p>
              <Link href="/contact" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-teal-700">
                Join the pilot <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 16 Pricing

export interface PlanView {
  key: string;
  name: string;
  audience: string;
  features: string[];
}

export function Pricing({ plans }: { plans: PlanView[] }) {
  return (
    <section id="pricing" className="scroll-mt-24 border-t border-line bg-paper py-20" aria-labelledby="pricing-title">
      <div className="container-page">
        <SectionHeading eyebrow="Pricing" title="Plans for every side of the table" align="center" id="pricing-title">
          Pricing is set per market and volume. Buyers and sellers invited by a professional never pay to use Sagolik Close.
        </SectionHeading>
        <ul className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => (
            <li key={p.key} className={`flex flex-col rounded-xl border p-6 ${p.key === "professional" ? "border-navy-800 ring-1 ring-navy-800" : "border-line"}`}>
              <p className="eyebrow">{p.audience}</p>
              <h3 className="mt-2 text-[28px] text-navy-800">{p.name}</h3>
              <p className="mt-1 text-sm text-ink-3">{p.key === "consumer" ? "Included" : "Talk to us"}</p>
              <ul className="mt-5 flex-1 space-y-2 text-sm text-ink-2">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              <Link href={p.key === "consumer" ? "/sign-in" : "/contact"} className={buttonClasses(p.key === "professional" ? "primary" : "secondary", "md", "mt-6 w-full")}>
                {p.key === "consumer" ? "Sign in" : "Contact sales"}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 17 FAQ

export function Faq() {
  const qa = [
    ["Does Sagolik Close hold my money?", "No. Funds are held by the licensed escrow, title or trust-account provider on your transaction. Sagolik Close coordinates the instructions, approvals and status, and records settlement only when that provider confirms it."],
    ["Will you ever ask for my online-banking password?", "Never. Bank connections happen on your bank's own consent page through a regulated open-banking provider. If anyone asks for your banking password in our name, it's fraud."],
    ["What if payment instructions change?", "Any change creates a new version that must be independently verified by a second person, triggers a security notice to every party and enters a waiting period before it can be used. Always confirm by phone using a number you already know."],
    ["Is my identity document stored by Sagolik Close?", "Identity checks are performed by a specialist provider. We store the minimum result needed — for example “verified” and which checks passed — not your ID images, unless a jurisdiction requires it."],
    ["Does the AI assistant make decisions?", "No. The assistant explains your transaction using the same structured data you see. It cannot move money, change bank details, approve checks, sign or transfer ownership."],
    ["Which markets are supported?", "Our workflow engine models each jurisdiction separately — Texas first, with California, Sweden, Poland, Germany, Liechtenstein and Switzerland in progress. We don't pretend one workflow fits every market."],
  ];
  return (
    <section className="py-20" aria-labelledby="faq-title">
      <div className="container-page grid gap-10 lg:grid-cols-[1fr_1.6fr]">
        <SectionHeading eyebrow="FAQ" title="Questions, answered plainly" id="faq-title" />
        <div className="divide-y divide-line rounded-xl border border-line bg-paper">
          {qa.map(([q, a]) => (
            <details key={q} className="group px-6 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-ink [&::-webkit-details-marker]:hidden">
                {q}
                <span aria-hidden className="text-xl leading-none text-ink-3 transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-ink-2">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 18 CTA

export function FinalCta() {
  return (
    <section className="relative isolate overflow-hidden border-t border-line" aria-labelledby="cta-title">
      <Image src="/images/scenes/horizon.jpg" alt="" fill sizes="100vw" className="-z-10 object-cover opacity-30" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-canvas/80 to-canvas/95" />
      <div className="container-page flex flex-col items-start justify-between gap-8 py-16 md:flex-row md:items-center">
        <div>
          <p className="eyebrow text-teal-700">Same people. A brighter tomorrow.</p>
          <h2 id="cta-title" className="mt-2 text-[38px] text-navy-800 sm:text-[44px]">
            Close with confidence.
          </h2>
          <p className="mt-2 max-w-lg text-ink-2">Sagolik Close helps turn complex transactions into a clear path to ownership.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/contact?topic=access" className={buttonClasses("primary", "lg")}>
            Request Access <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link href="/contact?topic=sales" className={buttonClasses("secondary", "lg")}>
            Talk to Sales
          </Link>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- 19 Footer

export function SiteFooter() {
  const cols = [
    ["Platform", [["How it works", "/#how-it-works"], ["Features", "/#platform"], ["Security", "/#security"], ["Pricing", "/#pricing"]]],
    ["Get started", [["Sign in", "/sign-in"], ["Start closing", "/sign-in?intent=start"], ["Book a demo", "/contact"]]],
    ["Legal", [["Privacy", "/legal/privacy"], ["Terms", "/legal/terms"], ["Compliance boundaries", "/legal/compliance"]]],
  ] as const;
  return (
    <footer className="border-t border-line bg-paper">
      <div className="container-page grid gap-10 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo className="h-9 w-auto" />
          <p className="mt-4 max-w-xs text-sm text-ink-3">Sagolik Close — the orchestration layer from decision to ownership. Part of Sagolik: Software That Works For People.</p>
        </div>
        {cols.map(([title, links]) => (
          <nav key={title} aria-label={title}>
            <p className="text-sm font-semibold text-ink">{title}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {links.map(([label, href]) => (
                <li key={label}>
                  <Link href={href} className="text-ink-3 hover:text-navy-800">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="container-page flex flex-wrap items-center justify-between gap-3 py-5 text-[12px] text-ink-3">
          <p>© {new Date().getFullYear()} Sagolik. All rights reserved.</p>
          <p className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> A brighter tomorrow starts here.
          </p>
        </div>
      </div>
    </footer>
  );
}

