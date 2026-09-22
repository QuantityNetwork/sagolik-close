import { getRuntime } from "@sagolik/core";
import { buttonClasses, Card, CardBody } from "@sagolik/ui";
import { Check, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { approveBankConsentSandbox } from "@/app/actions/sandbox";
import { ActionForm, SubmitButton } from "@/components/forms";
import { requireActor } from "@/lib/server/session";

export const metadata: Metadata = { title: "Sandbox bank consent" };

export default async function SandboxBank({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor("/app/settings/banks");
  const rt = await getRuntime();
  const pending = sp.state ? rt.providers.mocks.banking?.pendingConsent(sp.state) : null;
  if (!pending || pending.userId !== actor.userId) {
    return (
      <Card>
        <CardBody className="p-7">
          <p className="font-medium">This connection request has expired.</p>
          <Link href="/app/settings/banks" className={buttonClasses("secondary", "md", "mt-4")}>
            Start again
          </Link>
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardBody className="p-7">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy-800 font-semibold text-white">{pending.institution?.logoInitials}</span>
          <div>
            <p className="text-lg font-semibold">{pending.institution?.name}</p>
            <p className="text-[13px] text-ink-3">Sandbox online banking</p>
          </div>
        </div>
        <p className="mt-6 text-[15px]">
          <span className="font-semibold">Sagolik Close</span> is asking for permission to:
        </p>
        <ul className="mt-3 space-y-2 text-sm text-ink-2">
          {["Confirm the account holder's name", "See masked account numbers and balances", "See the last 90 days of transactions"].map((p) => (
            <li key={p} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 text-success" aria-hidden /> {p}
            </li>
          ))}
        </ul>
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-canvas p-3 text-[13px] text-ink-3">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> A real bank authenticates you on its own site. Sagolik Close never sees or stores your banking password. Permission lasts 90 days and can be withdrawn at any time.
        </p>
        <div className="mt-6 flex gap-3">
          <ActionForm action={approveBankConsentSandbox}>
            <input type="hidden" name="state" value={sp.state} />
            <SubmitButton pendingLabel="Connecting…">Allow access</SubmitButton>
          </ActionForm>
          <Link href="/app/settings/banks?bank_error=You%20cancelled%20the%20bank%20connection." className={buttonClasses("ghost")}>
            Cancel
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
