import { getJurisdiction } from "@sagolik/workflow";
import { formatDateTime } from "@sagolik/i18n";
import { Alert, buttonClasses, Card, CardBody, CardHeader, DefinitionList, Field, Input, StatusBadge } from "@sagolik/ui";
import { BadgeCheck, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { confirmRecordingAction, submitRecordingAction } from "@/app/actions/transaction";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { loadTx } from "@/lib/server/tx";

import { wording } from "@/lib/wording";
export const metadata: Metadata = { title: "Closing" };


export default async function ClosingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, snapshot: s, view, can, locale, actor } = await loadTx(id);
  const r = s.recording;
  const j = getJurisdiction(s.transaction.jurisdiction);
  const myRoles = s.participants.filter((p) => p.userId === actor.userId).map((p) => p.role);
  const canConfirm = can("recording.confirm") && myRoles.some((role) => j.recording.confirmingRoles.includes(role));
  const record = await ctx.db.ownership_records.findOne({ transactionId: id });
  const w = wording(s.transaction.jurisdiction).closing;
  const business = wording(s.transaction.jurisdiction).business;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        {r?.status === "recorded" ? (
          <Alert tone="done" title="Ownership has transferred">
            {business ? w.done : `${j.recording.registry} confirmed the recording`}{r.recordingReference ? ` (reference ${r.recordingReference})` : ""}.{" "}
            {record && !business ? (
              <Link href={`/app/ownership/${record.id}`} className="font-medium underline">
                Open the Home Record
              </Link>
            ) : null}
          </Alert>
        ) : null}
        <Card>
          <CardHeader title={w.readyTitle} description={w.readyDescription} />
          <CardBody>
            <ul className="space-y-2.5">
              {view.recording.items.map((i) => (
                <li key={i.fact} className="flex items-start gap-2.5 text-sm">
                  {i.value ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> : <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-attention" aria-hidden />}
                  <span>
                    <span className={i.value ? "text-ink-3" : "font-medium text-ink"}>{i.label}</span>
                    <span className="block text-[12.5px] text-ink-3">{i.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader title={w.cardTitle} action={r ? <StatusBadge tone={r.status === "recorded" ? "done" : r.status === "rejected" ? "blocked" : r.status === "not_ready" ? "neutral" : "progress"}>{w.status[r.status]}</StatusBadge> : null} />
          <CardBody className="space-y-4">
            <DefinitionList
              items={[
                { term: w.registryLabel, value: r?.registry ?? j.recording.registry },
                ...(r?.submittedAt ? [{ term: "Submitted", value: formatDateTime(r.submittedAt, locale) }] : []),
                ...(r?.recordedAt ? [{ term: "Recorded", value: formatDateTime(r.recordedAt, locale) }] : []),
                ...(r?.recordingReference ? [{ term: "Reference", value: r.recordingReference }] : []),
                ...(r?.confirmationSource ? [{ term: "Confirmed by", value: r.confirmationSource === "registry_api" ? "Registry integration" : "Authorized professional" }] : []),
              ]}
            />
            {r?.status === "ready_for_recording" && can("recording.submit") ? (
              <ActionButton action={submitRecordingAction} fields={{ transactionId: id }} variant="primary" size="md">
                {w.submit}
              </ActionButton>
            ) : null}
            {r?.status === "submitted_for_recording" && canConfirm ? (
              <ActionForm action={confirmRecordingAction} className="space-y-3 rounded-lg border border-line p-4">
                <input type="hidden" name="transactionId" value={id} />
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  <BadgeCheck className="h-4 w-4 text-teal-600" aria-hidden /> {w.confirm}
                </p>
                <Field label={w.registryLabel} htmlFor="registry">
                  <Input id="registry" name="registry" defaultValue={r.registry} required />
                </Field>
                <Field label={business ? w.referenceLabel : "Recording reference (instrument / document number)"} htmlFor="recordingReference">
                  <Input id="recordingReference" name="recordingReference" required minLength={3} />
                </Field>
                <Field label={business ? "Completed at" : "Recorded at"} htmlFor="recordedAt">
                  <Input id="recordedAt" name="recordedAt" type="datetime-local" required />
                </Field>
                <label className="flex items-start gap-2 text-[13px] text-ink-2">
                  <input type="checkbox" name="attestation" required className="mt-0.5 accent-navy-800" />{business ? "I attest that the ownership transfer is complete and documented as referenced. This is recorded under my name." : `I attest that ${r.registry} has confirmed this recording. This is recorded under my name.`}
                </label>
                <SubmitButton>{business ? "Confirm transfer" : "Confirm recording"}</SubmitButton>
              </ActionForm>
            ) : null}
            {r?.status !== "recorded" ? (
              <p className="text-[12px] text-ink-3">
                {business
                  ? "Ownership is only marked transferred after deal counsel confirms it with a reference — never by a click."
                  : "Ownership is only marked transferred after the registry confirms the recording — never by a click."}
              </p>
            ) : null}
          </CardBody>
        </Card>
        {s.transaction.state === "ownership_transfer" && can("transaction.close") ? (
          <Card>
            <CardHeader title="Close the file" description="Once escrow confirms disbursement, close the transaction from the Overview tab." />
            <CardBody>
              <Link href={`/app/transactions/${id}`} className={buttonClasses("secondary", "sm")}>
                Go to Overview
              </Link>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
