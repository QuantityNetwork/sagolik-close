/**
 * Notifications across in-app, email and SMS, honouring each person's
 * preferences. SMS never carries sensitive content — only a nudge to open
 * the app.
 */
import type { NotificationPreference } from "@sagolik/types";
import { type ServiceContext, requireUser } from "../context";
import { notFound } from "../errors";
import { newId, nowIso } from "../util";

export const NOTIFICATION_KINDS = {
  signature_requested: { label: "A document needs your signature", sensitive: false, defaultSms: true },
  identity_incomplete: { label: "Identity verification reminders", sensitive: false, defaultSms: false },
  deadline_approaching: { label: "Upcoming deadlines", sensitive: false, defaultSms: true },
  bank_reconnect: { label: "Bank connection needs attention", sensitive: false, defaultSms: false },
  funds_received: { label: "Money received or settled", sensitive: true, defaultSms: false },
  title_issue: { label: "Title issues", sensitive: true, defaultSms: false },
  closing_date_changed: { label: "Closing date changes", sensitive: false, defaultSms: true },
  payment_instructions_changed: { label: "Payment instruction changes (security)", sensitive: true, defaultSms: true },
  ownership_transferred: { label: "Ownership transferred", sensitive: false, defaultSms: true },
  status_update: { label: "Transaction progress updates", sensitive: false, defaultSms: false },
  message_mention: { label: "Mentions in messages", sensitive: false, defaultSms: false },
  task_assigned: { label: "New tasks for you", sensitive: false, defaultSms: false },
  autopilot_live: { label: "Property Autopilot set up", sensitive: false, defaultSms: false },
  autopilot_attention: { label: "Property Autopilot: something needs your attention", sensitive: true, defaultSms: false },
  autopilot_urgent: { label: "Property Autopilot: urgent (unusual bills, overdue, shortfalls)", sensitive: true, defaultSms: true },
} as const;
export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

export interface NotifyInput {
  userIds: string[];
  transactionId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  linkPath: string | null;
}

async function preferenceFor(ctx: ServiceContext, userId: string, kind: NotificationKind): Promise<Pick<NotificationPreference, "inApp" | "email" | "sms">> {
  const p = await ctx.writer.notification_preferences.findOne({ userId, kind });
  return p ?? { inApp: true, email: true, sms: NOTIFICATION_KINDS[kind].defaultSms };
}

export async function notify(ctx: ServiceContext, input: NotifyInput): Promise<void> {
  const created = nowIso(ctx);
  for (const userId of [...new Set(input.userIds)]) {
    const pref = await preferenceFor(ctx, userId, input.kind);
    // Security notices are always delivered in-app regardless of preference.
    if (pref.inApp || input.kind === "payment_instructions_changed") {
      await ctx.writer.notifications.insert({
        id: newId(),
        userId,
        transactionId: input.transactionId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        linkPath: input.linkPath,
        channel: "in_app",
        readAt: null,
        sentAt: created,
        createdAt: created,
      });
    }
    const profile = await ctx.writer.profiles.get(userId);
    if (!profile) continue;
    const link = input.linkPath ? new URL(input.linkPath, ctx.env.APP_URL).toString() : ctx.env.APP_URL;
    if (pref.email) {
      try {
        await ctx.providers.email.send({
          to: profile.email,
          subject: input.title,
          text: `${input.body}\n\nOpen Sagolik Close: ${link}\n\nYou can change which emails you receive in Settings → Notifications.`,
        });
      } catch (e) {
        ctx.log.warn("email delivery failed", { kind: input.kind, error: String(e), correlationId: ctx.correlationId });
      }
    }
    if (pref.sms && profile.phone) {
      // Never include amounts, account numbers, addresses or document contents in SMS.
      const body = NOTIFICATION_KINDS[input.kind].sensitive
        ? "Sagolik Close: there's an important update on your closing. Please sign in to review it."
        : `Sagolik Close: ${input.title}. Sign in to view.`;
      try {
        await ctx.providers.sms.send({ to: profile.phone, body });
      } catch (e) {
        ctx.log.warn("sms delivery failed", { kind: input.kind, error: String(e), correlationId: ctx.correlationId });
      }
    }
  }
}

export async function listNotifications(ctx: ServiceContext, limit = 50) {
  const actor = requireUser(ctx);
  return ctx.db.notifications.find({ userId: actor.userId }, { orderBy: "createdAt", ascending: false, limit });
}

export async function markNotificationRead(ctx: ServiceContext, id: string) {
  const actor = requireUser(ctx);
  const n = await ctx.db.notifications.get(id);
  if (!n || n.userId !== actor.userId) throw notFound("That notification");
  if (!n.readAt) await ctx.writer.notifications.update(id, { readAt: nowIso(ctx) });
}

export async function markAllNotificationsRead(ctx: ServiceContext) {
  const actor = requireUser(ctx);
  for (const n of await ctx.db.notifications.find({ userId: actor.userId, readAt: null })) {
    await ctx.writer.notifications.update(n.id, { readAt: nowIso(ctx) });
  }
}

export async function getNotificationPreferences(ctx: ServiceContext) {
  const actor = requireUser(ctx);
  const rows = await ctx.db.notification_preferences.find({ userId: actor.userId });
  return (Object.keys(NOTIFICATION_KINDS) as NotificationKind[]).map((kind) => {
    const row = rows.find((r) => r.kind === kind);
    return {
      kind,
      label: NOTIFICATION_KINDS[kind].label,
      sensitive: NOTIFICATION_KINDS[kind].sensitive,
      inApp: row?.inApp ?? true,
      email: row?.email ?? true,
      sms: row?.sms ?? NOTIFICATION_KINDS[kind].defaultSms,
    };
  });
}

export async function setNotificationPreference(ctx: ServiceContext, kind: NotificationKind, value: { inApp: boolean; email: boolean; sms: boolean }) {
  const actor = requireUser(ctx);
  if (!(kind in NOTIFICATION_KINDS)) throw notFound("That notification type");
  const existing = await ctx.writer.notification_preferences.findOne({ userId: actor.userId, kind });
  if (existing) await ctx.writer.notification_preferences.update(existing.id, value);
  else
    await ctx.writer.notification_preferences.insert({
      id: newId(),
      userId: actor.userId,
      kind,
      ...value,
      createdAt: nowIso(ctx),
      updatedAt: nowIso(ctx),
    });
}

/** User ids of active participants with the given roles (or all). */
export function participantUserIds(
  participants: Array<{ userId: string | null; role: string; status: string }>,
  roles?: string[],
): string[] {
  return participants
    .filter((p) => p.userId && p.status !== "removed" && p.status !== "declined" && (!roles || roles.includes(p.role)))
    .map((p) => p.userId!);
}
