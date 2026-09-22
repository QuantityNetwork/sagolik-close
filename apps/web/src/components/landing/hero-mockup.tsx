/**
 * Static product illustration for the landing page, rendered in HTML so it
 * stays crisp and accessible. It depicts the fictional demo transaction.
 */
import { ParticipantAvatar, ProgressStepper } from "@sagolik/ui";
import { Building2, CheckCircle2, Circle, FileText, Fingerprint, Home, Landmark, LayoutDashboard, ListChecks, MessageSquare, PenLine, Settings, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { Mark } from "../brand";

const SIDEBAR = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: Building2, label: "Transactions" },
  { icon: FileText, label: "Documents" },
  { icon: PenLine, label: "Signatures" },
  { icon: Fingerprint, label: "Identity" },
  { icon: MessageSquare, label: "Messages" },
  { icon: ListChecks, label: "Tasks" },
  { icon: Settings, label: "Settings" },
];

const STAGES = ["Started", "Docs", "Identity", "Finance", "Signing", "Escrow", "Transfer", "Closed"];

export function HeroMockup() {
  return (
    <div aria-label="Illustration of the Sagolik Close transaction dashboard" role="img" className="overflow-hidden rounded-2xl border border-line bg-paper shadow-[var(--shadow-float)]">
      <div className="flex">
        <aside className="hidden w-40 shrink-0 flex-col bg-navy-800 px-3 py-4 text-white/80 sm:flex">
          <div className="mb-5 flex items-center gap-2 px-1">
            <Mark variant="light" size={22} />
            <span className="font-display text-[15px] text-white">Sagolik Close</span>
          </div>
          <ul className="space-y-0.5 text-[11.5px]">
            {SIDEBAR.map(({ icon: Icon, label, active }) => (
              <li key={label} className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${active ? "bg-white/10 text-white" : ""}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </aside>
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-lg text-navy-800">1234 Maple Ridge Drive</p>
              <p className="text-[11px] text-ink-3">Austin, TX 78746 · Purchase · Closing in 6 days</p>
            </div>
            <div className="flex items-center gap-2">
              <ParticipantAvatar name="Olivia Carter" size={28} />
              <div className="hidden text-[11px] leading-tight md:block">
                <p className="font-medium text-ink">Olivia Carter</p>
                <p className="text-ink-3">Buyer</p>
              </div>
            </div>
          </div>
          <ProgressStepper
            className="mt-4"
            steps={STAGES.map((s, i) => ({ key: s, label: s, state: i < 4 ? "complete" : i === 4 ? "current" : "upcoming" }))}
          />
          <div className="mt-5 grid gap-3 md:grid-cols-5">
            <div className="rounded-lg border border-line p-3 md:col-span-3">
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-semibold text-ink">Transaction progress</p>
                <p className="text-[10.5px] text-ink-3">4 of 8 stages</p>
              </div>
              <ul className="mt-2 space-y-1.5 text-[11.5px]">
                {[
                  ["Purchase agreement", "Signed", true],
                  ["Identity verification", "Verified", true],
                  ["Clear to Close", "Issued", true],
                  ["Closing Disclosure", "Awaiting signature", false],
                  ["Funds to escrow", "Pending", false],
                ].map(([label, status, done]) => (
                  <li key={label as string} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-ink-2">
                      {done ? <CheckCircle2 className="h-3.5 w-3.5 text-teal-600" aria-hidden /> : <Circle className="h-3.5 w-3.5 text-ink-4" aria-hidden />}
                      {label}
                    </span>
                    <span className={done ? "text-success" : "text-ink-3"}>{status}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="overflow-hidden rounded-lg border border-line md:col-span-2">
              <Image src="/images/homes/maple-ridge.jpg" alt="" width={600} height={400} className="h-24 w-full object-cover" />
              <div className="p-3 text-[11px]">
                <p className="font-semibold text-ink">Single-family home</p>
                <p className="mt-0.5 text-ink-3">4 beds · 3 baths · 2,643 sq ft</p>
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-line p-3">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                <Landmark className="h-3.5 w-3.5 text-teal-600" aria-hidden /> Escrow
              </p>
              <p className="mt-1 text-[11px] text-ink-3">Instructions verified · Deposit received</p>
              <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> On track
              </p>
            </div>
            <div className="rounded-lg border border-line p-3">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                <ShieldCheck className="h-3.5 w-3.5 text-teal-600" aria-hidden /> Identity
              </p>
              <p className="mt-1 text-[11px] text-ink-3">Buyer and seller</p>
              <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> Verified
              </p>
            </div>
            <div className="rounded-lg border border-line p-3">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                <Home className="h-3.5 w-3.5 text-teal-600" aria-hidden /> Ownership
              </p>
              <p className="mt-1 text-[11px] text-ink-3">Recorded after registry confirmation</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
