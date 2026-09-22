import { Card, CardBody, CardHeader } from "@sagolik/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { recordConsentAction } from "@/app/actions/governance";
import { PersonalDataExport } from "@/components/app/audit-export";
import { ActionForm, SubmitButton } from "@/components/forms";
import { requireContext } from "@/lib/server/context";

export const metadata: Metadata = { title: "Privacy center" };

const PURPOSES = [
  { purpose: "product_analytics", label: "Privacy-conscious product analytics", description: "Anonymous usage metrics that help us improve Sagolik Close. Never includes documents, money or identity data." },
  { purpose: "marketing_email", label: "Product news by email", description: "Occasional updates about new features. Transaction emails are always sent." },
];

export default async function PrivacyCenter() {
  const { ctx, actor } = await requireContext("/app/settings/privacy");
  const consents = await ctx.db.consent_records.find({ userId: actor.userId }, { orderBy: "createdAt", ascending: false });
  const current = (p: string) => consents.find((c) => c.purpose === p)?.granted ?? false;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Your data" description="Download everything we hold about you in a machine-readable file (GDPR Art. 15/20, CCPA)." />
        <CardBody>
          <PersonalDataExport />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Your choices" description="Each change is recorded with the policy version you agreed to." />
        <ul>
          {PURPOSES.map((p) => (
            <li key={p.purpose} className="border-b border-line px-5 py-4 last:border-b-0">
              <ActionForm action={recordConsentAction} className="flex flex-wrap items-center justify-between gap-3">
                <input type="hidden" name="purpose" value={p.purpose} />
                <label className="flex items-start gap-3">
                  <input type="checkbox" name="granted" defaultChecked={current(p.purpose)} className="mt-1 accent-navy-800" />
                  <span>
                    <span className="block text-sm font-medium text-ink">{p.label}</span>
                    <span className="text-[13px] text-ink-3">{p.description}</span>
                  </span>
                </label>
                <SubmitButton size="sm" variant="secondary">
                  Save
                </SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Connected banks and sessions" />
        <CardBody className="space-y-2 text-sm">
          <p>
            <Link href="/app/settings/banks" className="text-teal-700 hover:underline">
              Manage connected banks
            </Link>{" "}
            — disconnecting deletes the access token.
          </p>
          <p>
            <Link href="/app/settings/security" className="text-teal-700 hover:underline">
              Manage sessions and two-step verification
            </Link>
          </p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Deleting your data" />
        <CardBody className="space-y-2 text-sm text-ink-2">
          <p>You can ask us to delete your personal data. Some records must be kept by law — for example signed closing documents, payment history and the audit trail of a completed transaction — and are retained only for as long as required.</p>
          <p>
            To request deletion, <Link href="/contact?topic=privacy" className="text-teal-700 hover:underline">contact our privacy team</Link>. We'll confirm your identity before acting.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
