import { listCalendar } from "@sagolik/core";
import { formatDateTime } from "@sagolik/i18n";
import { CALENDAR_EVENT_KINDS } from "@sagolik/types";
import { buttonClasses, Card, CardBody, CardHeader, EmptyState, Field, Input, Select } from "@sagolik/ui";
import { CalendarDays, Download } from "lucide-react";
import type { Metadata } from "next";
import { addCalendarEventAction } from "@/app/actions/transaction";
import { ActionForm, SubmitButton } from "@/components/forms";
import { loadTx } from "@/lib/server/tx";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, locale, can } = await loadTx(id);
  const { events } = await listCalendar(ctx, id);
  const now = new Date().toISOString();

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <Card>
        <CardHeader
          title="Dates and deadlines"
          description="Inspections, appraisals, deadlines, notary and closing appointments."
          action={
            <a href={`/api/v1/transactions/${id}/calendar`} className={buttonClasses("secondary", "sm")}>
              <Download className="h-3.5 w-3.5" aria-hidden /> Add to my calendar (.ics)
            </a>
          }
        />
        {events.length ? (
          <ul>
            {events.map((e) => (
              <li key={e.id} className={`flex items-start justify-between gap-3 border-b border-line px-5 py-3 last:border-b-0 ${e.startsAt < now ? "opacity-60" : ""}`}>
                <div>
                  <p className="font-medium text-ink">{e.title}</p>
                  <p className="text-[13px] text-ink-3">
                    {e.kind.replace(/_/g, " ")}
                    {e.location ? ` · ${e.location}` : ""}
                  </p>
                </div>
                <time className="shrink-0 text-sm text-ink-2 num" dateTime={e.startsAt}>
                  {formatDateTime(e.startsAt, locale)}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing scheduled yet" icon={<CalendarDays className="h-8 w-8" aria-hidden />} />
        )}
      </Card>
      {can("task.complete_own") ? (
        <Card className="h-fit">
          <CardHeader title="Schedule something" description="Everyone on the transaction sees it in the room." />
          <CardBody>
            <ActionForm action={addCalendarEventAction} className="space-y-3" resetOnSuccess>
              <input type="hidden" name="transactionId" value={id} />
              <Field label="What" htmlFor="title">
                <Input id="title" name="title" required minLength={2} maxLength={160} />
              </Field>
              <Field label="Type" htmlFor="kind">
                <Select id="kind" name="kind" defaultValue="other">
                  {CALENDAR_EVENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="When" htmlFor="startsAt">
                <Input id="startsAt" name="startsAt" type="datetime-local" required />
              </Field>
              <Field label="Where" htmlFor="location">
                <Input id="location" name="location" maxLength={200} />
              </Field>
              <SubmitButton>Add</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
