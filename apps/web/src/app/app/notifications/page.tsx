import { safeRedirectPath } from "@sagolik/security";
import { listNotifications, markNotificationRead } from "@sagolik/core";
import { formatRelative } from "@sagolik/i18n";
import { buttonClasses, Card, cn, EmptyState } from "@sagolik/ui";
import { Bell } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { markAllReadAction } from "@/app/actions/governance";
import { ActionButton } from "@/components/forms";
import { requireContext } from "@/lib/server/context";

export const metadata: Metadata = { title: "Notifications" };

async function openNotification(fd: FormData) {
  "use server";
  const { ctx } = await requireContext();
  const id = String(fd.get("id") ?? "");
  const link = String(fd.get("link") ?? "/app");
  await markNotificationRead(ctx, id).catch(() => undefined);
  redirect(safeRedirectPath(link));
}

export default async function NotificationsPage() {
  const { ctx } = await requireContext("/app/notifications");
  const items = await listNotifications(ctx, 100);
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <div className="container-page max-w-3xl animate-rise py-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] text-navy-800">Notifications</h1>
          <p className="text-sm text-ink-3">{unread} unread</p>
        </div>
        {unread ? (
          <ActionButton action={markAllReadAction} variant="secondary">
            Mark all as read
          </ActionButton>
        ) : null}
      </div>
      <Card className="mt-6">
        {items.length === 0 ? (
          <EmptyState title="You're all caught up" icon={<Bell className="h-8 w-8" aria-hidden />} />
        ) : (
          <ul>
            {items.map((n) => (
              <li key={n.id} className={cn("border-b border-line last:border-b-0", !n.readAt && "bg-teal-50/40")}>
                <form action={openNotification} className="flex items-start gap-3 px-5 py-4">
                  <input type="hidden" name="id" value={n.id} />
                  <input type="hidden" name="link" value={n.linkPath ?? "/app"} />
                  <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-teal-600")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", n.readAt ? "text-ink-2" : "font-semibold text-ink")}>{n.title}</p>
                    <p className="mt-0.5 text-[13px] text-ink-3">{n.body}</p>
                    <p className="mt-1 text-[12px] text-ink-4">{formatRelative(n.createdAt, "en")}</p>
                  </div>
                  <button type="submit" className={buttonClasses("ghost", "sm")}>
                    Open
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-4 text-sm text-ink-3">
        Choose what reaches you by email or text in{" "}
        <Link href="/app/settings/notifications" className="text-teal-700 hover:underline">
          notification settings
        </Link>
        .
      </p>
    </div>
  );
}
