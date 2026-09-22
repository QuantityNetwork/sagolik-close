"use server";
import * as core from "@sagolik/core";
import type { FeatureFlagKey } from "@sagolik/config";
import type { ActionState } from "@/components/forms";
import { formString, runAction } from "@/lib/server/action";
import { requireContext } from "@/lib/server/context";

export async function exportAuditAction(transactionId: string): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const pkg = await core.exportAuditPackage(ctx, transactionId);
    return { data: pkg };
  });
}

export async function exportMyDataAction(): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    return { data: await core.exportMyData(ctx) };
  });
}

export async function updateProfileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    await core.updateProfile(ctx, { fullName: formString(fd, "fullName"), phone: formString(fd, "phone") ?? "", locale: formString(fd, "locale") ?? "en" });
    return { message: "Profile saved.", revalidate: ["/app"] };
  });
}

export async function regenerateRecoveryCodesAction(): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    return { data: await core.regenerateRecoveryCodes(ctx) };
  });
}

export async function setNotificationPreferenceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    await core.setNotificationPreference(ctx, formString(fd, "kind") as core.NotificationKind, {
      inApp: fd.get("inApp") === "on",
      email: fd.get("email") === "on",
      sms: fd.get("sms") === "on",
    });
    return { message: "Saved.", revalidate: ["/app/settings/notifications"] };
  });
}

export async function recordConsentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    await core.recordConsent(ctx, formString(fd, "purpose") ?? "", fd.get("granted") === "on", "2026-09");
    return { message: "Your choice has been recorded.", revalidate: ["/app/settings/privacy"] };
  });
}

export async function markAllReadAction(): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    await core.markAllNotificationsRead(ctx);
    return { revalidate: ["/app"] };
  });
}

export async function adminSetFlagAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    await core.adminSetFlag(ctx, formString(fd, "key") as FeatureFlagKey, fd.get("enabled") === "on", Number(formString(fd, "rolloutPercent") ?? "100"));
    return { message: "Flag updated.", revalidate: ["/admin"] };
  });
}

export async function adminRetryWebhookAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    await core.adminRetryWebhook(ctx, formString(fd, "webhookEventId") ?? "");
    const rt = await core.getRuntime();
    await core.retryFailedWebhooks(core.systemContext(rt, "admin_retry"));
    return { message: "Re-queued and retried.", revalidate: ["/admin"] };
  });
}
