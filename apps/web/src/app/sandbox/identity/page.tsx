import { getRuntime } from "@sagolik/core";
import { Card, CardBody } from "@sagolik/ui";
import { Camera, IdCard, ScanFace } from "lucide-react";
import type { Metadata } from "next";
import { completeIdentitySandbox } from "@/app/actions/sandbox";
import { ActionForm, SubmitButton } from "@/components/forms";
import { requireActor } from "@/lib/server/session";

export const metadata: Metadata = { title: "Sandbox identity check" };

export default async function SandboxIdentity({ searchParams }: { searchParams: Promise<{ inquiry?: string; redirect_uri?: string }> }) {
  const sp = await searchParams;
  await requireActor("/app");
  const rt = await getRuntime();
  const session = sp.inquiry ? rt.providers.mocks.identity?.session(sp.inquiry) : null;
  if (!session) {
    return (
      <Card>
        <CardBody className="p-7">This verification session has expired. Please start again from your transaction.</CardBody>
      </Card>
    );
  }
  const outcomes = [
    ["approve", "Complete verification", "primary"],
    ["review", "Simulate: needs manual review", "secondary"],
    ["fail", "Simulate: document can't be verified", "danger"],
  ] as const;
  return (
    <Card>
      <CardBody className="p-7">
        <p className="eyebrow">Sandbox identity provider</p>
        <h1 className="mt-2 text-[26px] text-navy-800">Verify it's you, {session.fullName.split(" ")[0]}</h1>
        <ol className="mt-5 space-y-3 text-sm text-ink-2">
          <li className="flex gap-3">
            <IdCard className="h-5 w-5 text-teal-600" aria-hidden /> Photograph the front and back of your ID
          </li>
          <li className="flex gap-3">
            <Camera className="h-5 w-5 text-teal-600" aria-hidden /> {session.livenessRequired ? "Take a short selfie video (liveness check)" : "Take a selfie"}
          </li>
          <li className="flex gap-3">
            <ScanFace className="h-5 w-5 text-teal-600" aria-hidden /> We check sanctions and politically-exposed-person lists
          </li>
        </ol>
        <p className="mt-4 text-[13px] text-ink-3">In the sandbox no camera is used. Choose an outcome to see how Sagolik Close handles it — the result arrives by signed webhook.</p>
        <div className="mt-6 grid gap-2">
          {outcomes.map(([value, label, variant]) => (
            <ActionForm key={value} action={completeIdentitySandbox}>
              <input type="hidden" name="inquiry" value={sp.inquiry} />
              <input type="hidden" name="redirect_uri" value={sp.redirect_uri ?? "/app"} />
              <input type="hidden" name="outcome" value={value} />
              <SubmitButton variant={variant} className="w-full">
                {label}
              </SubmitButton>
            </ActionForm>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
