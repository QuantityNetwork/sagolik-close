import { MORTGAGE_STATUSES } from "@sagolik/types";
import { Card, CardBody, CardHeader, DefinitionList, EmptyState, Field, formatMoney, Input, ProgressStepper, Select } from "@sagolik/ui";
import { Landmark } from "lucide-react";
import type { Metadata } from "next";
import { addMortgageConditionAction, openMortgageAction, satisfyMortgageConditionAction, updateMortgageAction } from "@/app/actions/transaction";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { loadTx } from "@/lib/server/tx";

export const metadata: Metadata = { title: "Financing" };

const LABEL: Record<(typeof MORTGAGE_STATUSES)[number], string> = {
  not_started: "Not started",
  application: "Application",
  document_collection: "Documents",
  underwriting: "Underwriting",
  conditional_approval: "Conditional approval",
  clear_to_close: "Clear to close",
  funded: "Funded",
};

export default async function MortgagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { snapshot: s, can } = await loadTx(id);
  const m = s.mortgage;
  const lender = can("mortgage.update");
  const financial = can("financial.view");

  if (!m) {
    return (
      <Card>
        {lender ? (
          <>
            <CardHeader title="Open the loan file" description="Lenders can also connect their loan-origination system; status then updates automatically." />
            <CardBody>
              <ActionForm action={openMortgageAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="transactionId" value={id} />
                <Field label="Lender" htmlFor="lenderName">
                  <Input id="lenderName" name="lenderName" required />
                </Field>
                <Field label={`Loan amount (${s.transaction.currency})`} htmlFor="loanAmount">
                  <Input id="loanAmount" name="loanAmount" inputMode="decimal" required />
                </Field>
                <Field label="Loan type" htmlFor="loanType">
                  <Input id="loanType" name="loanType" defaultValue="30-year fixed" required />
                </Field>
                <Field label="Rate (%)" htmlFor="interestRate">
                  <Input id="interestRate" name="interestRate" inputMode="decimal" />
                </Field>
                <div className="sm:col-span-2">
                  <SubmitButton>Open loan file</SubmitButton>
                </div>
              </ActionForm>
            </CardBody>
          </>
        ) : (
          <EmptyState title="No mortgage on this transaction" icon={<Landmark className="h-8 w-8" aria-hidden />}>
            If you're financing, your loan officer will open the loan file here.
          </EmptyState>
        )}
      </Card>
    );
  }

  const idx = MORTGAGE_STATUSES.indexOf(m.status);
  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader title={m.lenderName} description={m.status === "clear_to_close" ? "Clear to Close issued." : m.status === "funded" ? "The loan is funded." : "Your lender is working on your loan."} />
          <CardBody className="space-y-6">
            <div className="overflow-x-auto">
              <ProgressStepper className="min-w-[560px]" steps={MORTGAGE_STATUSES.slice(1).map((st, i) => ({ key: st, label: LABEL[st], state: i + 1 < idx ? "complete" : i + 1 === idx ? (st === "funded" ? "complete" : "current") : "upcoming" }))} />
            </div>
            <DefinitionList
              items={[
                ...(financial ? [{ term: "Loan amount", value: formatMoney(m.loanAmount, m.currency) }] : []),
                { term: "Type", value: m.loanType },
                ...(financial && m.interestRateBps !== null ? [{ term: "Rate", value: `${(m.interestRateBps / 100).toFixed(3)}%` }] : []),
                ...(m.termMonths ? [{ term: "Term", value: `${m.termMonths / 12} years` }] : []),
                ...(financial && m.ltvBps !== null ? [{ term: "Loan-to-value", value: `${(m.ltvBps / 100).toFixed(1)}%` }] : []),
                { term: "Appraisal", value: m.appraisalStatus.replace(/_/g, " ") },
                { term: "Underwriting", value: m.underwritingStatus.replace(/_/g, " ") },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Loan conditions" description="Everything the lender needs before issuing Clear to Close." />
          <CardBody>
            <ul className="space-y-2 text-sm">
              {s.mortgageConditions.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span className={c.satisfied ? "text-ink-3" : "text-ink"}>
                    {c.satisfied ? "✓ " : "○ "}
                    {c.description}
                  </span>
                  {!c.satisfied && lender ? (
                    <ActionButton action={satisfyMortgageConditionAction} fields={{ transactionId: id, conditionId: c.id }}>
                      Satisfied
                    </ActionButton>
                  ) : null}
                </li>
              ))}
              {s.mortgageConditions.length === 0 ? <li className="text-ink-3">No conditions.</li> : null}
            </ul>
            {lender ? (
              <ActionForm action={addMortgageConditionAction} className="mt-3 flex gap-2" resetOnSuccess>
                <input type="hidden" name="transactionId" value={id} />
                <label htmlFor="cond" className="sr-only">
                  New condition
                </label>
                <Input id="cond" name="description" placeholder="Add a loan condition" required minLength={3} />
                <SubmitButton variant="secondary">Add</SubmitButton>
              </ActionForm>
            ) : null}
          </CardBody>
        </Card>
      </div>
      {lender ? (
        <Card className="h-fit">
          <CardHeader title="Update loan status" description="Only the lender can change this. Every change is audited." />
          <CardBody>
            <ActionForm action={updateMortgageAction} className="space-y-3">
              <input type="hidden" name="transactionId" value={id} />
              <Field label="Loan status" htmlFor="status">
                <Select id="status" name="status" defaultValue={m.status}>
                  {MORTGAGE_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {LABEL[st]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Appraisal" htmlFor="appraisalStatus">
                <Select id="appraisalStatus" name="appraisalStatus" defaultValue={m.appraisalStatus}>
                  {["not_ordered", "ordered", "scheduled", "completed", "issue"].map((v) => (
                    <option key={v} value={v}>
                      {v.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Underwriting" htmlFor="underwritingStatus">
                <Select id="underwritingStatus" name="underwritingStatus" defaultValue={m.underwritingStatus}>
                  {["not_started", "in_review", "conditions", "approved", "denied"].map((v) => (
                    <option key={v} value={v}>
                      {v.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Note for the room (optional)" htmlFor="note">
                <Input id="note" name="note" maxLength={500} />
              </Field>
              <SubmitButton>Save</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
