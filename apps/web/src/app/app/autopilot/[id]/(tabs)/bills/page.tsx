import { BILL_STATUS_LABELS } from "@sagolik/core";
import { Card, CardBody, CardHeader, cn, Field, Input, Select, StatusBadge } from "@sagolik/ui";
import type { Metadata } from "next";
import { addBillAction, billStatusAction, checkBankActivityAction, markBillPaidAction, reviewBillAction } from "@/app/actions/autopilot";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { money, SeverityTag, shortDate } from "@/components/app/autopilot";
import { loadPassport } from "@/lib/server/autopilot";

export const metadata: Metadata = { title: "Bills — Property Autopilot" };

const NEEDS_REVIEW = new Set(["anomaly", "duplicate_risk", "review_required", "two_person_review", "flagged", "verify_escrow"]);
const TONE = { received: "attention", paid_reported: "progress", paid_verified: "done", covered_by_escrow: "done", disputed: "blocked", cancelled: "stopped" } as const;

export default async function BillsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadPassport(id);
  const cur = view.property?.currency ?? "USD";
  const decisionFor = new Map(view.assessment.decisions.filter((d) => d.billId).map((d) => [d.billId!, d]));
  const costs = view.obligations.filter((o) => o.status !== "ended");
  const todayIso = new Date().toISOString().slice(0, 10);
  const bills = view.bills.slice(0, 40);

  return (
    <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
      <Card>
        <CardHeader title="Bills" description="Real bills and statements. Sagolik checks each one against its usual amount, your escrow and your review rules." />
        {bills.length ? (
          <ul>
            {bills.map((b) => {
              const ob = view.obligations.find((o) => o.id === b.obligationId);
              const d = decisionFor.get(b.id);
              const needsReview = b.status === "received" && d && NEEDS_REVIEW.has(d.outcome);
              return (
                <li key={b.id} className="border-b border-line px-5 py-4 last:border-b-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">
                        {ob?.label ?? "Bill"} <span className="num">{money(b.amount, cur)}</span>
                      </p>
                      <p className="text-[12.5px] text-ink-3">
                        Due {shortDate(b.dueOn)}
                        {b.periodLabel ? ` · ${b.periodLabel}` : ""}
                        {b.paidOn ? ` · paid ${shortDate(b.paidOn)}` : ""}
                        {b.paymentReference ? ` · ${b.paymentReference}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {d && d.severity !== "info" ? <SeverityTag severity={d.severity} /> : null}
                      <StatusBadge tone={TONE[b.status]}>{BILL_STATUS_LABELS[b.status]}</StatusBadge>
                    </div>
                  </div>
                  {d && (d.severity !== "info" || b.status === "received") ? (
                    <div className={cn("mt-2 rounded-lg px-3 py-2 text-[13px]", d.severity === "info" ? "bg-canvas text-ink-2" : "bg-attention-50/60 text-ink")}>
                      <p className="font-medium">{d.summary}</p>
                      {d.reasons.map((r) => (
                        <p key={r} className="text-ink-2">
                          {r}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {b.reviewedBy ? (
                    <p className="mt-1 text-[12px] text-ink-3">
                      Reviewed by {view.reviewerNames[b.reviewedBy] ?? "a member"}
                      {b.secondReviewedBy ? ` and ${view.reviewerNames[b.secondReviewedBy] ?? "a second member"}` : ""}
                    </p>
                  ) : null}
                  {view.canManage ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      {needsReview ? (
                        <ActionButton action={reviewBillAction} fields={{ billId: b.id }} variant="primary">
                          {d.outcome === "verify_escrow" ? "I checked: pay it directly" : d.outcome === "two_person_review" && b.reviewedBy ? "Second review" : "Mark reviewed"}
                        </ActionButton>
                      ) : null}
                      {b.status === "received" ? (
                        <>
                          <details className="group">
                            <summary className="cursor-pointer list-none rounded-full border border-line px-3 py-1.5 text-[12.5px] text-ink-2 hover:bg-canvas [&::-webkit-details-marker]:hidden">Mark as paid</summary>
                            <ActionForm action={markBillPaidAction} className="mt-2 flex flex-wrap items-end gap-2">
                              <input type="hidden" name="billId" value={b.id} />
                              <Field label="Paid on" htmlFor={`paid-${b.id}`}>
                                <Input id={`paid-${b.id}`} name="paidOn" type="date" max={todayIso} defaultValue={todayIso} required />
                              </Field>
                              <Field label="Confirmation (optional)" htmlFor={`ref-${b.id}`}>
                                <Input id={`ref-${b.id}`} name="reference" maxLength={120} placeholder="e.g. autopay confirmation" />
                              </Field>
                              <SubmitButton variant="secondary" size="sm">
                                Save
                              </SubmitButton>
                            </ActionForm>
                          </details>
                          <ActionButton action={billStatusAction} fields={{ billId: b.id, status: "disputed" }} variant="ghost">
                            Dispute
                          </ActionButton>
                          {ob && (ob.kind === "property_tax" || ob.kind === "insurance") ? (
                            <ActionButton action={billStatusAction} fields={{ billId: b.id, status: "covered_by_escrow" }} variant="ghost">
                              Paid from escrow
                            </ActionButton>
                          ) : null}
                          <ActionButton action={billStatusAction} fields={{ billId: b.id, status: "cancelled" }} variant="ghost" confirm="Remove this bill? It stays in the activity history.">
                            Remove
                          </ActionButton>
                        </>
                      ) : null}
                      {b.status === "disputed" ? (
                        <ActionButton action={billStatusAction} fields={{ billId: b.id, status: "received" }} variant="ghost">
                          Dispute resolved
                        </ActionButton>
                      ) : null}
                      {b.fileKey ? (
                        <a href={`/api/v1/autopilot/bills/${b.id}/file`} className="rounded-full px-3 py-1.5 text-[12.5px] text-navy-800 underline">
                          View document
                        </a>
                      ) : null}
                    </div>
                  ) : b.fileKey ? (
                    <a href={`/api/v1/autopilot/bills/${b.id}/file`} className="mt-2 inline-block text-[12.5px] text-navy-800 underline">
                      View document
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-ink-3">No bills yet. Add one when it arrives, or upload the PDF.</p>
        )}
      </Card>

      {view.canManage ? (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Confirm payments from your bank" description="Sagolik reads posted transactions on the accounts linked to this property. A bill counts as paid (verified) only with the exact amount, the payee and a plausible date. Read-only: it never moves money, and statements aren't stored." />
            <CardBody>
              <ActionForm action={checkBankActivityAction}>
                <input type="hidden" name="passportId" value={id} />
                <SubmitButton variant="secondary" pendingLabel="Checking…">
                  Check bank activity
                </SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
          <Card className="h-fit">
            <CardHeader title="Add a bill" description="Sagolik checks it immediately. It never pays it." />
            <CardBody>
              {costs.length ? (
                <ActionForm action={addBillAction} className="space-y-3" resetOnSuccess>
                  <input type="hidden" name="passportId" value={id} />
                  <Field label="Cost" htmlFor="obligationId">
                    <Select id="obligationId" name="obligationId" required defaultValue="">
                      <option value="" disabled>
                        Choose…
                      </option>
                      {costs.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                          {o.status === "suggested" ? " (to confirm)" : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Amount" htmlFor="amount">
                      <Input id="amount" name="amount" inputMode="decimal" placeholder="243.81" required />
                    </Field>
                    <Field label="Due date" htmlFor="dueOn">
                      <Input id="dueOn" name="dueOn" type="date" required />
                    </Field>
                  </div>
                  <Field label="Period (optional)" htmlFor="periodLabel">
                    <Input id="periodLabel" name="periodLabel" maxLength={60} placeholder="e.g. April 2027" />
                  </Field>
                  <Field label="Bill PDF or photo (optional)" htmlFor="file" hint="PDF, PNG or JPEG. Stored privately for this portfolio.">
                    <Input id="file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" />
                  </Field>
                  <SubmitButton pendingLabel="Checking…">Add bill</SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-sm text-ink-3">Add the property's costs first (Costs tab).</p>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
