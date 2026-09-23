import { safeRedirectPath } from "@sagolik/security";
import { DEMO_TOTP_SECRET, getRuntime } from "@sagolik/core";
import { totpCode } from "@sagolik/auth";
import { translator } from "@sagolik/i18n";
import { Alert, Card, CardBody, Field, Input } from "@sagolik/ui";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { stepUp } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { requireActor } from "@/lib/server/session";

export const metadata: Metadata = { title: "Confirm it's you" };

export default async function StepUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  await requireActor("/app/step-up");
  const rt = await getRuntime();
  const t = translator("en");
  const next = safeRedirectPath(sp.next);

  return (
    <div className="container-page flex max-w-md animate-rise flex-col py-12">
      <Card>
        <CardBody className="p-7">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-teal-50 text-teal-700">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="mt-4 text-[28px] text-navy-800">{t("stepup.title")}</h1>
          <p className="mt-2 text-sm text-ink-2">{t("stepup.body")}</p>
          <ActionForm action={stepUp} className="mt-6 space-y-4">
            <input type="hidden" name="next" value={next} />
            <Field label="6-digit code from your authenticator app, or a recovery code" htmlFor="code">
              <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={11} className="text-center font-mono text-lg tracking-[0.3em]" />
            </Field>
            <SubmitButton className="w-full" pendingLabel="Checking…">
              Confirm
            </SubmitButton>
          </ActionForm>
          {rt.env.demoMode ? (
            <Alert tone="attention" className="mt-6" title="Sandbox authenticator">
              In this demo every person shares a sandbox authenticator. The current code is <span className="font-mono font-semibold">{totpCode(DEMO_TOTP_SECRET)}</span> (it changes every 30 seconds).
            </Alert>
          ) : (
            <p className="mt-6 text-[12px] text-ink-3">
              No authenticator yet? Set one up in{" "}
              <Link href="/app/settings/security" className="text-teal-700 hover:underline">
                Settings → Security
              </Link>
              .
            </p>
          )}
          <p className="mt-4 text-[12px] text-ink-3">Confirmation lasts five minutes.</p>
        </CardBody>
      </Card>
    </div>
  );
}
