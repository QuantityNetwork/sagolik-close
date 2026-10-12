/**
 * Product illustration for the landing page, rendered in HTML so it stays
 * crisp and accessible. It depicts the fictional demo transaction. Inside an
 * exhibit (a [data-reveal] block) its panels settle in one after another.
 */
import { ParticipantAvatar, ProductIcon, type ProductIconName, ProgressStepper } from "@sagolik/ui";
import Image from "next/image";
import { stagger } from "@/lib/motion";
import { Mark } from "../brand";

const SIDEBAR: Array<{ icon: ProductIconName; label: string; active?: boolean }> = [
  { icon: "dashboard", label: "Dashboard", active: true },
  { icon: "transactions", label: "Transactions" },
  { icon: "documents", label: "Documents" },
  { icon: "signatures", label: "Signatures" },
  { icon: "identity", label: "Identity" },
  { icon: "messages", label: "Messages" },
  { icon: "tasks", label: "Tasks" },
  { icon: "settings", label: "Settings" },
];

const STAGES = ["Started", "Docs", "Identity", "Finance", "Signing", "Escrow", "Transfer", "Closed"];

const CHECKLIST: Array<[string, string, boolean]> = [
  ["Purchase agreement", "Signed", true],
  ["Identity verification", "Verified", true],
  ["Clear to Close", "Issued", true],
  ["Closing Disclosure", "Awaiting signature", false],
  ["Funds to escrow", "Pending", false],
];

export function HeroMockup() {
  return (
    <div aria-label="Illustration of the Sagolik Close transaction dashboard" role="img" className="overflow-hidden rounded-card border border-line bg-paper shadow-[var(--shadow-float)]">
      <div className="flex">
        <aside className="hidden w-40 shrink-0 flex-col bg-navy-900 px-3 py-4 text-white/75 sm:flex">
          <div className="mb-6 flex items-center gap-2 px-1">
            <Mark variant="light" size={20} />
            <span className="font-display text-[14px] text-white">Sagolik Close</span>
          </div>
          <ul className="space-y-0.5 text-[11.5px]">
            {SIDEBAR.map(({ icon, label, active }) => (
              <li key={label} className={`flex items-center gap-2 border-l-2 px-2 py-1.5 ${active ? "border-brass-300 bg-white/8 text-white" : "border-transparent"}`}>
                <ProductIcon name={icon} tone="mono" size={13} className={active ? "" : "opacity-70"} />
                {label}
              </li>
            ))}
          </ul>
        </aside>
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3 border-b border-line pb-4">
            <div>
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-brass-700">Purchase · Austin, TX</p>
              <p className="mt-1 font-display text-[19px] leading-tight text-navy-900">1234 Maple Ridge Drive</p>
              <p className="text-[11px] text-ink-3">Closing in 6 days</p>
            </div>
            <div className="flex items-center gap-2">
              <ParticipantAvatar name="Olivia Carter" size={28} />
              <div className="hidden text-[11px] leading-tight md:block">
                <p className="font-medium text-ink">Olivia Carter</p>
                <p className="text-ink-3">Buyer</p>
              </div>
            </div>
          </div>
          <ProgressStepper className="mt-4" steps={STAGES.map((s, i) => ({ key: s, label: s, state: i < 4 ? "complete" : i === 4 ? "current" : "upcoming" }))} />
          <div className="mt-5 grid gap-3 md:grid-cols-5">
            <div className="follow rounded-sm border border-line p-3 md:col-span-3" style={stagger(0, 250)}>
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-semibold text-ink">Transaction progress</p>
                <p className="text-[10.5px] text-ink-3 num">4 of 8 stages</p>
              </div>
              <ul className="mt-2.5 divide-y divide-line text-[11.5px]">
                {CHECKLIST.map(([label, status, done]) => (
                  <li key={label} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="flex items-center gap-2 text-ink-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${done ? "bg-navy-800" : "border border-ink-4"}`} aria-hidden />
                      {label}
                    </span>
                    <span className={done ? "text-success" : "text-ink-3"}>{status}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="follow overflow-hidden rounded-sm border border-line md:col-span-2" style={stagger(1, 250)}>
              <Image src="/images/homes/maple-ridge.jpg" alt="" width={600} height={400} className="h-24 w-full object-cover saturate-[0.85]" />
              <div className="p-3 text-[11px]">
                <p className="font-semibold text-ink">Single-family home</p>
                <p className="mt-0.5 text-ink-3">4 beds · 3 baths · 2,643 sq ft</p>
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {[
              ["Escrow", "Instructions verified · Deposit received", "On track"],
              ["Identity", "Buyer and seller", "Verified"],
              ["Ownership", "Recorded after registry confirmation", null],
            ].map(([title, body, status], i) => (
              <div key={title} className="follow rounded-sm border border-line p-3" style={stagger(i + 2, 250)}>
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-ink-3">{title}</p>
                <p className="mt-1.5 text-[11px] leading-snug text-ink-2">{body}</p>
                {status ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" /> {status}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
