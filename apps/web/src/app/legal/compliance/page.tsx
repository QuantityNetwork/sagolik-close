import type { Metadata } from "next";

export const metadata: Metadata = { title: "Compliance boundaries" };

const ROWS = [
  ["Holding funds", "Never. Escrow and closing funds are held by the licensed escrow or title company.", "Shows status reported by that provider's signed webhooks."],
  ["Payment instructions", "Never accepted by email or chat.", "Versioned instructions with cooling-off, dual approval and step-up confirmation."],
  ["Identity & AML decisions", "Never automated by AI.", "Provider results plus a named human reviewer for any exception."],
  ["Signatures", "Never applied on a user's behalf.", "Hand-off to a certified e-signature provider; signed copies are hashed and stored."],
  ["Title & recording", "Never marked complete by a button.", "Ownership is recorded only from a registry confirmation reference."],
  ["Advice", "No legal, tax or lending advice.", "Plain-language explanations and pointers to the responsible professional."],
] as const;

export default function CompliancePage() {
  return (
    <>
      <h1>Compliance boundaries</h1>
      <p>Closing a property involves regulated activity. Sagolik Close is designed so the regulated decisions stay with the regulated parties, and every step is traceable.</p>
      <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-paper">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-canvas text-[12px] uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-4 py-3">Area</th>
              <th className="px-4 py-3">Sagolik Close does not</th>
              <th className="px-4 py-3">Instead</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([a, no, yes]) => (
              <tr key={a} className="border-t border-line align-top">
                <td className="px-4 py-3 font-medium text-ink">{a}</td>
                <td className="px-4 py-3 text-ink-2">{no}</td>
                <td className="px-4 py-3 text-ink-2">{yes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Jurisdictions</h2>
      <p>Rules differ by market (for example Texas, California, Sweden, Poland, Germany, Liechtenstein and Switzerland). The jurisdiction engine selects required steps and documents per market; local counsel review is required before operating in each market.</p>
      <h2>Audit</h2>
      <p>Every state change, approval, payment status and document version is written to an append-only audit log that organization administrators can export.</p>
    </>
  );
}
