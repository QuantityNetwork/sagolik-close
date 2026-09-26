import { kindLabel } from "@sagolik/core";
import { OBLIGATION_KINDS, REVIEW_ACTIONS, type ReviewPolicy } from "@sagolik/types";
import { Card, CardBody, CardHeader, Field, Input, Select, StatusBadge } from "@sagolik/ui";
import type { Metadata } from "next";
import { savePolicyAction, setMonitoringAction, updateFundingAction } from "@/app/actions/autopilot";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { money } from "@/components/app/autopilot";
import { loadPassport } from "@/lib/server/autopilot";

export const metadata: Metadata = { title: "Rules & funding — Property Autopilot" };

const ACTION: Record<ReviewPolicy["action"], string> = {
  routine: "Routine: stay quiet",
  owner_review: "Needs a review",
  two_person_review: "Needs two reviewers",
  flag: "Flag as suspicious",
};
const cents = (v: number | null) => (v === null ? "" : (v / 100).toFixed(2));

function PolicyFields({ p, prefix }: { p?: ReviewPolicy; prefix: string }) {
  const f = (k: string) => `${prefix}-${k}`;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Field label="Rule name" htmlFor={f("name")} className="lg:col-span-2">
        <Input id={f("name")} name="name" required minLength={3} maxLength={120} defaultValue={p?.name} />
      </Field>
      <Field label="Applies to" htmlFor={f("kind")}>
        <Select id={f("kind")} name="obligationKind" defaultValue={p?.obligationKind ?? ""}>
          <option value="">Any cost</option>
          {OBLIGATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="From" htmlFor={f("min")}>
        <Input id={f("min")} name="minAmount" inputMode="decimal" defaultValue={cents(p?.minAmount ?? 0)} />
      </Field>
      <Field label="Up to" htmlFor={f("max")} hint="Empty = no limit">
        <Input id={f("max")} name="maxAmount" inputMode="decimal" defaultValue={cents(p?.maxAmount ?? null)} />
      </Field>
      <Field label="Then" htmlFor={f("action")} className="lg:col-span-2">
        <Select id={f("action")} name="action" defaultValue={p?.action ?? "owner_review"}>
          {REVIEW_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION[a]}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

export default async function RulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadPassport(id);
  const cur = view.property?.currency ?? "USD";
  const accounts = [...view.myAccounts];
  for (const a of view.fundingAccounts) if (!accounts.some((x) => x.id === a.id)) accounts.push({ id: a.id, label: `${a.label} •••• ${a.mask}` });
  const monitoring = view.passport.monitoring === "monitor";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Funding" description="Which account pays this property's bills, and how much should stay in it. Sagolik checks balances before bills are due and recommends transfers from the reserve. It never moves money." />
        <CardBody>
          {view.canAdmin ? (
            <ActionForm action={updateFundingAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="passportId" value={id} />
              <Field label="Paying account" htmlFor="operatingAccountId">
                <Select id="operatingAccountId" name="operatingAccountId" defaultValue={view.funding?.operatingAccountId ?? ""}>
                  <option value="">Not chosen</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reserve account" htmlFor="reserveAccountId">
                <Select id="reserveAccountId" name="reserveAccountId" defaultValue={view.funding?.reserveAccountId ?? ""}>
                  <option value="">None</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Minimum balance to keep" htmlFor="minOperatingBalance">
                <Input id="minOperatingBalance" name="minOperatingBalance" inputMode="decimal" defaultValue={cents(view.funding?.minOperatingBalance ?? 0)} />
              </Field>
              <Field label="Target balance" htmlFor="targetOperatingBalance">
                <Input id="targetOperatingBalance" name="targetOperatingBalance" inputMode="decimal" defaultValue={cents(view.funding?.targetOperatingBalance ?? 0)} />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton variant="secondary">Save funding</SubmitButton>
                {!view.myAccounts.length ? <p className="mt-2 text-[12.5px] text-ink-3">To choose an account, connect a bank from Settings → Connected banks.</p> : null}
              </div>
            </ActionForm>
          ) : (
            <p className="text-sm text-ink-2">
              Minimum balance {money(view.funding?.minOperatingBalance ?? 0, cur)}. Only an owner of this portfolio can change funding.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Review rules" description={`When a bill arrives, the first matching rule decides whether it's routine or needs a person. Applies to every property in ${view.scope.name}. Unusual amounts, possible duplicates and escrow conflicts are always flagged, whatever the rule.`} />
        <ul>
          {view.policies.map((p) => (
            <li key={p.id} className="border-b border-line px-5 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[13.5px] text-ink">{p.name}</p>
                  <p className="text-[12px] text-ink-3">
                    {p.obligationKind ? kindLabel(p.obligationKind) : "Any cost"} · {money(p.minAmount, cur)}
                    {p.maxAmount !== null ? `–${money(p.maxAmount, cur)}` : " and up"} · {ACTION[p.action]}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={p.enabled ? "done" : "stopped"}>{p.enabled ? "On" : "Off"}</StatusBadge>
                  {view.canAdmin ? (
                    <ActionButton action={savePolicyAction} fields={{ organizationId: view.scope.id, policyId: p.id, name: p.name, obligationKind: p.obligationKind ?? "", minAmount: cents(p.minAmount), maxAmount: cents(p.maxAmount), action: p.action, enabled: String(!p.enabled) }} variant="ghost">
                      {p.enabled ? "Turn off" : "Turn on"}
                    </ActionButton>
                  ) : null}
                </div>
              </div>
              {view.canAdmin ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[12.5px] text-navy-800 underline">Edit</summary>
                  <ActionForm action={savePolicyAction} className="mt-2 space-y-3">
                    <input type="hidden" name="organizationId" value={view.scope.id} />
                    <input type="hidden" name="policyId" value={p.id} />
                    <input type="hidden" name="enabled" value={String(p.enabled)} />
                    <PolicyFields p={p} prefix={p.id} />
                    <SubmitButton variant="secondary" size="sm">
                      Save rule
                    </SubmitButton>
                  </ActionForm>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
        {view.canAdmin ? (
          <CardBody className="border-t border-line">
            <p className="mb-2 text-[13px] font-medium text-ink">Add a rule</p>
            <ActionForm action={savePolicyAction} className="space-y-3" resetOnSuccess>
              <input type="hidden" name="organizationId" value={view.scope.id} />
              <PolicyFields prefix="new" />
              <SubmitButton variant="secondary" size="sm">
                Add rule
              </SubmitButton>
            </ActionForm>
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Monitoring" description={monitoring ? "Sagolik watches this property's costs and tells you when something needs attention." : "Monitoring is off. The record is kept; nothing is checked."} />
        {view.canAdmin ? (
          <CardBody>
            <ActionButton action={setMonitoringAction} fields={{ passportId: id, monitoring: monitoring ? "off" : "monitor" }} variant={monitoring ? "ghost" : "primary"} confirm={monitoring ? "Turn off monitoring for this property?" : undefined}>
              {monitoring ? "Turn off monitoring" : "Turn on monitoring"}
            </ActionButton>
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}
