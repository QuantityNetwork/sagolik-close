import { addOwnershipItem, getOwnershipBook, toAppError } from "@sagolik/core";
import { setUpAutopilotAction } from "@/app/actions/autopilot";
import { formatDate } from "@sagolik/i18n";
import { Card, CardBody, CardHeader, DefinitionList, Field, formatMoney, Input, Select } from "@sagolik/ui";
import { BadgeCheck, FileText, Hammer, Receipt, ShieldCheck, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, type ActionState, SubmitButton } from "@/components/forms";
import { formString, parseMoneyInput, runAction } from "@/lib/server/action";
import { requireContext } from "@/lib/server/context";

export const metadata: Metadata = { title: "Home Record" };

const ICONS = { signed_document: FileText, mortgage: BadgeCheck, insurance: ShieldCheck, warranty: ShieldCheck, renovation: Hammer, receipt: Receipt, maintenance: Wrench, tax: Receipt } as const;

async function addItem(_p: ActionState, fd: FormData): Promise<ActionState> {
  "use server";
  return runAction(async () => {
    const { ctx } = await requireContext();
    const recordId = formString(fd, "recordId") ?? "";
    await addOwnershipItem(ctx, recordId, { kind: formString(fd, "kind"), title: formString(fd, "title"), amount: parseMoneyInput(formString(fd, "amount")), occurredOn: formString(fd, "occurredOn") });
    return { message: "Added to your Home Record.", revalidate: [`/app/ownership/${recordId}`] };
  });
}

export default async function HomeRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, actor } = await requireContext(`/app/ownership/${id}`);
  let book;
  try {
    book = await getOwnershipBook(ctx, id);
  } catch (e) {
    if (toAppError(e).code === "not_found") notFound();
    throw e;
  }
  const { record, property, items, recording } = book;
  const isOwner = record.ownerUserIds.includes(actor.userId);
  const passport = isOwner ? await ctx.writer.property_passports.findOne({ ownershipRecordId: record.id }) : null;

  return (
    <div className="container-page animate-rise py-8">
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper">
        <div className="grid md:grid-cols-[1.2fr_1fr]">
          <div className="p-6 md:p-8">
            <p className="eyebrow text-teal-700">Home Record</p>
            <h1 className="mt-2 text-[38px] leading-tight text-navy-800">{property?.addressLine1}</h1>
            <p className="text-ink-3">{[property?.city, property?.region, property?.postalCode].filter(Boolean).join(", ")}</p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-success-50 px-3 py-1 text-sm font-medium text-success">
              <BadgeCheck className="h-4 w-4" aria-hidden /> Ownership recorded {recording?.recordingReference ? `· ref ${recording.recordingReference}` : ""}
            </p>
            <DefinitionList
              className="mt-6"
              items={[
                { term: "Owners", value: record.ownerNames.join(", ") },
                { term: "Purchase date", value: formatDate(record.purchaseDate, "en", { month: "long", day: "numeric", year: "numeric" }) },
                { term: "Purchase price", value: formatMoney(record.purchaseAmount, record.currency) },
                ...(recording?.registry ? [{ term: "Registry", value: recording.registry }] : []),
                ...(property?.bedrooms ? [{ term: "Home", value: `${property.bedrooms} bed · ${property.bathrooms} bath · ${property.livingArea?.toLocaleString("en-US")} ${property.areaUnit}` }] : []),
              ]}
            />
          </div>
          {property?.imageUrls[0] ? (
            <div className="relative min-h-64">
              <Image src={property.imageUrls[0]} alt={`Photo of ${property.addressLine1}`} fill sizes="(min-width: 768px) 45vw, 100vw" className="object-cover" />
            </div>
          ) : null}
        </div>
      </div>

      {isOwner ? (
        <Card className="mt-6 border-teal-100 bg-teal-50/40">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="font-medium text-navy-800">Property Autopilot</p>
              <p className="text-[13px] text-ink-2">
                {passport ? "Monitoring this home's costs, balances and due dates. Sagolik never pays or moves money." : "Keep this home running: Sagolik watches its costs and due dates and tells you what needs attention. It never pays or moves money."}
              </p>
            </div>
            {passport ? (
              <Link href={`/app/autopilot/${passport.id}`} className="text-sm font-medium text-navy-800 underline">
                Open Autopilot
              </Link>
            ) : (
              <ActionForm action={setUpAutopilotAction}>
                <input type="hidden" name="ownershipRecordId" value={record.id} />
                <SubmitButton pendingLabel="Preparing…">Set up Autopilot</SubmitButton>
              </ActionForm>
            )}
          </div>
        </Card>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Everything about your home, in one place" description="Signed closing documents, mortgage, insurance, warranties, renovations, receipts and tax records." />
          <ul>
            {items.map((i) => {
              const Icon = ICONS[i.kind];
              return (
                <li key={i.id} className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 last:border-b-0">
                  <span className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-50 text-navy-800">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-ink">{i.title}</span>
                      <span className="text-[12px] text-ink-3">
                        {i.kind.replace(/_/g, " ")}
                        {i.occurredOn ? ` · ${formatDate(i.occurredOn, "en", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                        {i.amount !== null ? ` · ${formatMoney(i.amount, record.currency)}` : ""}
                      </span>
                    </span>
                  </span>
                  {i.documentId ? (
                    <a href={`/api/v1/documents/${i.documentId}/download`} className="text-sm font-medium text-teal-700 hover:underline">
                      Download
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
        {isOwner ? (
          <Card className="h-fit">
            <CardHeader title="Add to your record" description="Keep warranties, renovations and receipts with your home." />
            <CardBody>
              <ActionForm action={addItem} className="space-y-3" resetOnSuccess>
                <input type="hidden" name="recordId" value={record.id} />
                <Field label="Type" htmlFor="kind">
                  <Select id="kind" name="kind" defaultValue="renovation">
                    {["renovation", "receipt", "warranty", "maintenance", "insurance", "tax"].map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Description" htmlFor="title">
                  <Input id="title" name="title" required minLength={2} maxLength={200} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`Amount (${record.currency})`} htmlFor="amount">
                    <Input id="amount" name="amount" inputMode="decimal" />
                  </Field>
                  <Field label="Date" htmlFor="occurredOn">
                    <Input id="occurredOn" name="occurredOn" type="date" />
                  </Field>
                </div>
                <SubmitButton>Add</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
      </div>
      <p className="mt-6 text-sm text-ink-3">
        This record came from your closing on{" "}
        <Link href={`/app/transactions/${record.transactionId}`} className="text-teal-700 hover:underline">
          {property?.addressLine1}
        </Link>
        .
      </p>
    </div>
  );
}
