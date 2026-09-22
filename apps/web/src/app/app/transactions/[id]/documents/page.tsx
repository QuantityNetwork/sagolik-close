import { listDocuments, ROLE_LABELS, signatureStatusLabel } from "@sagolik/core";
import { formatDate, formatDateTime } from "@sagolik/i18n";
import { DOCUMENT_CATEGORIES, type SignatureStatus } from "@sagolik/types";
import { Alert, Card, CardBody, CardHeader, EmptyState, Field, Input, Select, StatusBadge, type Tone } from "@sagolik/ui";
import { Download, FileText, Lock, PenLine, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { requestSignaturesAction, reviewDocumentAction, startSigningAction, uploadDocumentAction } from "@/app/actions/transaction";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { loadTx } from "@/lib/server/tx";

export const metadata: Metadata = { title: "Documents" };

const SIG_TONE: Record<SignatureStatus, Tone> = { not_required: "neutral", draft: "neutral", sent: "attention", viewed: "attention", signed: "attention", declined: "blocked", expired: "blocked", completed: "done" };
const STATUS_TONE = { processing: "neutral", pending_review: "progress", needs_attention: "attention", approved: "done", rejected: "blocked", superseded: "stopped" } as const;
const STATUS_LABEL = { processing: "Processing", pending_review: "Awaiting review", needs_attention: "Needs attention", approved: "Approved", rejected: "Rejected", superseded: "Superseded" } as const;
const ACCESS_LABEL = { all_participants: "Everyone on the file", principals_and_professionals: "Principals and professionals", professionals_only: "Professionals only", restricted: "Restricted" } as const;
const human = (c: string) => c.replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase());

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ signed?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, snapshot: s, can, locale, actor } = await loadTx(id);
  const { documents } = await listDocuments(ctx, id);
  const mine = new Set(s.participants.filter((p) => p.userId === actor.userId).map((p) => p.id));
  const signers = s.participants.filter((p) => p.status !== "removed");

  return (
    <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
      <div className="space-y-4">
        {sp.signed ? (
          <Alert tone="done" title="Thank you — your signature has been recorded.">
            The signed copy is saved as a new version once every signer has finished.
          </Alert>
        ) : null}
        {documents.length === 0 ? (
          <Card>
            <EmptyState title="No documents yet" icon={<FileText className="h-8 w-8" aria-hidden />}>
              Documents uploaded by any party appear here, with every version kept.
            </EmptyState>
          </Card>
        ) : null}
        {documents.map(({ document: d, versions }) => {
          const current = versions.find((v) => v.version === d.currentVersion);
          const sig = s.signatures.filter((x) => x.documentId === d.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          const myRecipient = sig?.recipients.find((r) => mine.has(r.participantId) && r.status !== "signed" && r.status !== "completed");
          const suggestions = current?.extractedFields.filter((f) => !f.verified) ?? [];
          return (
            <Card key={d.id} id={`doc-${d.id}`} className="scroll-mt-24">
              <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-800">
                    <FileText className="h-4.5 w-4.5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {d.name} <span className="text-[12px] font-normal text-ink-3">v{d.currentVersion}</span>
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                      <span>{human(d.category)}</span>
                      <StatusBadge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</StatusBadge>
                      {d.signatureStatus !== "not_required" ? <StatusBadge tone={SIG_TONE[d.signatureStatus]}>{signatureStatusLabel(d.signatureStatus)}</StatusBadge> : null}
                      {d.accessLevel !== "all_participants" ? (
                        <span className="inline-flex items-center gap-1">
                          <Lock className="h-3 w-3" aria-hidden />
                          {ACCESS_LABEL[d.accessLevel]}
                        </span>
                      ) : null}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {myRecipient && sig ? (
                    <ActionForm action={startSigningAction}>
                      <input type="hidden" name="transactionId" value={id} />
                      <input type="hidden" name="signatureId" value={sig.id} />
                      <SubmitButton size="sm" pendingLabel="Opening…">
                        <PenLine className="h-3.5 w-3.5" aria-hidden /> Review &amp; sign
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                  <a href={`/api/v1/documents/${d.id}/download?inline=1`} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] text-navy-800 ring-1 ring-inset ring-line-strong hover:bg-sand">
                    Preview
                  </a>
                  <a href={`/api/v1/documents/${d.id}/download`} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] text-navy-800 ring-1 ring-inset ring-line-strong hover:bg-sand" aria-label={`Download ${d.name}`}>
                    <Download className="h-3.5 w-3.5" aria-hidden /> Download
                  </a>
                </div>
              </div>

              {sig ? (
                <div className="border-t border-line px-5 py-3 text-[13px]">
                  <p className="text-ink-3">Signers</p>
                  <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {sig.recipients.map((r) => (
                      <li key={r.participantId} className="text-ink-2">
                        {r.name}: <span className={r.status === "signed" || r.status === "completed" ? "text-success" : "text-attention"}>{r.status === "signed" || r.status === "completed" ? `signed ${r.signedAt ? formatDate(r.signedAt, locale) : ""}` : r.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {suggestions.length ? (
                <div className="border-t border-line px-5 py-3 text-[13px]">
                  <p className="text-ink-3">Suggested details (unverified — confirm against the document)</p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {suggestions.map((f, i) => (
                      <li key={i} className="rounded-md bg-canvas px-2 py-0.5 text-ink-2">
                        {f.key.replace(/_/g, " ")}: <span className="font-medium">{f.value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <details className="border-t border-line px-5 py-3">
                <summary className="cursor-pointer text-[13px] font-medium text-ink-2">Versions &amp; actions</summary>
                <ul className="mt-2 space-y-1 text-[12.5px]">
                  {versions.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-ink-2">
                        v{v.version} {v.isSigned ? <span className="inline-flex items-center gap-1 text-success"><ShieldCheck className="h-3 w-3" aria-hidden /> signed</span> : null} · {formatDateTime(v.createdAt, locale)} · {(v.sizeBytes / 1024).toFixed(0)} KB
                      </span>
                      <span className="flex items-center gap-3">
                        <code className="text-[11px] text-ink-3" title="SHA-256">
                          {v.sha256.slice(0, 12)}…
                        </code>
                        <a className="text-teal-700 hover:underline" href={`/api/v1/documents/${d.id}/download?version=${v.version}`}>
                          Download
                        </a>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {can("document.approve") && d.status !== "approved" ? (
                    <div className="flex flex-wrap gap-2">
                      <ActionButton action={reviewDocumentAction} fields={{ transactionId: id, documentId: d.id, decision: "approved" }} variant="primary">
                        Approve
                      </ActionButton>
                      <ActionButton action={reviewDocumentAction} fields={{ transactionId: id, documentId: d.id, decision: "needs_attention" }}>
                        Flag for attention
                      </ActionButton>
                    </div>
                  ) : null}
                  {can("signature.request") && !["sent", "viewed", "signed", "completed"].includes(d.signatureStatus) ? (
                    <ActionForm action={requestSignaturesAction} className="space-y-2">
                      <input type="hidden" name="transactionId" value={id} />
                      <input type="hidden" name="documentId" value={d.id} />
                      <fieldset>
                        <legend className="text-[13px] font-medium text-ink-2">Request signatures from</legend>
                        <div className="mt-1 grid gap-1">
                          {signers.map((p) => (
                            <label key={p.id} className="flex items-center gap-2 text-[13px] text-ink-2">
                              <input type="checkbox" name="signers" value={p.id} className="accent-navy-800" /> {p.displayName} <span className="text-ink-3">({ROLE_LABELS[p.role]})</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <SubmitButton size="sm" variant="secondary">
                        Send for signature
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                  {can("document.upload") && d.signatureStatus !== "completed" ? (
                    <ActionForm action={uploadDocumentAction} className="space-y-2" resetOnSuccess>
                      <input type="hidden" name="transactionId" value={id} />
                      <input type="hidden" name="documentId" value={d.id} />
                      <input type="hidden" name="category" value={d.category} />
                      <input type="hidden" name="name" value={d.name} />
                      <Field label="Upload a new version" htmlFor={`v-${d.id}`}>
                        <Input id={`v-${d.id}`} name="file" type="file" required accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.heic" className="h-auto py-1.5" />
                      </Field>
                      <SubmitButton size="sm" variant="secondary">
                        Upload version
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                </div>
              </details>
            </Card>
          );
        })}
      </div>

      {can("document.upload") ? (
        <Card className="h-fit">
          <CardHeader title="Upload a document" description="PDF, Word, PNG, JPEG, WebP or HEIC · up to 25 MB. Files are scanned, type-checked and hashed before they're stored." />
          <CardBody>
            <ActionForm action={uploadDocumentAction} className="space-y-3" resetOnSuccess>
              <input type="hidden" name="transactionId" value={id} />
              <Field label="File" htmlFor="file">
                <Input id="file" name="file" type="file" required accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.heic" className="h-auto py-1.5" />
              </Field>
              <Field label="Name" htmlFor="name" hint="Defaults to the file name.">
                <Input id="name" name="name" maxLength={200} />
              </Field>
              <Field label="Category" htmlFor="category">
                <Select id="category" name="category" defaultValue="other">
                  {DOCUMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {human(c)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Who can see it" htmlFor="accessLevel" hint="ID documents are always restricted.">
                <Select id="accessLevel" name="accessLevel" defaultValue="all_participants">
                  {Object.entries(ACCESS_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <SubmitButton pendingLabel="Uploading…">Upload</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
