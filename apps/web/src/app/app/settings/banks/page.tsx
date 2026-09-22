import { BANK_STATUS_TEXT, listInstitutions, myBankConnections } from "@sagolik/core";
import { formatDateTime } from "@sagolik/i18n";
import { Alert, Card, CardBody, CardHeader, EmptyState, Field, formatMoney, Select, StatusBadge } from "@sagolik/ui";
import { Landmark } from "lucide-react";
import type { Metadata } from "next";
import { disconnectBankAction, refreshBankAction, startBankConnectionAction } from "@/app/actions/transaction";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { requireContext } from "@/lib/server/context";

export const metadata: Metadata = { title: "Connected banks" };

export default async function BanksSettings({ searchParams }: { searchParams: Promise<{ bank?: string; bank_error?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireContext("/app/settings/banks");
  const connections = await myBankConnections(ctx);
  const institutions = await listInstitutions(ctx, "US");

  return (
    <div className="space-y-6">
      {sp.bank === "connected" ? <Alert tone="done">Your bank is connected.</Alert> : null}
      {sp.bank_error ? <Alert tone="blocked" title={sp.bank_error} /> : null}
      <Card>
        <CardHeader title="Connected banks" description="Connections use your bank's own consent screen. You can disconnect at any time; we then delete the access token." />
        {connections.length === 0 ? (
          <EmptyState title="No banks connected" icon={<Landmark className="h-8 w-8" aria-hidden />} />
        ) : (
          <ul>
            {connections.map(({ connection: c, accounts }) => (
              <li key={c.id} className="border-b border-line px-5 py-4 last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink">{c.institutionName}</p>
                    <p className="text-[12px] text-ink-3">
                      {BANK_STATUS_TEXT[c.status]} {c.consentExpiresAt ? `· consent until ${formatDateTime(c.consentExpiresAt, "en")}` : ""} {c.lastSyncedAt ? `· refreshed ${formatDateTime(c.lastSyncedAt, "en")}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={c.status === "connected" ? "done" : c.status === "revoked" ? "stopped" : "attention"}>{c.status.replace(/_/g, " ")}</StatusBadge>
                    {c.status !== "revoked" ? (
                      <>
                        <ActionButton action={refreshBankAction} fields={{ connectionId: c.id }} variant="ghost">
                          Refresh
                        </ActionButton>
                        <ActionButton action={disconnectBankAction} fields={{ connectionId: c.id }} variant="danger" confirm={`Disconnect ${c.institutionName}?`}>
                          Disconnect
                        </ActionButton>
                      </>
                    ) : null}
                  </div>
                </div>
                <ul className="mt-2 space-y-1 text-[13px]">
                  {accounts.map((a) => (
                    <li key={a.id} className="flex justify-between gap-3">
                      <span className="text-ink-2">
                        {a.name} •••• {a.mask}
                      </span>
                      {a.availableBalance !== null ? <span className="num">{formatMoney(a.availableBalance, a.currency)}</span> : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Connect a bank" />
        <CardBody>
          <ActionForm action={startBankConnectionAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="country" value="US" />
            <Field label="Bank" htmlFor="institutionId" className="min-w-64 flex-1">
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
            <SubmitButton variant="secondary">Continue to your bank</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}
