import type { Task } from "@sagolik/types";
import { buttonClasses } from "@sagolik/ui";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { startIdentityAction, startSigningAction } from "@/app/actions/transaction";
import { ActionForm, SubmitButton } from "@/components/forms";

/** The single primary action for a task — wired to the real flow behind it. */
export function TaskAction({ task, transactionId, variant = "light", label }: { task: Task; transactionId: string; variant?: "light" | "primary"; label?: string }) {
  const base = `/app/transactions/${transactionId}`;
  switch (task.actionKind) {
    case "sign_document":
      return task.relatedEntityId ? (
        <ActionForm action={startSigningAction}>
          <input type="hidden" name="transactionId" value={transactionId} />
          <input type="hidden" name="signatureId" value={task.relatedEntityId} />
          <SubmitButton variant={variant} pendingLabel="Opening…">
            {label ?? "Review & Sign"} <ArrowRight className="h-4 w-4" aria-hidden />
          </SubmitButton>
        </ActionForm>
      ) : null;
    case "verify_identity":
      return (
        <ActionForm action={startIdentityAction}>
          <input type="hidden" name="transactionId" value={transactionId} />
          <SubmitButton variant={variant} pendingLabel="Opening…">
            {label ?? "Verify identity"} <ArrowRight className="h-4 w-4" aria-hidden />
          </SubmitButton>
        </ActionForm>
      );
    case "connect_bank":
      return (
        <Link href={`${base}/money#connect`} className={buttonClasses(variant)}>
          {label ?? "Connect bank"} <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      );
    case "transfer_funds":
      return (
        <Link href={`${base}/money#send`} className={buttonClasses(variant)}>
          {label ?? "Review payment details"} <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      );
    case "declare_source_of_funds":
      return (
        <Link href={`${base}/money#source-of-funds`} className={buttonClasses(variant)}>
          {label ?? "Add details"} <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      );
    case "upload_document":
    case "review_document":
    case "approve_statement":
      return (
        <Link href={`${base}/documents`} className={buttonClasses(variant)}>
          {label ?? "Open documents"} <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      );
    default:
      return (
        <Link href={`${base}/tasks#task-${task.id}`} className={buttonClasses(variant)}>
          {label ?? "Open task"} <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      );
  }
}
