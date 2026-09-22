import { getNotificationPreferences } from "@sagolik/core";
import { Card, CardHeader } from "@sagolik/ui";
import type { Metadata } from "next";
import { setNotificationPreferenceAction } from "@/app/actions/governance";
import { ActionForm, SubmitButton } from "@/components/forms";
import { requireContext } from "@/lib/server/context";

export const metadata: Metadata = { title: "Notification settings" };

export default async function NotificationSettings() {
  const { ctx } = await requireContext("/app/settings/notifications");
  const prefs = await getNotificationPreferences(ctx);
  return (
    <Card>
      <CardHeader title="What reaches you, and where" description="Security notices about payment instructions always appear in the app. Text messages never include sensitive details." />
      <ul>
        {prefs.map((p) => (
          <li key={p.kind} className="border-b border-line px-5 py-3 last:border-b-0">
            <ActionForm action={setNotificationPreferenceAction} className="flex flex-wrap items-center justify-between gap-3" showSuccess={false}>
              <input type="hidden" name="kind" value={p.kind} />
              <span className="text-sm text-ink">{p.label}</span>
              <span className="flex items-center gap-4 text-[13px] text-ink-2">
                {(["inApp", "email", "sms"] as const).map((ch) => (
                  <label key={ch} className="flex items-center gap-1.5">
                    <input type="checkbox" name={ch} defaultChecked={p[ch]} className="accent-navy-800" />
                    {ch === "inApp" ? "In app" : ch === "email" ? "Email" : "Text"}
                  </label>
                ))}
                <SubmitButton size="sm" variant="ghost">
                  Save
                </SubmitButton>
              </span>
            </ActionForm>
          </li>
        ))}
      </ul>
    </Card>
  );
}
