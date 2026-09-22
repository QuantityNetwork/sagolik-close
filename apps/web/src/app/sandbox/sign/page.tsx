import { getRuntime } from "@sagolik/core";
import { Card, CardBody } from "@sagolik/ui";
import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { signEnvelopeSandbox } from "@/app/actions/sandbox";
import { ActionForm, SubmitButton } from "@/components/forms";
import { requireActor } from "@/lib/server/session";

export const metadata: Metadata = { title: "Sandbox e-signature" };

export default async function SandboxSign({ searchParams }: { searchParams: Promise<{ envelope?: string; recipient?: string; return_url?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor("/app");
  const rt = await getRuntime();
  const env = sp.envelope ? rt.providers.mocks.signatures?.envelope(sp.envelope) : null;
  const me = env?.recipients.find((r) => r.recipientId === sp.recipient);
  const participant = sp.recipient ? await rt.serviceDb.transaction_participants.get(sp.recipient) : null;
  if (!env || !me || participant?.userId !== actor.userId) {
    return (
      <Card>
        <CardBody className="p-7">This signing session has expired or isn't yours. Please start again from your documents.</CardBody>
      </Card>
    );
  }
  const fields = (action: "sign" | "decline") => (
    <>
      <input type="hidden" name="envelope" value={sp.envelope} />
      <input type="hidden" name="recipient" value={sp.recipient} />
      <input type="hidden" name="return_url" value={sp.return_url ?? "/app"} />
      <input type="hidden" name="action" value={action} />
    </>
  );
  return (
    <Card>
      <CardBody className="p-7">
        <p className="eyebrow">Sandbox e-signature provider</p>
        <div className="mt-3 flex items-start gap-3 rounded-lg border border-line bg-canvas p-4">
          <FileText className="mt-0.5 h-6 w-6 text-navy-800" aria-hidden />
          <div>
            <p className="font-semibold text-ink">{env.documentName}</p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-ink-3">SHA-256 {env.documentSha256}</p>
          </div>
        </div>
        <p className="mt-5 text-sm text-ink-2">
          Signing as <span className="font-medium">{me.name}</span>. By selecting “Sign”, you adopt an electronic signature on this document. A certificate of completion is stored with the signed copy.
        </p>
        <ul className="mt-3 text-[13px] text-ink-3">
          {env.recipients.map((r) => (
            <li key={r.recipientId}>
              {r.name}: {r.status}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex gap-3">
          <ActionForm action={signEnvelopeSandbox}>
            {fields("sign")}
            <SubmitButton pendingLabel="Signing…">Sign</SubmitButton>
          </ActionForm>
          <ActionForm action={signEnvelopeSandbox}>
            {fields("decline")}
            <SubmitButton variant="ghost">Decline</SubmitButton>
          </ActionForm>
        </div>
      </CardBody>
    </Card>
  );
}
