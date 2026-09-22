import { listComplianceCases } from "@sagolik/core";
import { formatDateTime } from "@sagolik/i18n";
import { Alert, Card, CardBody, CardHeader, EmptyState, Field, formatMoney, Select, StatusBadge, Textarea } from "@sagolik/ui";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { decideComplianceAction } from "@/app/actions/transaction";
import { ActionForm, SubmitButton } from "@/components/forms";
import { loadTx } from "@/lib/server/tx";

export const metadata: Metadata = { title: "Compliance" };

const TONE = { pending: "attention", review_required: "attention", approved: "done", rejected: "blocked", escalated: "blocked" } as const;

export default async function CompliancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, can, locale, snapshot: s } = await loadTx(id);
  if (!can("compliance.review")) notFound();
  const { cases, declarations } = await listComplianceCases(ctx, id);
  const people = Object.fromEntries(s.participants.map((p) => [p.id, p.displayName]));

  return (
    <div className="space-y-6">
      <Alert tone="info" title="People decide">
        Providers and rules flag cases; qualified reviewers make every KYC, AML, sanctions and source-of-funds decision. Decisions are final, audited and cannot be made by the assistant.
      </Alert>
      {cases.length === 0 ? (
        <Card>
          <EmptyState title="No compliance cases" icon={<ShieldCheck className="h-8 w-8" aria-hidden />} />
        </Card>
      ) : null}
      {cases.map((c) => {
        const declaration = declarations.find((d) => d.complianceCaseId === c.id);
        return (
          <Card key={c.id}>
            <CardHeader
              eyebrow={c.category.replace(/_/g, " ")}
              title={c.participantId ? (people[c.participantId] ?? "Participant") : "Transaction"}
              description={c.reason}
              action={<StatusBadge tone={TONE[c.status]}>{c.status.replace(/_/g, " ")}</StatusBadge>}
            />
            <CardBody className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2 text-sm">
                {declaration ? (
                  <p>
                    Declared: <span className="font-medium">{declaration.sourceType.replace(/_/g, " ")}</span> · <span className="num">{formatMoney(declaration.amount, declaration.currency)}</span>
                    {declaration.description ? <span className="block text-ink-3">“{declaration.description}”</span> : null}
                  </p>
                ) : null}
                {c.riskFlags.length ? <p className="text-attention">Risk flags: {c.riskFlags.join(", ")}</p> : null}
                {c.provider ? <p className="text-ink-3">Source: {c.provider}</p> : null}
                <p className="text-[12px] text-ink-3">Opened {formatDateTime(c.createdAt, locale)}</p>
                {c.decision ? (
                  <p className="rounded-md bg-canvas p-2 text-[13px]">
                    Decision: <span className="font-medium">{c.decision}</span>
                    {c.notes ? ` — ${c.notes}` : ""}
                    {c.decidedAt ? <span className="block text-ink-3">{formatDateTime(c.decidedAt, locale)}</span> : null}
                  </p>
                ) : null}
              </div>
              {c.status === "review_required" || c.status === "pending" || c.status === "escalated" ? (
                <ActionForm action={decideComplianceAction} className="space-y-3">
                  <input type="hidden" name="transactionId" value={id} />
                  <input type="hidden" name="caseId" value={c.id} />
                  <Field label="Decision" htmlFor={`d-${c.id}`}>
                    <Select id={`d-${c.id}`} name="decision" defaultValue="approved">
                      <option value="approved">Approve</option>
                      <option value="rejected">Reject</option>
                      <option value="escalated">Escalate</option>
                    </Select>
                  </Field>
                  <Field label="Reviewer notes (required)" htmlFor={`n-${c.id}`}>
                    <Textarea id={`n-${c.id}`} name="notes" required minLength={3} className="min-h-16" />
                  </Field>
                  <SubmitButton>Record decision</SubmitButton>
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
