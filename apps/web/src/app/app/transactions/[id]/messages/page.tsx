import { listThreads, markThreadRead } from "@sagolik/core";
import { formatDateTime } from "@sagolik/i18n";
import { Card, CardBody, CardHeader, cn, EmptyState, ParticipantAvatar, Textarea } from "@sagolik/ui";
import { Info, MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { sendMessageAction } from "@/app/actions/transaction";
import { ActionForm, SubmitButton } from "@/components/forms";
import { loadTx } from "@/lib/server/tx";

export const metadata: Metadata = { title: "Messages" };

const RELATED_LINK: Record<string, string> = { document: "documents", payment: "money", bank_instruction: "money", escrow_account: "money", escrow_condition: "money", mortgage: "mortgage", mortgage_condition: "mortgage", title_case: "title", title_issue: "title", recording: "closing", participant: "people", calendar_event: "calendar", transaction: "" };

export default async function MessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, snapshot: s, can, locale, actor } = await loadTx(id);
  const threads = await listThreads(ctx, id);
  const room = threads.find((t) => t.thread.kind === "transaction_room");
  if (room && room.unread) await markThreadRead(ctx, room.thread.id);
  const author = (uid: string | null) => s.participants.find((p) => p.userId === uid);

  return (
    <Card>
      <CardHeader title="Transaction room" description="Everyone on this transaction can read and post here. Automated notices link to what they're about." />
      <CardBody>
        {!room || room.messages.length === 0 ? (
          <EmptyState title="No messages yet" icon={<MessageSquare className="h-8 w-8" aria-hidden />} />
        ) : (
          <ol className="space-y-4" aria-label="Messages">
            {room.messages.map((m) => {
              if (m.kind === "system") {
                const tab = m.relatedEntityType ? RELATED_LINK[m.relatedEntityType] : undefined;
                return (
                  <li key={m.id} className="flex items-start gap-2.5 rounded-lg bg-canvas px-3 py-2 text-[13px] text-ink-2">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden />
                    <span className="flex-1">
                      {m.body}
                      {tab !== undefined ? (
                        <>
                          {" "}
                          <Link href={`/app/transactions/${id}${tab ? `/${tab}` : ""}`} className="font-medium text-teal-700 hover:underline">
                            View
                          </Link>
                        </>
                      ) : null}
                    </span>
                    <time className="shrink-0 text-[11px] text-ink-4" dateTime={m.createdAt}>
                      {formatDateTime(m.createdAt, locale)}
                    </time>
                  </li>
                );
              }
              const who = author(m.authorId);
              const mine = m.authorId === actor.userId;
              return (
                <li key={m.id} className={cn("flex gap-3", mine && "flex-row-reverse")}>
                  <ParticipantAvatar name={who?.displayName ?? "Participant"} size={32} />
                  <div className={cn("max-w-[75%] rounded-xl px-4 py-2.5", mine ? "bg-navy-800 text-white" : "border border-line bg-paper")}>
                    <p className={cn("text-[12px]", mine ? "text-white/70" : "text-ink-3")}>
                      {who?.displayName ?? "Participant"} · {formatDateTime(m.createdAt, locale)}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm">{m.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {room && can("message.send") ? (
          <ActionForm action={sendMessageAction} className="mt-6 space-y-2 border-t border-line pt-4" resetOnSuccess>
            <input type="hidden" name="transactionId" value={id} />
            <input type="hidden" name="threadId" value={room.thread.id} />
            <label htmlFor="body" className="sr-only">
              Message
            </label>
            <Textarea id="body" name="body" required maxLength={10000} placeholder="Write a message… Use @FirstName to mention someone." className="min-h-20" />
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] text-ink-3">Never share passwords, full account numbers or payment instructions in messages.</p>
              <SubmitButton>Send</SubmitButton>
            </div>
          </ActionForm>
        ) : null}
      </CardBody>
    </Card>
  );
}
