import { getRuntime, recoveryCodeStatus } from "@sagolik/core";
import { formatDateTime } from "@sagolik/i18n";
import { Alert, Card, CardBody, CardHeader, DefinitionList } from "@sagolik/ui";
import type { Metadata } from "next";
import { signOutOtherSessions } from "@/app/actions/auth";
import { MfaSetup, RecoveryCodes } from "@/components/app/security-widgets";
import { ActionButton } from "@/components/forms";
import { requireContext } from "@/lib/server/context";
import { supabaseForRequest } from "@/lib/server/session";

export const metadata: Metadata = { title: "Security" };

export default async function SecuritySettings() {
  const { ctx, actor } = await requireContext("/app/settings/security");
  const rt = await getRuntime();
  const codes = await recoveryCodeStatus(ctx);
  let factors: Array<{ id: string; friendly_name?: string | null; created_at: string }> = [];
  if (rt.mode === "supabase") {
    const sb = await supabaseForRequest();
    const { data } = (await sb?.auth.mfa.listFactors()) ?? { data: null };
    factors = (data?.totp ?? []).filter((f) => f.status === "verified");
  }
  const logins = await ctx.writer.audit_events.find({ actorId: actor.userId, action: ["user.login", "user.step_up", "user.step_up_failed"] }, { orderBy: "occurredAt", ascending: false, limit: 10 });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Two-step verification" description="Required to move money, change payment details, sign closing documents and export records." />
        <CardBody>
          {rt.mode === "supabase" ? (
            factors.length ? (
              <DefinitionList items={factors.map((f) => ({ term: f.friendly_name ?? "Authenticator app", value: `Added ${formatDateTime(f.created_at, "en")}` }))} />
            ) : (
              <MfaSetup />
            )
          ) : (
            <Alert tone="attention" title="Sandbox authenticator">
              This demo uses a shared sandbox authenticator; the current code is shown on the confirmation screen. With Supabase configured, each person enrolls their own authenticator app (TOTP) here, verified by Supabase Auth (AAL2).
            </Alert>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Recovery codes" />
        <CardBody>
          <RecoveryCodes remaining={codes.remaining} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Recent sign-in activity" description="If something looks unfamiliar, sign out other sessions and contact support." />
        <CardBody>
          <ul className="space-y-1.5 text-sm">
            {logins.map((l) => (
              <li key={l.id} className="flex justify-between gap-3">
                <span className={l.action === "user.step_up_failed" ? "text-danger" : "text-ink-2"}>
                  {l.action === "user.login" ? "Signed in" : l.action === "user.step_up" ? "Confirmed identity" : "Failed confirmation"}
                  {l.userAgent ? <span className="text-ink-3"> · {l.userAgent.slice(0, 60)}</span> : null}
                </span>
                <span className="shrink-0 text-ink-3">{formatDateTime(l.occurredAt, "en")}</span>
              </li>
            ))}
            {logins.length === 0 ? <li className="text-ink-3">No activity yet.</li> : null}
          </ul>
          {rt.mode === "supabase" ? (
            <div className="mt-4">
              <ActionButton action={signOutOtherSessions} variant="danger">
                Sign out all other sessions
              </ActionButton>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
