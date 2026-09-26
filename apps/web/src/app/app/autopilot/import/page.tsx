import { autopilotHome } from "@sagolik/core";
import { Card, CardBody, CardHeader, Field, Input, Select } from "@sagolik/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { importPropertyAction } from "@/app/actions/autopilot";
import { ActionForm, SubmitButton } from "@/components/forms";
import { requireContext } from "@/lib/server/context";

export const metadata: Metadata = { title: "Add a property — Property Autopilot" };

const TYPES = [
  ["single_family", "Single-family home"],
  ["condo", "Condo"],
  ["townhouse", "Townhouse"],
  ["multi_family", "Multi-family"],
  ["land", "Land"],
  ["other", "Other"],
] as const;

export default async function ImportPropertyPage() {
  const { ctx } = await requireContext("/app/autopilot/import");
  const { scopes } = await autopilotHome(ctx);
  const ownerScopes = scopes.filter((s) => s.role === "organization_admin");
  return (
    <div className="container-page animate-rise py-8">
      <nav aria-label="Breadcrumb" className="text-[12px] text-ink-3">
        <Link href="/app/autopilot" className="hover:text-navy-800">
          Property Autopilot
        </Link>{" "}
        / Add a property
      </nav>
      <h1 className="mt-2 text-[30px] text-navy-800">Add a property you already own</h1>
      <p className="max-w-2xl text-sm text-ink-3">
        For a property you didn't buy through Sagolik. It's marked as added by you: Sagolik didn't verify its ownership. Next, add its costs and choose the account that pays them.
      </p>
      <Card className="mt-6 max-w-2xl">
        <CardHeader title="Property" />
        <CardBody>
          <ActionForm action={importPropertyAction} className="grid gap-3 sm:grid-cols-2">
            {ownerScopes.length > 1 ? (
              <Field label="Portfolio" htmlFor="organizationId" className="sm:col-span-2">
                <Select id="organizationId" name="organizationId" defaultValue={ownerScopes[0]!.id}>
                  {ownerScopes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : ownerScopes[0] ? (
              <input type="hidden" name="organizationId" value={ownerScopes[0].id} />
            ) : null}
            <Field label="Name you use for it" htmlFor="label" className="sm:col-span-2">
              <Input id="label" name="label" required minLength={2} maxLength={120} placeholder="e.g. Lake House" />
            </Field>
            <Field label="Street address" htmlFor="addressLine1" className="sm:col-span-2">
              <Input id="addressLine1" name="addressLine1" required autoComplete="street-address" />
            </Field>
            <Field label="City" htmlFor="city">
              <Input id="city" name="city" required autoComplete="address-level2" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="State" htmlFor="region">
                <Input id="region" name="region" required maxLength={2} pattern="[A-Za-z]{2}" placeholder="TX" autoComplete="address-level1" />
              </Field>
              <Field label="ZIP" htmlFor="postalCode">
                <Input id="postalCode" name="postalCode" required pattern="\d{5}(-\d{4})?" autoComplete="postal-code" />
              </Field>
            </div>
            <Field label="Type" htmlFor="propertyType">
              <Select id="propertyType" name="propertyType" defaultValue="single_family">
                {TYPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Owned since (optional)" htmlFor="acquiredOn">
              <Input id="acquiredOn" name="acquiredOn" type="date" />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton pendingLabel="Adding…">Add property</SubmitButton>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}
