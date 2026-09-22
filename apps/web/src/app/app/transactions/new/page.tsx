import { isFlagEnabled } from "@sagolik/config";
import { getRuntime, loadFlags, ROLE_LABELS } from "@sagolik/core";
import { CURRENCIES } from "@sagolik/types";
import { JURISDICTIONS } from "@sagolik/workflow";
import { Alert, Card, CardBody, Field, Input, Select } from "@sagolik/ui";
import type { Metadata } from "next";
import { createTransactionAction } from "@/app/actions/transaction";
import { ActionForm, SubmitButton } from "@/components/forms";
import { requireContext } from "@/lib/server/context";

export const metadata: Metadata = { title: "New transaction" };

const CREATOR_ROLES = ["transaction_coordinator", "buyer_agent", "seller_agent", "agent", "escrow_officer", "title_officer", "attorney", "loan_officer"] as const;

export default async function NewTransactionPage() {
  const { actor } = await requireContext("/app/transactions/new");
  const rt = await getRuntime();
  const orgs = await rt.serviceDb.organizations.find({ id: actor.memberships.map((m) => m.organizationId) });
  const flags = await loadFlags(rt);
  const international = isFlagEnabled("international_markets", { overrides: flags });
  const markets = Object.values(JURISDICTIONS).filter((j) => j.availability !== "planned" || international);

  return (
    <div className="container-page max-w-3xl animate-rise py-8">
      <h1 className="text-[34px] text-navy-800">Open a transaction</h1>
      <p className="mt-1 text-sm text-ink-3">You can invite everyone else on the next screen.</p>
      {orgs.length === 0 ? (
        <Alert tone="attention" className="mt-6" title="You're not part of an organization yet">
          Transactions are opened by professionals on behalf of an agency, title company, law firm, lender or escrow provider.
        </Alert>
      ) : (
        <Card className="mt-6">
          <CardBody className="p-6">
            <ActionForm action={createTransactionAction} className="grid gap-4 sm:grid-cols-2">
              <Field label="Organization" htmlFor="organizationId" className="sm:col-span-2">
                <Select id="organizationId" name="organizationId">
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Your role on this file" htmlFor="creatorRole">
                <Select id="creatorRole" name="creatorRole" defaultValue="transaction_coordinator">
                  {CREATOR_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Type" htmlFor="type">
                <Select id="type" name="type" defaultValue="purchase">
                  <option value="purchase">Purchase</option>
                  <option value="sale">Sale</option>
                  <option value="refinance">Refinance</option>
                  <option value="ownership_transfer">Ownership transfer</option>
                </Select>
              </Field>
              <Field label="Market" htmlFor="jurisdiction" hint="Controls required parties, documents, steps and recording.">
                <Select id="jurisdiction" name="jurisdiction" defaultValue="US-TX">
                  {markets.map((j) => (
                    <option key={j.code} value={j.code}>
                      {j.name}
                      {j.availability !== "available" ? ` (${j.availability})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Currency" htmlFor="currency">
                <Select id="currency" name="currency" defaultValue="USD">
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Street address" htmlFor="addressLine1" className="sm:col-span-2">
                <Input id="addressLine1" name="addressLine1" required minLength={3} autoComplete="street-address" />
              </Field>
              <Field label="City" htmlFor="city">
                <Input id="city" name="city" required />
              </Field>
              <Field label="State / region" htmlFor="region">
                <Input id="region" name="region" />
              </Field>
              <Field label="Postal code" htmlFor="postalCode">
                <Input id="postalCode" name="postalCode" />
              </Field>
              <Field label="Country (ISO code)" htmlFor="country">
                <Input id="country" name="country" defaultValue="US" maxLength={2} required />
              </Field>
              <Field label="Sale price" htmlFor="salePrice">
                <Input id="salePrice" name="salePrice" inputMode="decimal" required placeholder="825,000" />
              </Field>
              <Field label="Expected closing date" htmlFor="expectedClosingDate">
                <Input id="expectedClosingDate" name="expectedClosingDate" type="date" />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton pendingLabel="Opening…">Open transaction</SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
