"use client";
/**
 * Shows full wire details to the payer on request only (step-up required),
 * and hides them again after two minutes. Nothing is stored in the page.
 */
import { Alert, buttonClasses, DefinitionList } from "@sagolik/ui";
import { Eye, EyeOff, PhoneCall } from "lucide-react";
import { usePathname } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { revealInstructionAction } from "@/app/actions/transaction";
import { ActionFeedback, SubmitButton } from "@/components/forms";

type Details = { beneficiaryName: string; bankName: string; routingIdentifier: string; accountNumber: string; version: number };

export function WireDetails({ transactionId, instructionId, escrowContact }: { transactionId: string; instructionId: string; escrowContact: string | null }) {
  const [state, action] = useActionState(revealInstructionAction, null);
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();
  const details = state?.ok ? (state.data as Details | undefined) : undefined;

  useEffect(() => {
    if (!details) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 120_000);
    return () => clearTimeout(t);
  }, [details]);

  if (details && visible) {
    return (
      <div className="rounded-lg border border-teal-600/30 bg-teal-50/60 p-4">
        <Alert tone="attention" title="Before you send">
          <span className="inline-flex items-start gap-1.5">
            <PhoneCall className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Call {escrowContact ?? "your escrow officer"} on a number you already know and read these details back. Never use details from an email or text.
          </span>
        </Alert>
        <DefinitionList
          className="mt-3"
          items={[
            { term: "Beneficiary", value: details.beneficiaryName },
            { term: "Bank", value: details.bankName },
            { term: "Routing (ABA)", value: <span className="font-mono">{details.routingIdentifier}</span> },
            { term: "Account", value: <span className="font-mono">{details.accountNumber}</span> },
            { term: "Version", value: `v${details.version}` },
          ]}
        />
        <button type="button" onClick={() => setVisible(false)} className={buttonClasses("ghost", "sm", "mt-3")}>
          <EyeOff className="h-4 w-4" aria-hidden /> Hide details
        </button>
      </div>
    );
  }
  return (
    <form action={action}>
      <input type="hidden" name="transactionId" value={transactionId} />
      <input type="hidden" name="instructionId" value={instructionId} />
      <SubmitButton variant="secondary" pendingLabel="Checking…">
        <Eye className="h-4 w-4" aria-hidden /> Show full wire details
      </SubmitButton>
      <p className="mt-1.5 text-[12px] text-ink-3">You&apos;ll be asked to confirm it&apos;s you. Details hide again after two minutes.</p>
      {state && !state.ok ? <ActionFeedback state={state} returnTo={pathname} /> : null}
    </form>
  );
}
