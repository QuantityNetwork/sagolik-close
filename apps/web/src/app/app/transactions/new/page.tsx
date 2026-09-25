import { isFlagEnabled } from "@sagolik/config";
import { getRuntime, loadFlags, ROLE_LABELS, roleLabel } from "@sagolik/core";
import { CURRENCIES } from "@sagolik/types";
import { DEAL_STRUCTURE_LABELS, JURISDICTIONS } from "@sagolik/workflow";
import Link from "next/link";
import { Alert, Card, CardBody, Field, Input, Select } from "@sagolik/ui";
import type { Metadata } from "next";
import { createTransactionAction } from "@/app/actions/transaction";
import { ActionForm, SubmitButton } from "@/components/forms";
import { requireContext } from "@/lib/server/context";

export const metadata: Metadata = { title: "New transaction" };

const CREATOR_ROLES = ["transaction_coordinator", "buyer_agent", "seller_agent", "agent", "escrow_officer", "title_officer", "attorney", "loan_officer"] as const;

const BUSINESS_CREATOR_ROLES = ["broker", "attorney", "transaction_coordinator", "escrow_officer", "loan_officer"] as const;

export default async function NewTransactionPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const business = (await searchParams).kind === "business";
  const { actor } = await requireContext("/app/transactions/new");
  const rt = await getRuntime();
  const orgs = await rt.serviceDb.organizations.find({ id: actor.memberships.map((m) => m.organizationId) });
  const flags = await loadFlags(rt);
  const international = isFlagEnabled("international_markets", { overrides: flags });
  const markets = Object.values(JURISDICTIONS).filter((j) => j.vertical === "real_estate" && (j.availability !== "planned" || international));

  return (
    <div className="container-page max-w-3xl animate-rise py-8">
      <h1 className="text-[34px] text-navy-800">{business ? "Open a business acquisition" : "Open a transaction"}</h1>
      <p className="mt-1 text-sm text-ink-3">You can invite everyone else on the next screen.</p>
      <nav aria-label="Kind of deal" className="mt-4 inline-flex rounded-full border border-line bg-paper p-1 text-sm">
        <Link href="/app/transactions/new" aria-current={!business ? "page" : undefined} className={`rounded-full px-4 py-1.5 ${!business ? "bg-navy-800 text-white" : "text-ink-2"}`}>
          Real estate
        </Link>
        <Link href="/app/transactions/new?kind=business" aria-current={business ? "page" : undefined} className={`rounded-full px-4 py-1.5 ${business ? "bg-navy-800 text-white" : "text-ink-2"}`}>
          Business acquisition <span className="text-[11px] opacity-80">(beta)</span>
        </Link>
      </nav>
      {orgs.length === 0 ? (
        <Alert tone="attention" className="mt-6" title="You're not part of an organization yet">
          Transactions are opened by professionals on behalf of an agency, title company, law firm, lender or escrow provider.
        </Alert>
      ) : (
        <Card className="mt-6">
          <CardBody className="p-6">
            {business ? (
            <ActionForm action={createTransactionAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="type" value="business_acquisition" />
              <input type="hidden" name="jurisdiction" value="US-BUSINESS" />
              <input type="hidden" name="currency" value="USD" />
              <input type="hidden" name="country" value="US" />
              <Alert tone="info" className="sm:col-span-2" title="Beta">
                One US workflow for asset, stock and membership-interest purchases. State-specific steps (bulk-sale notices, tax clearance, consents) are tracked as tasks. Your counsel decides what the deal requires.
              </Alert>
              <Field label="Organization" htmlFor="organizationId" className="sm:col-span-2">
                <Select id="organizationId" name="organizationId">
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Your role on this deal" htmlFor="creatorRole">
                <Select id="creatorRole" name="creatorRole" defaultValue="broker">
                  {BUSINESS_CREATOR_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r, "US-BUSINESS")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Deal structure" htmlFor="dealStructure">
                <Select id="dealStructure" name="dealStructure" defaultValue="asset_purchase">
                  {Object.entries(DEAL_STRUCTURE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Company legal name" htmlFor="legalName" className="sm:col-span-2">
                <Input id="legalName" name="legalName" required minLength={2} maxLength={200} placeholder="e.g. Example Company, LLC" />
              </Field>
              <Field label="Trade name (optional)" htmlFor="tradeName">
                <Input id="tradeName" name="tradeName" maxLength={200} />
              </Field>
              <Field label="Entity type" htmlFor="entityType">
                <Select id="entityType" name="entityType" defaultValue="llc">
                  <option value="llc">LLC</option>
                  <option value="c_corporation">C corporation</option>
                  <option value="s_corporation">S corporation</option>
                  <option value="partnership">Partnership</option>
                  <option value="sole_proprietorship">Sole proprietorship</option>
                </Select>
              </Field>
              <Field label="State of formation" htmlFor="stateOfFormation">
                <Input id="stateOfFormation" name="stateOfFormation" required maxLength={2} placeholder="TX" />
              </Field>
              <Field label="Industry" htmlFor="industry">
                <Input id="industry" name="industry" required minLength={2} maxLength={120} />
              </Field>
              <Field label="Employees (optional)" htmlFor="employeeCount">
                <Input id="employeeCount" name="employeeCount" inputMode="numeric" />
              </Field>
              <Field label="Annual revenue, as reported by the seller (optional)" htmlFor="annualRevenue">
                <Input id="annualRevenue" name="annualRevenue" inputMode="decimal" />
              </Field>
              <Field label="Premises — street address" htmlFor="addressLine1" className="sm:col-span-2">
                <Input id="addressLine1" name="addressLine1" required minLength={3} />
              </Field>
              <Field label="City" htmlFor="city">
                <Input id="city" name="city" required />
              </Field>
              <Field label="State" htmlFor="region">
                <Input id="region" name="region" maxLength={2} />
              </Field>
              <Field label="Purchase price" htmlFor="salePrice">
                <Input id="salePrice" name="salePrice" inputMode="decimal" required />
              </Field>
              <Field label="Target closing date" htmlFor="expectedClosingDate">
                <Input id="expectedClosingDate" name="expectedClosingDate" type="date" />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton pendingLabel="Opening…">Open deal room</SubmitButton>
              </div>
            </ActionForm>
            ) : (
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
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
