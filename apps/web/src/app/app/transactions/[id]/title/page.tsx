import { TITLE_STATUSES } from "@sagolik/types";
import { Card, CardBody, CardHeader, DefinitionList, EmptyState, Field, formatMoney, Input, Select, StatusBadge } from "@sagolik/ui";
import { formatDate } from "@sagolik/i18n";
import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import { addTitleIssueAction, orderTitleAction, resolveTitleIssueAction, updateTitleAction } from "@/app/actions/transaction";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { loadTx } from "@/lib/server/tx";

import { wording } from "@/lib/wording";
export const metadata: Metadata = { title: "Title & liens" };

const LABEL: Record<(typeof TITLE_STATUSES)[number], string> = { not_started: "Not started", searching: "Searching", issues_found: "Issues found", curing: "Resolving issues", clear: "Clear", insured: "Clear & insured" };
const TONE = { not_started: "neutral", searching: "progress", issues_found: "blocked", curing: "attention", clear: "done", insured: "done" } as const;

export default async function TitlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { snapshot: s, can, locale } = await loadTx(id);
  const t = s.titleCase;
  const officer = can("title.update");
  const w = wording(s.transaction.jurisdiction).title;

  if (!t) {
    return (
      <Card>
        {officer ? (
          <>
            <CardHeader title={w.orderTitle} description={w.orderDescription} />
            <CardBody>
              <ActionForm action={orderTitleAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="transactionId" value={id} />
                <Field label={w.providerLabel} htmlFor="titleCompany" className="min-w-64 flex-1">
                  <Input id="titleCompany" name="titleCompany" required />
                </Field>
                <SubmitButton>{w.start}</SubmitButton>
              </ActionForm>
            </CardBody>
          </>
        ) : (
          <EmptyState title={w.empty} icon={<ScrollText className="h-8 w-8" aria-hidden />}>
            {w.page === "Title" ? "Your title officer will start the search and show progress here." : "Deal counsel will order the search and show findings here."}
          </EmptyState>
        )}
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader title={t.titleCompany} action={<StatusBadge tone={TONE[t.status]}>{LABEL[t.status]}</StatusBadge>} />
          <CardBody>
            <DefinitionList
              items={[
                ...(t.currentOwner ? [{ term: w.ownerLabel, value: t.currentOwner }] : []),
                ...(t.searchCompletedAt ? [{ term: "Search completed", value: formatDate(t.searchCompletedAt, locale) }] : []),
                ...(t.clearedAt ? [{ term: "Cleared", value: formatDate(t.clearedAt, locale) }] : []),
                ...(t.insurancePolicyNumber ? [{ term: "Title insurance policy", value: t.insurancePolicyNumber }] : []),
                ...(t.externalReference ? [{ term: "Reference", value: t.externalReference }] : []),
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={w.issuesTitle} description={w.issuesDescription} />
          <CardBody>
            <ul className="space-y-3 text-sm">
              {s.titleIssues.map((i) => (
                <li key={i.id} className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className={i.resolved ? "text-ink-3 line-through decoration-ink-4" : "font-medium text-ink"}>{i.description}</p>
                    <p className="text-[12px] text-ink-3">
                      {i.kind}
                      {i.amount !== null ? ` · ${formatMoney(i.amount, s.transaction.currency)}` : ""}
                      {i.resolved && i.resolvedAt ? ` · resolved ${formatDate(i.resolvedAt, locale)}` : ""}
                    </p>
                  </div>
                  {!i.resolved && officer ? (
                    <ActionButton action={resolveTitleIssueAction} fields={{ transactionId: id, issueId: i.id }}>
                      Mark resolved
                    </ActionButton>
                  ) : i.resolved ? (
                    <StatusBadge tone="done">Resolved</StatusBadge>
                  ) : (
                    <StatusBadge tone="blocked">Open</StatusBadge>
                  )}
                </li>
              ))}
              {s.titleIssues.length === 0 ? <li className="text-ink-3">No issues found.</li> : null}
            </ul>
          </CardBody>
        </Card>
      </div>
      {officer ? (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Update title status" />
            <CardBody>
              <ActionForm action={updateTitleAction} className="space-y-3">
                <input type="hidden" name="transactionId" value={id} />
                <Field label="Status" htmlFor="status">
                  <Select id="status" name="status" defaultValue={t.status}>
                    {TITLE_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {LABEL[st]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Title insurance policy number" htmlFor="insurancePolicyNumber">
                  <Input id="insurancePolicyNumber" name="insurancePolicyNumber" defaultValue={t.insurancePolicyNumber ?? ""} />
                </Field>
                <SubmitButton>Save</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Record an issue" />
            <CardBody>
              <ActionForm action={addTitleIssueAction} className="space-y-3" resetOnSuccess>
                <input type="hidden" name="transactionId" value={id} />
                <Field label="Kind" htmlFor="kind">
                  <Select id="kind" name="kind" defaultValue="lien">
                    {["lien", "mortgage", "judgment", "easement", "encumbrance", "tax", "other"].map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Description" htmlFor="description">
                  <Input id="description" name="description" required minLength={3} />
                </Field>
                <Field label={`Amount (${s.transaction.currency}, optional)`} htmlFor="amount">
                  <Input id="amount" name="amount" inputMode="decimal" />
                </Field>
                <SubmitButton variant="secondary">Record issue</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
