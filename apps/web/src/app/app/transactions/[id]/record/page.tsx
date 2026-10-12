import { type DealRecordEntryView, dealRecordView, STATE_LABELS } from "@sagolik/core";
import { formatDateTime } from "@sagolik/i18n";
import type { TransactionState } from "@sagolik/types";
import { Card, CardBody, CardHeader, EmptyState, formatMoney, StatusBadge } from "@sagolik/ui";
import { Download, ExternalLink, Fingerprint } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VerifyRecord } from "@/components/app/verify-record";
import { loadTx } from "@/lib/server/tx";

export const metadata: Metadata = { title: "Deal record" };

const STATUS = {
  confirmed: { tone: "done", label: "Recorded" },
  submitted: { tone: "progress", label: "Confirming" },
  queued: { tone: "neutral", label: "Waiting to send" },
  failed: { tone: "blocked", label: "Needs attention" },
} as const;

const human = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const short = (h: unknown) => (typeof h === "string" ? `${h.slice(0, 10)}…${h.slice(-6)}` : "");
const stateLabel = (s: unknown) => STATE_LABELS[s as TransactionState]?.label ?? human(String(s));
const METHODS: Record<string, string> = { out_of_band_call: "a call to a known number", in_person: "in person", provider_attested: "the escrow provider's attestation" };

/** What an entry says, in words. Facts only: the receipts never name people. */
function describe(e: DealRecordEntryView): string {
  const f = e.facts;
  switch (e.kind) {
    case "deal.opened":
      return `${f.reference} · ${human(String(f.type))} · ${f.jurisdiction}`;
    case "milestone.completed":
      return `${stateLabel(f.from)} → ${stateLabel(f.to)}`;
    case "document.version":
      return `${human(String(f.category))}, version ${f.version}${f.signed ? " (signed)" : ""} · SHA-256 ${String(f.sha256).slice(0, 12)}…`;
    case "instruction.verified":
      return `Version ${f.version}, verified by ${METHODS[String(f.method)] ?? "a second person"} · fingerprint ${String(f.fingerprint).slice(0, 12)}…`;
    case "funds.received": {
      const amount = formatMoney(Number(f.amountCents), String(f.currency));
      const source = f.source === "settled_payment" ? "settled payment confirmed by the bank" : "reported by escrow";
      return f.evidenceTxHash ? `${amount} · ${source} · paid in USDC (${short(f.evidenceTxHash)})${f.evidenceFromVerifiedWallet ? " from the buyer's confirmed wallet" : ""}` : `${amount} · ${source}`;
    }
    case "ownership.transferred":
      return `${f.registry} · recording ${f.recordingReference}`;
  }
}

export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, locale } = await loadTx(id);
  const record = await dealRecordView(ctx, id);
  if (!record.enabled && record.entries.length === 0) notFound();
  const network = record.networkLabel ?? "the network";

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <Card>
        <CardHeader title="Deal record" description={`Each key fact of this closing is fingerprinted on ${network}. Newest first.`} />
        <CardBody>
          {record.entries.length ? (
            <ol className="divide-y divide-line">
              {record.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {e.sequence ? <span className="num mr-2 text-[12px] text-brass-700">#{e.sequence}</span> : null}
                      {e.label}
                    </p>
                    <p className="text-[13px] text-ink-2">{describe(e)}</p>
                    <p className="mt-0.5 text-[12px] text-ink-4">
                      {formatDateTime(e.occurredAt, locale)}
                      {e.recordedAt ? ` · recorded ${formatDateTime(e.recordedAt, locale)}` : ""}
                      {e.blockNumber ? ` · block ${e.blockNumber}` : ""} · <span className="font-mono">{short(e.digest)}</span>
                    </p>
                    {e.status === "failed" && e.lastError ? <p className="mt-0.5 text-[12px] text-danger">{e.lastError}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</StatusBadge>
                    {e.txUrl ? (
                      <a href={e.txUrl} target="_blank" rel="noreferrer" className="link-u inline-flex items-center gap-1 text-[12px] text-navy-800">
                        View <ExternalLink className="h-3 w-3" aria-hidden />
                        <span className="sr-only">on the block explorer (opens a new tab)</span>
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="Nothing recorded yet" icon={<Fingerprint className="h-8 w-8" aria-hidden />}>
              Entries appear as the closing moves forward.
            </EmptyState>
          )}
        </CardBody>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Check it yourself" />
          <CardBody className="space-y-4 text-[13px] text-ink-2">
            <p>
              The registry on {network} holds only fingerprints under an anonymous deal id: no names, addresses, amounts or documents. The receipts behind them stay here, visible to the people on this closing.
            </p>
            <p>A fingerprint can&apos;t be changed after it is recorded, and nobody, Sagolik included, can remove one. If a receipt were altered, it would no longer match.</p>
            {record.enabled ? <VerifyRecord transactionId={id} networkLabel={network} /> : null}
            <a href={`/api/v1/transactions/${id}/deal-record`} className="link-u inline-flex items-center gap-1.5 text-navy-800">
              <Download className="h-4 w-4" aria-hidden /> Download the receipts (JSON)
            </a>
            <p className="text-[12px] text-ink-3">The file explains how to recompute each fingerprint and find it on {network} without Sagolik.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="What this is not" />
          <CardBody className="space-y-2 text-[13px] text-ink-2">
            <p>The record never holds or moves money, and it isn&apos;t a land registry: ownership is recorded by the county (or, for a business, by the closing documents).</p>
            {record.registry ? (
              <p className="text-[12px] text-ink-3">
                Registry contract:{" "}
                {record.registryUrl ? (
                  <a href={record.registryUrl} target="_blank" rel="noreferrer" className="link-u font-mono text-navy-800">
                    {short(record.registry)}
                  </a>
                ) : (
                  <span className="font-mono">{short(record.registry)}</span>
                )}
                {record.network === "sandbox" ? " (demo sandbox: not a public network)" : ""}
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
