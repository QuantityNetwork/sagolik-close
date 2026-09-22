"use client";
/**
 * Form plumbing for server actions: pending states, inline errors, success
 * messages and the step-up prompt. Every mutating control in the app goes
 * through <ActionForm> so no button silently does nothing.
 */
import { Alert, buttonClasses, type ButtonSize, type ButtonVariant, cn } from "@sagolik/ui";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

export type ActionState =
  | { ok: true; message?: string; data?: unknown }
  | { ok: false; error: string; code: string; details?: Array<{ path: string; message: string }> }
  | null;

export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function SubmitButton({ children, variant = "primary", size = "md", className, pendingLabel, disabled }: { children: ReactNode; variant?: ButtonVariant; size?: ButtonSize; className?: string; pendingLabel?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} aria-busy={pending} className={buttonClasses(variant, size, className)}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  showSuccess = true,
  id,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  showSuccess?: boolean;
  id?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} id={id} noValidate={false}>
      {children}
      <ActionFeedback state={state} returnTo={pathname} showSuccess={showSuccess} />
    </form>
  );
}

export function ActionFeedback({ state, returnTo, showSuccess = true }: { state: ActionState; returnTo: string; showSuccess?: boolean }) {
  if (!state) return null;
  if (state.ok) {
    return showSuccess && state.message ? (
      <Alert tone="done" className="mt-3">
        {state.message}
      </Alert>
    ) : null;
  }
  if (state.code === "step_up_required") {
    return (
      <Alert
        tone="attention"
        className="mt-3"
        title="Please confirm it's you"
        action={
          <Link href={`/app/step-up?next=${encodeURIComponent(returnTo)}`} className={buttonClasses("primary", "sm")}>
            Confirm
          </Link>
        }
      >
        {state.error} It takes a few seconds, then come back and try again.
      </Alert>
    );
  }
  return (
    <Alert tone="blocked" className="mt-3" title={state.error}>
      {state.details?.length ? (
        <ul className="mt-1 list-disc pl-4">
          {state.details.slice(0, 5).map((d, i) => (
            <li key={i}>{d.message}</li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

/** A single-button form (e.g. "Approve", "Mark resolved"). */
export function ActionButton({
  action,
  children,
  variant = "secondary",
  size = "sm",
  fields = {},
  className,
  confirm,
}: {
  action: FormAction;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fields?: Record<string, string>;
  className?: string;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const pathname = usePathname();
  return (
    <form
      action={formAction}
      className={cn("inline-block", className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant} size={size}>
        {children}
      </SubmitButton>
      <ActionFeedback state={state} returnTo={pathname} showSuccess={false} />
    </form>
  );
}
