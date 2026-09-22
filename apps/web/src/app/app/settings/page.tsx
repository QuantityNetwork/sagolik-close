import { getRuntime } from "@sagolik/core";
import { LOCALE_NAMES } from "@sagolik/i18n";
import { LOCALES } from "@sagolik/types";
import { Card, CardBody, CardHeader, Field, Input, Select } from "@sagolik/ui";
import type { Metadata } from "next";
import { updateProfileAction } from "@/app/actions/governance";
import { ActionForm, SubmitButton } from "@/components/forms";
import { requireActor } from "@/lib/server/session";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfileSettings() {
  const actor = await requireActor("/app/settings");
  const rt = await getRuntime();
  const profile = (await rt.serviceDb.profiles.get(actor.userId))!;
  return (
    <Card>
      <CardHeader title="Profile" description="Your name as it appears to others on your transactions." />
      <CardBody>
        <ActionForm action={updateProfileAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="fullName">
            <Input id="fullName" name="fullName" defaultValue={profile.fullName} required minLength={2} autoComplete="name" />
          </Field>
          <Field label="Email" htmlFor="email" hint="Contact support to change your sign-in email.">
            <Input id="email" value={profile.email} disabled readOnly />
          </Field>
          <Field label="Mobile (for text alerts)" htmlFor="phone" hint="We never text amounts, account numbers or documents.">
            <Input id="phone" name="phone" defaultValue={profile.phone ?? ""} autoComplete="tel" placeholder="+1 512 555 0100" />
          </Field>
          <Field label="Language" htmlFor="locale">
            <Select id="locale" name="locale" defaultValue={profile.locale}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_NAMES[l]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </CardBody>
    </Card>
  );
}
