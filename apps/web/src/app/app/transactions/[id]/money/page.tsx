import { BANK_STATUS_TEXT, listInstitutions, moneyView, myBankConnections } from "@sagolik/core";
import { formatDate, formatDateTime } from "@sagolik/i18n";
import { SOURCE_OF_FUNDS_TYPES } from "@sagolik/types";
import { Alert, Card, CardBody, CardHeader, DefinitionList, EmptyState, Field, formatMoney, Input, Select, StatusBadge, Textarea } from "@sagolik/ui";
import { evaluateRules, latestInstruction } from "@sagolik/workflow";
import { Banknote, Landmark, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { advancePaymentSandbox, confirmDisbursementSandbox } from "@/app/actions/sandbox";
import {
  addEscrowConditionAction,
  approvePaymentAction,
  cancelPaymentAction,
  createInstructionAction,
  declareFundsAction,
  initiatePaymentAction,
  openEscrowAction,
  recordEscrowMovementAction,
  refreshBankAction,
  requestDisbursementAction,
  satisfyEscrowConditionAction,
  startBankConnectionAction,
  verifyInstructionAction,
} from "@/app/actions/transaction";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { WireDetails } from "@/components/app/wire-details";
import { loadTx } from "@/lib/server/tx";

export const metadata: Metadata = { title: "Money" };

const PAYMENT_TONE = { created: "neutral", authorization_required: "attention", authorized: "progress", initiated: "progress", processing: "progress", received: "info", settled: "done", failed: "blocked", returned: "blocked", cancelled: "stopped" } as const;

export default async function MoneyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bank?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, snapshot: s, can, locale, actor, demo } = await loadTx(id);
  if (!can("financial.view")) notFound();
  const cur = s.transaction.currency;
  const connections = await myBankConnections(ctx);
  const accounts = connections.filter((c) => c.connection.status === "connected").flatMap((c) => c.accounts.map((a) => ({ ...a, institution: c.connection.institutionName })));
  const money = moneyView(s, accounts, new Date().toISOString());
  const ins = latestInstruction(s, "closing_funds_to_escrow") ?? null;
  const history = s.bankInstructions.filter((b) => b.purpose === "closing_funds_to_escrow").sort((a, b) => b.version - a.version);
  const institutions = can("payment.initiate") ? await listInstitutions(ctx, s.property.country) : [];
  const ledger = s.escrow ? await ctx.db.escrow_transactions.find({ escrowAccountId: s.escrow.id }, { orderBy: "occurredAt" }) : [];
  const rules = evaluateRules(s);
  const depositRule = rules.find((r) => r.rule.id === "escrow_deposit_enabled")!;
  const fundsRule = rules.find((r) => r.rule.id === "closing_funds_enabled")!;
  const escrowOfficer = s.participants.find((p) => p.role === "escrow_officer" && p.status === "active");
  const escrowOfficerName = escrowOfficer ? escrowOfficer.displayName : null;
  const isBuyer = s.participants.some((p) => p.userId === actor.userId && (p.role === "buyer" || p.role === "co_buyer"));
  const people = Object.fromEntries(s.participants.filter((p) => p.userId).map((p) => [p.userId!, p.displayName]));
  const outstanding = s.escrow ? Math.max(0, s.escrow.requiredAmount - s.escrow.receivedAmount) : money.remainingAtClosing;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        {sp.bank === "connected" ? <Alert tone="done">Your bank is connected and ownership verified.</Alert> : null}

        <Card>
          <CardHeader title="Summary" description="Estimated from the purchase price, loan and settled deposits. The approved closing statement is final." />
          <CardBody>
            <DefinitionList
              items={[
                { term: "Purchase price", value: formatMoney(money.purchasePrice, cur) },
                ...(money.loanAmount ? [{ term: "Mortgage", value: formatMoney(money.loanAmount, cur) }] : []),
                { term: "Deposit received", value: formatMoney(money.depositSettled, cur) },
                { term: "Remaining at closing", value: <span className="text-navy-800">{formatMoney(money.remainingAtClosing, cur)}</span> },
              ]}
            />
          </CardBody>
        </Card>

        <Card id="instructions" className="scroll-mt-24">
          <CardHeader title="Escrow payment instructions" description="Always confirm by phone with your escrow officer, using a number you already know, before sending money." />
          <CardBody className="space-y-4">
            {ins ? (
              <>
                {money.instruction?.coolingOffUntil ? (
                  <Alert tone="attention" title="These instructions changed recently">
                    For your protection they can't be used until {formatDateTime(money.instruction.coolingOffUntil, locale)}. Call your escrow officer to confirm the change.
                  </Alert>
                ) : null}
                {!money.instruction?.verified ? (
                  <Alert tone="attention" title="Waiting for independent verification">
                    A second authorized person must verify these instructions out of band before any money can be sent.
                  </Alert>
                ) : null}
                <div className="flex items-start gap-3 rounded-lg border border-line p-4">
                  {money.instruction?.verified ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden /> : <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-attention" aria-hidden />}
                  <DefinitionList
                    className="flex-1"
                    items={[
                      { term: "Beneficiary", value: ins.beneficiaryName },
                      { term: "Bank", value: ins.bankName },
                      { term: "Account", value: `•••• ${ins.accountMask}` },
                      { term: "Routing", value: ins.routingIdentifier },
                      { term: "Version", value: `v${ins.version}` },
                      { term: "Status", value: ins.status === "verified" || ins.status === "locked" ? `Verified${ins.verifiedBy ? ` by ${people[ins.verifiedBy] ?? "a second officer"}` : ""}${ins.verifiedAt ? ` · ${formatDate(ins.verifiedAt, locale)}` : ""}` : "Pending verification" },
                    ]}
                  />
                </div>
                {can("beneficiary.verify") && ins.status === "pending_verification" && ins.createdBy !== actor.userId ? (
                  <ActionForm action={verifyInstructionAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="transactionId" value={id} />
                    <input type="hidden" name="instructionId" value={ins.id} />
                    <Field label="How did you verify them?" htmlFor="method" className="min-w-56 flex-1">
                      <Select id="method" name="method" defaultValue="out_of_band_call">
                        <option value="out_of_band_call">Phone call to a known number</option>
                        <option value="in_person">In person</option>
                        <option value="provider_attested">Attested by the escrow provider</option>
                      </Select>
                    </Field>
                    <Field label="Call reference (optional)" htmlFor="reference" className="min-w-56 flex-1">
                      <Input id="reference" name="reference" maxLength={200} placeholder="e.g. who you spoke to and when" />
                    </Field>
                    <SubmitButton>Verify instructions</SubmitButton>
                  </ActionForm>
                ) : null}
                {can("payment.initiate") && (ins.status === "verified" || ins.status === "locked") ? (
                  <WireDetails transactionId={id} instructionId={ins.id} escrowContact={escrowOfficerName} />
                ) : null}
                {history.length > 1 ? (
                  <details className="text-[13px]">
                    <summary className="cursor-pointer text-ink-2">Version history ({history.length})</summary>
                    <ul className="mt-2 space-y-1 text-ink-3">
                      {history.map((h) => (
                        <li key={h.id}>
                          v{h.version} · {h.bankName} •••• {h.accountMask} · {h.status.replace(/_/g, " ")} · entered {formatDateTime(h.createdAt, locale)} by {people[h.createdBy] ?? "an officer"}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-ink-3">Escrow hasn't published payment instructions yet. Never send money based on instructions received by email.</p>
            )}
            {can("beneficiary.modify") && ins ? (
              <details className="rounded-lg border border-line px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-ink-2">Change instructions (creates a new version)</summary>
                <Alert tone="attention" className="mt-3">
                  Every party will be alerted, the new version must be verified by someone else, and it enters a waiting period before use.
                </Alert>
                <ActionForm action={createInstructionAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="transactionId" value={id} />
                  <input type="hidden" name="purpose" value="closing_funds_to_escrow" />
                  <input type="hidden" name="currency" value={cur} />
                  <Field label="Beneficiary" htmlFor="beneficiaryName">
                    <Input id="beneficiaryName" name="beneficiaryName" required />
                  </Field>
                  <Field label="Bank" htmlFor="bankName">
                    <Input id="bankName" name="bankName" required />
                  </Field>
                  <Field label="Account number / IBAN" htmlFor="accountNumber">
                    <Input id="accountNumber" name="accountNumber" required autoComplete="off" />
                  </Field>
                  <Field label="Routing / BIC" htmlFor="routingIdentifier">
                    <Input id="routingIdentifier" name="routingIdentifier" required autoComplete="off" />
                  </Field>
                  <div className="sm:col-span-2">
                    <SubmitButton variant="danger">Save new version</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            ) : null}
          </CardBody>
        </Card>

        <Card id="send" className="scroll-mt-24">
          <CardHeader title="Payments" description="Settlement is confirmed only by the bank or escrow provider — never assumed." />
          <CardBody className="space-y-4">
            {money.payments.length ? (
              <ul className="divide-y divide-line">
                {money.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div>
                      <p className="font-medium text-ink">
                        {p.type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())} · <span className="num">{formatMoney(p.amount, p.currency)}</span>
                      </p>
                      <p className="text-[13px] text-ink-3">{p.statusText}</p>
                      <p className="text-[12px] text-ink-4">
                        {p.rail.toUpperCase()} · started by {people[p.initiatedBy] ?? "a participant"} · {formatDateTime(p.createdAt, locale)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={PAYMENT_TONE[p.status]}>{p.status.replace(/_/g, " ")}</StatusBadge>
                      {p.status === "authorization_required" && can("payment.approve") && p.initiatedBy !== actor.userId ? (
                        <ActionButton action={approvePaymentAction} fields={{ transactionId: id, paymentId: p.id }} variant="primary">
                          Approve &amp; send
                        </ActionButton>
                      ) : null}
                      {["authorization_required", "authorized"].includes(p.status) && (p.initiatedBy === actor.userId || can("payment.approve")) ? (
                        <ActionButton action={cancelPaymentAction} fields={{ transactionId: id, paymentId: p.id }} variant="ghost" confirm="Cancel this transfer?">
                          Cancel
                        </ActionButton>
                      ) : null}
                      {demo && p.externalPaymentId && ["initiated", "processing", "received"].includes(p.status) ? (
                        <span className="flex items-center gap-1 rounded-full border border-dashed border-attention/40 px-2 py-0.5">
                          <span className="text-[11px] font-medium text-attention">Sandbox bank</span>
                          <ActionButton action={advancePaymentSandbox} fields={{ transactionId: id, paymentId: p.id, outcome: "next" }} variant="ghost">
                            Advance
                          </ActionButton>
                          <ActionButton action={advancePaymentSandbox} fields={{ transactionId: id, paymentId: p.id, outcome: "fail" }} variant="ghost">
                            Fail
                          </ActionButton>
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No payments yet" icon={<Banknote className="h-8 w-8" aria-hidden />} />
            )}

            {can("payment.initiate") && isBuyer ? (
              <div className="rounded-lg border border-line p-4">
                <p className="font-medium text-ink">Send money to escrow</p>
                {!depositRule.satisfied && !fundsRule.satisfied ? (
                  <ul className="mt-2 space-y-1 text-[13px] text-ink-3">
                    {fundsRule.conditions
                      .filter((c) => !c.value)
                      .map((c) => (
                        <li key={c.fact}>• {c.detail}</li>
                      ))}
                  </ul>
                ) : accounts.filter((a) => a.ownershipVerified).length === 0 ? (
                  <p className="mt-2 text-[13px] text-ink-3">Connect a bank account in your name first.</p>
                ) : !ins || !money.instruction?.verified || money.instruction.coolingOffUntil ? (
                  <p className="mt-2 text-[13px] text-ink-3">Payment instructions must be verified (and out of any waiting period) before you can send money.</p>
                ) : (
                  <ActionForm action={initiatePaymentAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="transactionId" value={id} />
                    <input type="hidden" name="currency" value={cur} />
                    <input type="hidden" name="bankInstructionId" value={ins.id} />
                    <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
                    <Field label="What for" htmlFor="type">
                      <Select id="type" name="type" defaultValue={fundsRule.satisfied ? "closing_funds" : "earnest_money"}>
                        {depositRule.satisfied ? <option value="earnest_money">Earnest money / deposit</option> : null}
                        {fundsRule.satisfied ? <option value="closing_funds">Closing funds</option> : null}
                      </Select>
                    </Field>
                    <Field label="From" htmlFor="fromAccountId">
                      <Select id="fromAccountId" name="fromAccountId">
                        {accounts
                          .filter((a) => a.ownershipVerified)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.institution} {a.name} •••• {a.mask}
                              {a.availableBalance !== null ? ` — ${formatMoney(a.availableBalance, a.currency)} available` : ""}
                            </option>
                          ))}
                      </Select>
                    </Field>
                    <Field label={`Amount (${cur})`} htmlFor="amount" hint={`Outstanding in escrow: ${formatMoney(outstanding, cur)}`}>
                      <Input id="amount" name="amount" inputMode="decimal" required defaultValue={(outstanding / 100).toFixed(2)} />
                    </Field>
                    <Field label="Method" htmlFor="rail">
                      <Select id="rail" name="rail" defaultValue="wire">
                        <option value="wire">Wire</option>
                        <option value="ach">ACH</option>
                        {cur === "EUR" ? <option value="sepa_instant">SEPA Instant</option> : null}
                      </Select>
                    </Field>
                    <div className="sm:col-span-2">
                      <p className="mb-2 text-[12px] text-ink-3">You'll confirm it's you, and your escrow officer approves the transfer before it's sent.</p>
                      <SubmitButton>Review &amp; send</SubmitButton>
                    </div>
                  </ActionForm>
                )}
              </div>
            ) : null}
          </CardBody>
        </Card>

        {isBuyer ? (
          <Card id="source-of-funds" className="scroll-mt-24">
            <CardHeader title="Source of funds" description="Required for anti-money-laundering checks. A person reviews every declaration." />
            <CardBody className="space-y-4">
              {s.sourceOfFunds.length ? (
                <ul className="space-y-2 text-sm">
                  {s.sourceOfFunds.map((d) => (
                    <li key={d.id} className="flex justify-between gap-3">
                      <span>
                        {d.sourceType.replace(/_/g, " ")} · <span className="num">{formatMoney(d.amount, d.currency)}</span>
                      </span>
                      <StatusBadge tone={d.status === "approved" ? "done" : d.status === "rejected" ? "blocked" : "attention"}>{d.status === "approved" ? "Reviewed" : d.status === "rejected" ? "Needs changes" : "Being reviewed"}</StatusBadge>
                    </li>
                  ))}
                </ul>
              ) : null}
              <ActionForm action={declareFundsAction} className="grid gap-3 sm:grid-cols-2" resetOnSuccess>
                <input type="hidden" name="transactionId" value={id} />
                <input type="hidden" name="currency" value={cur} />
                <Field label="Where the money comes from" htmlFor="sourceType">
                  <Select id="sourceType" name="sourceType">
                    {SOURCE_OF_FUNDS_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={`Amount (${cur})`} htmlFor="sof-amount">
                  <Input id="sof-amount" name="amount" inputMode="decimal" required />
                </Field>
                <Field label="Short description" htmlFor="sof-description" className="sm:col-span-2">
                  <Textarea id="sof-description" name="description" maxLength={1000} className="min-h-16" />
                </Field>
                <div className="sm:col-span-2">
                  <SubmitButton variant="secondary">Submit for review</SubmitButton>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Escrow" description={s.escrow ? s.escrow.providerName : "Held by a licensed escrow or title partner — never by Sagolik Close."} />
          <CardBody className="space-y-4">
            {s.escrow ? (
              <>
                <DefinitionList
                  items={[
                    { term: "Reference", value: s.escrow.externalReference },
                    { term: "Required", value: formatMoney(s.escrow.requiredAmount, cur) },
                    { term: "Received", value: formatMoney(s.escrow.receivedAmount, cur) },
                    { term: "Outstanding", value: formatMoney(Math.max(0, s.escrow.requiredAmount - s.escrow.receivedAmount), cur) },
                    ...(s.escrow.expectedReleaseDate ? [{ term: "Expected release", value: formatDate(s.escrow.expectedReleaseDate, locale) }] : []),
                    { term: "Status", value: s.escrow.status.replace(/_/g, " ") },
                  ]}
                />
                <div>
                  <p className="text-[13px] font-medium text-ink-2">Conditions</p>
                  <ul className="mt-1.5 space-y-1.5 text-sm">
                    {s.escrowConditions.map((c) => (
                      <li key={c.id} className="flex items-start justify-between gap-2">
                        <span className={c.satisfied ? "text-ink-3" : "text-ink"}>
                          {c.satisfied ? "✓ " : "○ "}
                          {c.description}
                        </span>
                        {!c.satisfied && can("escrow.manage") ? (
                          <ActionButton action={satisfyEscrowConditionAction} fields={{ transactionId: id, conditionId: c.id }}>
                            Satisfied
                          </ActionButton>
                        ) : null}
                      </li>
                    ))}
                    {s.escrowConditions.length === 0 ? <li className="text-ink-3">No conditions.</li> : null}
                  </ul>
                  {can("escrow.manage") ? (
                    <ActionForm action={addEscrowConditionAction} className="mt-2 flex gap-2" resetOnSuccess>
                      <input type="hidden" name="transactionId" value={id} />
                      <label htmlFor="cond" className="sr-only">
                        New condition
                      </label>
                      <Input id="cond" name="description" placeholder="Add a condition" required minLength={3} />
                      <SubmitButton variant="secondary" size="md">
                        Add
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                </div>
                {can("escrow.manage") ? (
                  <details className="rounded-lg border border-line px-4 py-3">
                    <summary className="cursor-pointer text-sm font-medium text-ink-2">Record funds from your escrow system</summary>
                    <p className="mt-2 text-[12.5px] text-ink-3">Enter what your escrow system shows. Sagolik Close records it; it never moves the money.</p>
                    <ActionForm action={recordEscrowMovementAction} className="mt-3 grid gap-3 sm:grid-cols-3" resetOnSuccess>
                      <input type="hidden" name="transactionId" value={id} />
                      <Field label="Type" htmlFor="kind">
                        <Select id="kind" name="kind" defaultValue="receipt">
                          <option value="receipt">Funds received</option>
                          <option value="disbursement">Funds paid out</option>
                        </Select>
                      </Field>
                      <Field label={`Amount (${cur})`} htmlFor="amount">
                        <Input id="amount" name="amount" inputMode="decimal" required placeholder="0.00" />
                      </Field>
                      <Field label="Reference in your system" htmlFor="mref">
                        <Input id="mref" name="reference" required minLength={3} maxLength={120} placeholder="e.g. Wire FW-1042" />
                      </Field>
                      <div className="sm:col-span-3">
                        <SubmitButton variant="secondary">Record</SubmitButton>
                      </div>
                    </ActionForm>
                  </details>
                ) : null}
                {ledger.length ? (
                  <div>
                    <p className="text-[13px] font-medium text-ink-2">Ledger</p>
                    <ul className="mt-1.5 space-y-1 text-[13px]">
                      {ledger.map((l) => (
                        <li key={l.id} className="flex justify-between gap-2">
                          <span className="text-ink-2">
                            {l.description} · {l.status}
                          </span>
                          <span className={`num ${l.direction === "deposit" ? "text-success" : "text-ink-2"}`}>
                            {l.direction === "deposit" ? "+" : "−"}
                            {formatMoney(l.amount, l.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {can("escrow.manage") && s.recording && ["submitted_for_recording", "recorded"].includes(s.recording.status) && !["releasing", "disbursed"].includes(s.escrow.status) ? (
                  <ActionButton action={requestDisbursementAction} fields={{ transactionId: id }} variant="primary">
                    Request disbursement
                  </ActionButton>
                ) : null}
                {demo && can("escrow.manage") && s.escrow.status === "releasing" ? (
                  <ActionButton action={confirmDisbursementSandbox} fields={{ transactionId: id }}>
                    Sandbox partner: confirm disbursement
                  </ActionButton>
                ) : null}
              </>
            ) : can("escrow.manage") ? (
              <ActionForm action={openEscrowAction} className="space-y-3">
                <input type="hidden" name="transactionId" value={id} />
                <Field label={`Required from the buyer (${cur})`} htmlFor="requiredAmount">
                  <Input id="requiredAmount" name="requiredAmount" inputMode="decimal" required defaultValue={(money.remainingAtClosing / 100).toFixed(2)} />
                </Field>
                <SubmitButton>
                  <Landmark className="h-4 w-4" aria-hidden /> Open escrow
                </SubmitButton>
              </ActionForm>
            ) : (
              <p className="text-sm text-ink-3">Escrow hasn't been opened yet.</p>
            )}
          </CardBody>
        </Card>

        {can("payment.initiate") ? (
          <Card id="connect" className="scroll-mt-24">
            <CardHeader title="Your bank accounts" description="Connected through your bank's own consent screen. We never see your banking password." />
            <CardBody className="space-y-4">
              {connections.map(({ connection: c, accounts: accts }) => (
                <div key={c.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-ink">{c.institutionName}</p>
                    <StatusBadge tone={c.status === "connected" ? "done" : c.status === "revoked" ? "stopped" : "attention"}>{c.status === "connected" ? "Connected" : c.status.replace(/_/g, " ")}</StatusBadge>
                  </div>
                  {c.status !== "connected" ? <p className="mt-1 text-[13px] text-ink-3">{BANK_STATUS_TEXT[c.status]}</p> : null}
                  <ul className="mt-2 space-y-1 text-[13px]">
                    {accts.map((a) => (
                      <li key={a.id} className="flex justify-between gap-2">
                        <span className="text-ink-2">
                          {a.name} •••• {a.mask} {a.ownershipVerified ? <span className="text-success">· in your name</span> : <span className="text-attention">· owner not confirmed</span>}
                        </span>
                        {a.availableBalance !== null ? <span className="num text-ink">{formatMoney(a.availableBalance, a.currency)}</span> : null}
                      </li>
                    ))}
                  </ul>
                  {c.status === "connected" || c.status === "reauthentication_required" ? (
                    <div className="mt-2">
                      <ActionButton action={refreshBankAction} fields={{ connectionId: c.id }} variant="ghost">
                        Refresh balances
                      </ActionButton>
                    </div>
                  ) : null}
                </div>
              ))}
              <ActionForm action={startBankConnectionAction} className="space-y-3">
                <input type="hidden" name="transactionId" value={id} />
                <input type="hidden" name="country" value={s.property.country} />
                <Field label="Connect a bank" htmlFor="institutionId">
                  <Select id="institutionId" name="institutionId" required defaultValue="">
                    <option value="" disabled>
                      Choose your bank…
                    </option>
                    {institutions.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton variant="secondary" pendingLabel="Opening your bank…">
                  Continue to your bank
                </SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
