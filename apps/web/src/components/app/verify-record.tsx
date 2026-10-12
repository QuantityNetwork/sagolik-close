"use client";
/** Replays the deal record's receipts against the registry and says, plainly, whether they match. */
import type { DealRecordVerification } from "@sagolik/core";
import { Alert } from "@sagolik/ui";
import { ShieldCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import { useActionState } from "react";
import { verifyDealRecordAction } from "@/app/actions/wallets";
import { ActionFeedback, SubmitButton } from "@/components/forms";

export function VerifyRecord({ transactionId, networkLabel }: { transactionId: string; networkLabel: string }) {
  const [state, action] = useActionState(verifyDealRecordAction, null);
  const pathname = usePathname();
  const result = state?.ok ? (state.data as DealRecordVerification) : null;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="transactionId" value={transactionId} />
      <SubmitButton variant="secondary" pendingLabel={`Checking ${networkLabel}…`}>
        <ShieldCheck className="h-4 w-4" aria-hidden /> Check against {networkLabel}
      </SubmitButton>
      {result?.status === "match" ? (
        <Alert tone="done" title="The public record matches">
          All {result.entries} {result.entries === 1 ? "entry matches" : "entries match"} what {networkLabel} holds for this deal: every receipt still has its fingerprint, and replaying them gives the registry&apos;s running fingerprint{" "}
          <span className="font-mono text-[12px]">{result.head.slice(0, 10)}…</span>.
        </Alert>
      ) : null}
      {result?.status === "settling" ? (
        <Alert tone="attention" title="Still being confirmed">
          Some entries are waiting for confirmation on {networkLabel}. Check again in a minute.
        </Alert>
      ) : null}
      {result?.status === "mismatch" ? (
        <Alert tone="blocked" title="The public record doesn't match our receipts">
          <ul className="mt-1 list-disc pl-4">
            {result.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-1">Sagolik has been alerted. Don&apos;t rely on this record until it&apos;s explained.</p>
        </Alert>
      ) : null}
      {state && !state.ok ? <ActionFeedback state={state} returnTo={pathname} /> : null}
    </form>
  );
}
