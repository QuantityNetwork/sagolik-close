import { ESCROW_LABELS, kindLabel, PAY_METHOD_LABELS } from "@sagolik/core";
import { AMOUNT_TYPES, ESCROW_STATUSES_AUTOPILOT, type Obligation, OBLIGATION_FREQUENCIES, OBLIGATION_KINDS, OBLIGATION_PRIORITIES, PAY_METHODS } from "@sagolik/types";
import { Card, CardBody, CardHeader, Field, Input, Select, StatusBadge } from "@sagolik/ui";
import type { Metadata } from "next";
import { addObligationAction, confirmObligationAction, updateObligationAction } from "@/app/actions/autopilot";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { money, shortDate } from "@/components/app/autopilot";
import { loadPassport } from "@/lib/server/autopilot";

export const metadata: Metadata = { title: "Costs — Property Autopilot" };

const FREQ: Record<Obligation["frequency"], string> = { monthly: "Monthly", quarterly: "Quarterly", semiannual: "Twice a year", annual: "Yearly", once: "Once", irregular: "Irregular" };
const AMOUNT_TYPE: Record<Obligation["amountType"], string> = { fixed: "Fixed", variable: "Varies", periodic: "Periodic", event: "When it comes up (e.g. renewal)", manual: "One-off" };
const PRIORITY: Record<Obligation["priority"], string> = { critical: "Critical", important: "Important", optional: "Optional" };
const SOURCE: Record<Obligation["source"], string> = { closing: "from your closing", document: "from your documents", bank_history: "from your bank history", manual: "added by you", demo: "demo data" };
const STATUS = { suggested: { label: "To confirm", tone: "attention" }, active: { label: "Monitored", tone: "done" }, paused: { label: "Paused", tone: "stopped" }, ended: { label: "Ended", tone: "stopped" } } as const;

const cents = (v: number | null) => (v === null ? "" : (v / 100).toFixed(2));

function amountText(o: Obligation, cur: string) {
  if (o.expectedMin !== null && o.expectedMax !== null) return `${money(o.expectedMin, cur)}–${money(o.expectedMax, cur)}`;
  if (o.expectedAmount !== null) return money(o.expectedAmount, cur);
  return "Amount not known yet";
}

/** All fields, prefilled: an edit replaces the whole cost. */
function CostFields({ o, prefix, accounts }: { o?: Obligation; prefix: string; accounts: Array<{ id: string; label: string }> }) {
  const f = (k: string) => `${prefix}-${k}`;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {o ? null : (
        <Field label="Type" htmlFor={f("kind")}>
          <Select id={f("kind")} name="kind" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {OBLIGATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Name" htmlFor={f("label")}>
        <Input id={f("label")} name="label" required minLength={2} maxLength={120} defaultValue={o?.label} placeholder="e.g. Electricity" />
      </Field>
      <Field label="Paid to (optional)" htmlFor={f("vendorName")}>
        <Input id={f("vendorName")} name="vendorName" maxLength={120} placeholder="e.g. Coastal Power & Light" />
      </Field>
      <Field label="Priority" htmlFor={f("priority")}>
        <Select id={f("priority")} name="priority" defaultValue={o?.priority ?? "critical"}>
          {OBLIGATION_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY[p]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Amount" htmlFor={f("amountType")}>
        <Select id={f("amountType")} name="amountType" defaultValue={o?.amountType ?? "fixed"}>
          {AMOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {AMOUNT_TYPE[t]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Usual amount" htmlFor={f("expectedAmount")} hint="For fixed costs, the exact amount.">
        <Input id={f("expectedAmount")} name="expectedAmount" inputMode="decimal" defaultValue={cents(o?.expectedAmount ?? null)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Low end" htmlFor={f("expectedMin")}>
          <Input id={f("expectedMin")} name="expectedMin" inputMode="decimal" defaultValue={cents(o?.expectedMin ?? null)} />
        </Field>
        <Field label="High end" htmlFor={f("expectedMax")}>
          <Input id={f("expectedMax")} name="expectedMax" inputMode="decimal" defaultValue={cents(o?.expectedMax ?? null)} />
        </Field>
      </div>
      <Field label="How often" htmlFor={f("frequency")}>
        <Select id={f("frequency")} name="frequency" defaultValue={o?.frequency ?? "monthly"}>
          {OBLIGATION_FREQUENCIES.map((q) => (
            <option key={q} value={q}>
              {FREQ[q]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Next due" htmlFor={f("nextDueOn")}>
        <Input id={f("nextDueOn")} name="nextDueOn" type="date" defaultValue={o?.nextDueOn ?? ""} />
      </Field>
      <Field label="Grace period (days)" htmlFor={f("graceDays")}>
        <Input id={f("graceDays")} name="graceDays" type="number" min={0} max={90} defaultValue={o?.graceDays ?? 0} />
      </Field>
      <Field label="Paid by" htmlFor={f("payMethod")} hint="How it's paid today. Sagolik never pays.">
        <Select id={f("payMethod")} name="payMethod" defaultValue={o?.payMethod ?? "autopay"}>
          {PAY_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAY_METHOD_LABELS[m]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Mortgage escrow" htmlFor={f("escrowStatus")} hint="For property tax and insurance.">
        <Select id={f("escrowStatus")} name="escrowStatus" defaultValue={o?.escrowStatus ?? "not_applicable"}>
          {ESCROW_STATUSES_AUTOPILOT.map((e) => (
            <option key={e} value={e}>
              {e === "not_applicable" ? "Not applicable" : ESCROW_LABELS[e]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Paid from account" htmlFor={f("fundingAccountId")} hint="Leave empty to use the property's paying account.">
        <Select id={f("fundingAccountId")} name="fundingAccountId" defaultValue={o?.fundingAccountId ?? ""}>
          <option value="">Property's paying account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
          {o?.fundingAccountId && !accounts.some((a) => a.id === o.fundingAccountId) ? <option value={o.fundingAccountId}>Current account</option> : null}
        </Select>
      </Field>
      <Field label="Account number, last 4 (optional)" htmlFor={f("referenceLast4")}>
        <Input id={f("referenceLast4")} name="referenceLast4" maxLength={4} pattern="[0-9A-Za-z]{2,4}" defaultValue={o?.referenceLast4 ?? ""} />
      </Field>
    </div>
  );
}

export default async function CostsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadPassport(id);
  const cur = view.property?.currency ?? "USD";
  const vendorName = (vid: string | null) => view.vendors.find((v) => v.id === vid)?.name;
  const groups = OBLIGATION_PRIORITIES.map((p) => ({ priority: p, items: view.obligations.filter((o) => o.priority === p && o.status !== "ended") })).filter((g) => g.items.length);
  const ended = view.obligations.filter((o) => o.status === "ended");
  const suggested = view.obligations.filter((o) => o.status === "suggested");

  return (
    <div className="space-y-6">
      {suggested.length ? (
        <Card className="border-attention/20">
          <CardHeader title={`${suggested.length} ${suggested.length === 1 ? "cost" : "costs"} to confirm`} description="Found from your closing, documents or bank history. Sagolik doesn't monitor a cost until you confirm it's right." />
        </Card>
      ) : null}

      {groups.map((g) => (
        <Card key={g.priority}>
          <CardHeader title={PRIORITY[g.priority]} />
          <ul>
            {g.items.map((o) => (
              <li key={o.id} className="border-b border-line px-5 py-4 last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {o.label}
                      {vendorName(o.vendorId) ? <span className="font-normal text-ink-3"> · {vendorName(o.vendorId)}</span> : null}
                    </p>
                    <p className="text-[12.5px] text-ink-2">
                      <span className="num">{amountText(o, cur)}</span> · {FREQ[o.frequency]} · {o.nextDueOn ? `next ${shortDate(o.nextDueOn)}` : "next due date not set"} · {PAY_METHOD_LABELS[o.payMethod]}
                      {o.escrowStatus !== "not_applicable" ? ` · ${ESCROW_LABELS[o.escrowStatus]}` : ""}
                    </p>
                    {o.status === "suggested" ? <p className="text-[12px] text-ink-3">Suggested {SOURCE[o.source]}{o.source === "closing" && o.kind === "mortgage" ? "; the amount is estimated from your loan terms" : ""}.</p> : null}
                  </div>
                  <StatusBadge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</StatusBadge>
                </div>
                {view.canManage ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {o.status === "suggested" ? (
                      <ActionButton action={confirmObligationAction} fields={{ obligationId: o.id, status: "active" }} variant="primary">
                        Confirm
                      </ActionButton>
                    ) : null}
                    {o.status === "active" ? (
                      <ActionButton action={confirmObligationAction} fields={{ obligationId: o.id, status: "paused" }} variant="ghost">
                        Pause monitoring
                      </ActionButton>
                    ) : null}
                    {o.status === "paused" ? (
                      <ActionButton action={confirmObligationAction} fields={{ obligationId: o.id, status: "active" }} variant="ghost">
                        Resume
                      </ActionButton>
                    ) : null}
                    <ActionButton action={confirmObligationAction} fields={{ obligationId: o.id, status: "ended" }} variant="ghost" confirm={`End "${o.label}"? Its history stays; a new bill for it will be flagged.`}>
                      End
                    </ActionButton>
                    <details className="w-full">
                      <summary className="cursor-pointer text-[12.5px] text-navy-800 underline">{o.status === "suggested" ? "Correct the details" : "Edit"}</summary>
                      <ActionForm action={updateObligationAction} className="mt-3 space-y-3">
                        <input type="hidden" name="obligationId" value={o.id} />
                        {o.status === "suggested" ? <input type="hidden" name="status" value="active" /> : null}
                        <CostFields o={o} prefix={o.id} accounts={view.myAccounts} />
                        <SubmitButton variant="secondary" size="sm">
                          {o.status === "suggested" ? "Save and confirm" : "Save"}
                        </SubmitButton>
                      </ActionForm>
                    </details>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ))}

      {view.canManage ? (
        <Card>
          <CardHeader title="Add a cost" description="Anything that must be paid to keep the property running: a service, a fee, a contract." />
          <CardBody>
            <ActionForm action={addObligationAction} className="space-y-3" resetOnSuccess>
              <input type="hidden" name="passportId" value={id} />
              <CostFields prefix="new" accounts={view.myAccounts} />
              <SubmitButton>Add cost</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      {ended.length ? (
        <Card>
          <CardHeader title="Ended" description="Kept as history." />
          <ul>
            {ended.map((o) => (
              <li key={o.id} className="border-b border-line px-5 py-3 text-[13.5px] text-ink-3 last:border-b-0">
                {o.label} · ended {o.endedOn ? shortDate(o.endedOn) : ""}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
