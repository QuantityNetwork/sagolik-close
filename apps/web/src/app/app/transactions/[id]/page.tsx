import { roleLabel, STATE_LABELS } from "@sagolik/core";
import { formatDate } from "@sagolik/i18n";
import { HEALTH_LABEL, healthTone, Card, CardBody, CardHeader, DefinitionList, Field, Input, Select, StatusBadge, Textarea, Timeline, formatMoney } from "@sagolik/ui";
import { checkTransition, DEAL_STRUCTURE_LABELS, TRANSITIONS } from "@sagolik/workflow";

const ENTITY_LABEL = { llc: "LLC", c_corporation: "C corporation", s_corporation: "S corporation", partnership: "Partnership", sole_proprietorship: "Sole proprietorship" } as const;
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ParticipantRole } from "@sagolik/types";
import type { Metadata } from "next";
import { transitionAction, updateClosingDateAction } from "@/app/actions/transaction";
import { Assistant } from "@/components/app/assistant";
import { TaskAction } from "@/components/app/next-step";
import { ActionForm, SubmitButton } from "@/components/forms";
import { loadTx } from "@/lib/server/tx";

export const metadata: Metadata = { title: "Transaction" };

export default async function TransactionOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { snapshot: s, view, can, locale } = await loadTx(id);
  const next = view.nextAction;
  const cur = s.transaction.currency;
  const targets = TRANSITIONS.filter((t) => t.from === s.transaction.state && !t.automatic).map((t) => ({ def: t, check: checkTransition(s, t.to) }));
  const canTransition = targets.some((t) => can(t.def.permission));

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-6">
        {next ? (
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] bg-navy-800 p-5 text-white" aria-label="Your next step">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-300">Your next step</p>
              <p className="mt-1 font-display text-[22px] leading-tight">{next.title}</p>
              {next.estimatedMinutes ? <p className="text-sm text-white/65">About {next.estimatedMinutes} minutes</p> : null}
            </div>
            <TaskAction task={next} transactionId={id} />
          </section>
        ) : null}

        <Card>
          <CardHeader title="Timeline" description="Each milestone has an owner, a deadline, its documents and its tasks." />
          <CardBody>
            <Timeline
              items={view.timeline.map((m) => ({
                key: m.key,
                title: m.label,
                status: m.complete ? "complete" : m.health === "blocked" ? "blocked" : m.health === "needs_attention" ? "attention" : m.current ? "current" : "upcoming",
                detail: m.complete ? null : m.detail,
                meta: (
                  <span className="flex flex-wrap items-center gap-2">
                    {!m.complete ? <StatusBadge tone={healthTone(m.health)}>{HEALTH_LABEL[m.health]}</StatusBadge> : null}
                    {m.owner ? <span>{m.owner.displayName}</span> : m.ownerRole ? <span>{roleLabel(m.ownerRole as ParticipantRole, s.transaction.jurisdiction)}</span> : null}
                    {m.dueDate && !m.complete ? <span className={m.overdue ? "font-medium text-attention" : ""}>Due {formatDate(m.dueDate, locale)}</span> : null}
                  </span>
                ),
                children:
                  m.exceptions.length || (!m.complete && (m.tasks.length || m.documentIds.length)) ? (
                    <div className="mt-2 space-y-1.5">
                      {m.exceptions.map((e) => (
                        <p key={e} className="flex items-start gap-1.5 text-[13px] text-danger">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {e}
                        </p>
                      ))}
                      {!m.complete && (m.tasks.length || m.documentIds.length) ? (
                        <p className="text-[12px] text-ink-3">
                          {m.tasks.filter((t) => t.status !== "complete" && t.status !== "waived").length} open task(s) · {m.documentIds.length} document(s)
                        </p>
                      ) : null}
                    </div>
                  ) : null,
              }))}
            />
          </CardBody>
        </Card>

        <Assistant transactionId={id} title="Ask about this transaction" />
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="What's needed to close" description={view.recording.ready ? "Every requirement is met." : `${view.blockers.length} requirement(s) outstanding`} />
          <CardBody>
            <ul className="space-y-2.5">
              {view.recording.items.map((i) => (
                <li key={i.fact} className="flex items-start gap-2.5 text-sm">
                  {i.value ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> : <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-attention" aria-hidden />}
                  <span>
                    <span className={i.value ? "text-ink-3" : "font-medium text-ink"}>{i.label}</span>
                    {!i.value ? <span className="block text-[12.5px] text-ink-3">{i.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        {s.company ? (
          <Card>
            <CardHeader title="Company" description="Figures are as reported by the seller until due diligence confirms them." />
            <CardBody>
              <DefinitionList
                items={[
                  { term: "Legal name", value: s.company.legalName },
                  { term: "Entity", value: `${ENTITY_LABEL[s.company.entityType]} · ${s.company.stateOfFormation}` },
                  { term: "Deal structure", value: DEAL_STRUCTURE_LABELS[s.company.dealStructure] ?? s.company.dealStructure },
                  { term: "Industry", value: s.company.industry },
                  ...(s.company.employeeCount !== null ? [{ term: "Employees", value: s.company.employeeCount }] : []),
                  ...(can("financial.view") && s.company.annualRevenue !== null ? [{ term: "Annual revenue (seller-reported)", value: formatMoney(s.company.annualRevenue, cur) }] : []),
                  { term: "Premises", value: [s.property.addressLine1, s.property.city, s.property.region].filter(Boolean).join(", ") },
                  ...(can("financial.view") ? [{ term: "Price", value: formatMoney(s.transaction.salePrice, cur) }] : []),
                  { term: "Workflow", value: "US business acquisition (beta)" },
                  { term: "Reference", value: s.transaction.reference },
                ]}
              />
            </CardBody>
          </Card>
        ) : (
        <Card>
          <CardHeader title="Property" />
          <CardBody>
            <DefinitionList
              items={[
                { term: "Type", value: s.property.propertyType.replace(/_/g, " ") },
                ...(s.property.bedrooms ? [{ term: "Bedrooms / baths", value: `${s.property.bedrooms} / ${s.property.bathrooms ?? "—"}` }] : []),
                ...(s.property.livingArea ? [{ term: "Living area", value: `${s.property.livingArea.toLocaleString("en-US")} ${s.property.areaUnit}` }] : []),
                ...(s.property.yearBuilt ? [{ term: "Built", value: s.property.yearBuilt }] : []),
                ...(s.property.parcelId ? [{ term: "Parcel", value: s.property.parcelId }] : []),
                ...(can("financial.view") ? [{ term: "Price", value: formatMoney(s.transaction.salePrice, cur) }] : []),
                { term: "Jurisdiction", value: s.transaction.jurisdiction },
                { term: "Reference", value: s.transaction.reference },
              ]}
            />
          </CardBody>
        </Card>
        )}

        {can("transaction.edit") ? (
          <Card>
            <CardHeader title="Closing date" description="Everyone on the file is notified when it changes." />
            <CardBody>
              <ActionForm action={updateClosingDateAction} className="flex items-end gap-2">
                <input type="hidden" name="transactionId" value={id} />
                <input type="hidden" name="version" value={s.transaction.version} />
                <Field label="Expected closing" htmlFor="expectedClosingDate" className="flex-1">
                  <Input id="expectedClosingDate" name="expectedClosingDate" type="date" defaultValue={s.transaction.expectedClosingDate ?? ""} />
                </Field>
                <SubmitButton variant="secondary">Save</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}

        {canTransition ? (
          <Card>
            <CardHeader title="Move this file" description="Automatic steps happen on their own. Use this for human decisions — pausing a disputed file, cancelling or closing." />
            <CardBody>
              <ActionForm action={transitionAction} className="space-y-3">
                <input type="hidden" name="transactionId" value={id} />
                <input type="hidden" name="version" value={s.transaction.version} />
                <Field label="New stage" htmlFor="to">
                  <Select id="to" name="to" required defaultValue="">
                    <option value="" disabled>
                      Choose…
                    </option>
                    {targets
                      .filter((t) => can(t.def.permission))
                      .map((t) => (
                        <option key={t.def.to} value={t.def.to} disabled={!t.check.allowed}>
                          {STATE_LABELS[t.def.to].label}
                          {!t.check.allowed ? " — requirements not met" : ""}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="Reason (recorded in the audit trail)" htmlFor="reason">
                  <Textarea id="reason" name="reason" required minLength={3} maxLength={500} className="min-h-16" />
                </Field>
                <SubmitButton variant="secondary">Update stage</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
