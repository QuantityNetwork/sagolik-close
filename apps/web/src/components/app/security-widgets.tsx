"use client";
import { Alert, buttonClasses, Field, Input } from "@sagolik/ui";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { mfaEnrollAction, mfaVerifyEnrollmentAction } from "@/app/actions/auth";
import { regenerateRecoveryCodesAction } from "@/app/actions/governance";
import { ActionForm, SubmitButton } from "@/components/forms";

export function MfaSetup() {
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!enroll) {
    return (
      <div>
        <button
          type="button"
          className={buttonClasses("primary")}
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const r = await mfaEnrollAction();
            setPending(false);
            if (r?.ok) setEnroll(r.data as { factorId: string; qr: string; secret: string });
            else if (r) setError(r.error);
          }}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Set up authenticator app
        </button>
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">Scan this code with your authenticator app (1Password, Google Authenticator, Microsoft Authenticator…), then enter the 6-digit code it shows.</p>
      {/* Supabase returns the QR code as an SVG data URI. */}
      <img src={enroll.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-lg border border-line bg-white p-2" />
      <p className="text-[12px] text-ink-3">
        Can't scan? Enter this key manually: <code className="break-all font-mono">{enroll.secret}</code>
      </p>
      <ActionForm action={mfaVerifyEnrollmentAction} className="flex items-end gap-2">
        <input type="hidden" name="factorId" value={enroll.factorId} />
        <Field label="Code" htmlFor="mfa-code" className="w-40">
          <Input id="mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} />
        </Field>
        <SubmitButton>Verify</SubmitButton>
      </ActionForm>
    </div>
  );
}

export function RecoveryCodes({ remaining }: { remaining: number }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">{remaining > 0 ? `${remaining} unused recovery codes remaining.` : "You haven't created recovery codes yet."} Use one if you lose access to your authenticator. Each works once.</p>
      {codes ? (
        <Alert tone="attention" title="Save these now — they won't be shown again">
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <button
        type="button"
        className={buttonClasses("secondary")}
        disabled={pending}
        onClick={async () => {
          if (remaining > 0 && !window.confirm("Create new codes? Your current recovery codes will stop working.")) return;
          setPending(true);
          const r = await regenerateRecoveryCodesAction();
          setPending(false);
          if (r?.ok) setCodes(r.data as string[]);
        }}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} {remaining > 0 ? "Create new recovery codes" : "Create recovery codes"}
      </button>
    </div>
  );
}
