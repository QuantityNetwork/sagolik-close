import { Card, CardBody, Field, Input, Select, Textarea } from "@sagolik/ui";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { contactAction } from "@/app/actions/contact";
import { ActionForm, SubmitButton } from "@/components/forms";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/sections";

export const metadata: Metadata = { title: "Contact", description: "Book a demo, ask about access for your team, or reach our privacy and security contacts." };

const TOPICS = [
  ["demo", "Book a demo"],
  ["sales", "Plans for professionals and teams"],
  ["access", "Early access"],
  ["privacy", "Privacy or data request"],
  ["security", "Report a security issue"],
  ["other", "Something else"],
] as const;

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const sp = await searchParams;
  const topic = TOPICS.some(([k]) => k === sp.topic) ? sp.topic : "demo";
  return (
    <>
      <SiteHeader />
      <main id="main" className="container-page grid gap-10 py-14 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <p className="eyebrow">Contact</p>
          <h1 className="mt-3 text-[40px] leading-tight text-navy-800">Let's talk about your closings.</h1>
          <p className="mt-4 max-w-md text-[15px] text-ink-2">
            Tell us about your team or your purchase and a person — not a bot — will reply. For a data request (access, correction, deletion) signed-in users can also export their data directly from Settings → Privacy.
          </p>
          <p className="mt-6 flex max-w-md items-start gap-2 rounded-lg border border-line bg-paper p-4 text-[13px] text-ink-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden />
            We will never ask for passwords, one-time codes or bank details by email or phone. Wire instructions are only ever shown inside the verified Sagolik Close workspace.
          </p>
        </div>
        <Card>
          <CardBody className="p-6 sm:p-8">
            <ActionForm action={contactAction} resetOnSuccess className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Your name" htmlFor="name">
                  <Input id="name" name="name" required maxLength={120} autoComplete="name" />
                </Field>
                <Field label="Work email" htmlFor="email">
                  <Input id="email" name="email" type="email" required maxLength={254} autoComplete="email" />
                </Field>
              </div>
              <Field label="Organization (optional)" htmlFor="organization">
                <Input id="organization" name="organization" maxLength={160} autoComplete="organization" />
              </Field>
              <Field label="What can we help with?" htmlFor="topic">
                <Select id="topic" name="topic" defaultValue={topic}>
                  {TOPICS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Message" htmlFor="message" hint="Please don't include account numbers or identity documents.">
                <Textarea id="message" name="message" required minLength={10} maxLength={4000} rows={6} />
              </Field>
              <div aria-hidden className="absolute -left-[9999px]">
                <label htmlFor="website">Leave this empty</label>
                <input id="website" name="website" tabIndex={-1} autoComplete="off" />
              </div>
              <SubmitButton pendingLabel="Sending…" className="w-full sm:w-auto">
                Send message
              </SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </main>
      <SiteFooter />
    </>
  );
}
