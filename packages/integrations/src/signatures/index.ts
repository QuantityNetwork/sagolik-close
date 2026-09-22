import type { SignatureStatus } from "@sagolik/types";
import { MockProviderBase, ProviderError, randomRef, type ProviderInfo, type WebhookCapable } from "../common";
import { globalSingleton } from "../singleton";

export interface EnvelopeRecipient {
  recipientId: string; // our participant id
  name: string;
  email: string;
  routingOrder: number;
}

export interface SignatureField {
  recipientId: string;
  page: number;
  x: number;
  y: number;
  kind: "signature" | "initials" | "date";
}

export interface EnvelopeStatus {
  externalEnvelopeId: string;
  status: SignatureStatus;
  recipients: Array<{ recipientId: string; status: SignatureStatus; signedAt: string | null }>;
}

/**
 * Electronic-signature provider. Sagolik owns the document and the audit
 * trail; the provider performs the legally-binding signing ceremony and
 * returns a completion certificate we store alongside the signed version.
 *
 * Candidate production adapters: DocuSign, Dropbox Sign, Adobe Acrobat Sign, SignNow.
 */
export interface SignatureProvider extends WebhookCapable {
  readonly info: ProviderInfo;
  createEnvelope(opts: { documentName: string; documentSha256: string; message?: string }): Promise<{ externalEnvelopeId: string }>;
  addRecipients(externalEnvelopeId: string, recipients: EnvelopeRecipient[]): Promise<void>;
  addFields(externalEnvelopeId: string, fields: SignatureField[]): Promise<void>;
  send(externalEnvelopeId: string): Promise<void>;
  getStatus(externalEnvelopeId: string): Promise<EnvelopeStatus>;
  /** URL for an embedded/hosted signing session for one recipient. */
  signingUrl(externalEnvelopeId: string, recipientId: string, returnUrl: string): Promise<string>;
  downloadCompletedDocument(externalEnvelopeId: string): Promise<{ bytes: Uint8Array; certificate: Uint8Array }>;
}

interface MockEnvelope {
  id: string;
  documentName: string;
  documentSha256: string;
  status: SignatureStatus;
  recipients: Array<EnvelopeRecipient & { status: SignatureStatus; signedAt: string | null }>;
  fields: SignatureField[];
}

export class MockSignatureProvider extends MockProviderBase implements SignatureProvider {
  readonly info: ProviderInfo = { id: "mock_signature", displayName: "Sandbox eSign", mode: "mock" };
  private envelopes = globalSingleton("mock_envelopes", () => new Map<string, MockEnvelope>());

  constructor(
    webhookSecret: string,
    private readonly appUrl: string,
  ) {
    super(webhookSecret);
  }

  private env(id: string) {
    const e = this.envelopes.get(id);
    if (!e) throw new ProviderError(this.info.id, "ENVELOPE_NOT_FOUND", "We couldn't find that signing request.");
    return e;
  }

  async createEnvelope(opts: { documentName: string; documentSha256: string }) {
    const id = randomRef("env");
    this.envelopes.set(id, { id, documentName: opts.documentName, documentSha256: opts.documentSha256, status: "draft", recipients: [], fields: [] });
    return { externalEnvelopeId: id };
  }

  async addRecipients(id: string, recipients: EnvelopeRecipient[]) {
    const e = this.env(id);
    e.recipients.push(...recipients.map((r) => ({ ...r, status: "draft" as SignatureStatus, signedAt: null })));
  }

  async addFields(id: string, fields: SignatureField[]) {
    this.env(id).fields.push(...fields);
  }

  async send(id: string) {
    const e = this.env(id);
    if (e.recipients.length === 0) throw new ProviderError(this.info.id, "NO_RECIPIENTS", "Add at least one signer before sending.");
    e.status = "sent";
    for (const r of e.recipients) r.status = "sent";
    await this.emit("envelope.sent", { externalEnvelopeId: id });
  }

  async getStatus(id: string): Promise<EnvelopeStatus> {
    const e = this.env(id);
    return { externalEnvelopeId: id, status: e.status, recipients: e.recipients.map((r) => ({ recipientId: r.recipientId, status: r.status, signedAt: r.signedAt })) };
  }

  async signingUrl(id: string, recipientId: string, returnUrl: string) {
    this.env(id);
    const url = new URL("/sandbox/sign", this.appUrl);
    url.searchParams.set("envelope", id);
    url.searchParams.set("recipient", recipientId);
    url.searchParams.set("return_url", returnUrl);
    return url.toString();
  }

  envelope(id: string) {
    return this.envelopes.get(id) ?? null;
  }

  /** Restore sandbox envelope state from persisted signature records (after a restart or for seeded demo data). */
  hydrate(e: { id: string; documentName: string; documentSha256: string; status: SignatureStatus; recipients: Array<EnvelopeRecipient & { status: SignatureStatus; signedAt: string | null }> }) {
    if (this.envelopes.has(e.id)) return;
    this.envelopes.set(e.id, { ...e, fields: [] });
  }

  /** Sandbox signing ceremony. Emits signed webhooks exactly like a provider would. */
  async act(id: string, recipientId: string, action: "sign" | "decline") {
    const e = this.env(id);
    const r = e.recipients.find((x) => x.recipientId === recipientId);
    if (!r) throw new ProviderError(this.info.id, "RECIPIENT_NOT_FOUND", "You're not a signer on this document.");
    if (r.status === "signed") return;
    if (action === "decline") {
      r.status = "declined";
      e.status = "declined";
      await this.emit("envelope.declined", { externalEnvelopeId: id, recipientId });
      return;
    }
    r.status = "signed";
    r.signedAt = new Date().toISOString();
    await this.emit("recipient.signed", { externalEnvelopeId: id, recipientId, signedAt: r.signedAt });
    if (e.recipients.every((x) => x.status === "signed")) {
      e.status = "completed";
      await this.emit("envelope.completed", { externalEnvelopeId: id });
    } else {
      e.status = "viewed";
    }
  }

  async downloadCompletedDocument(id: string) {
    const e = this.env(id);
    if (e.status !== "completed") throw new ProviderError(this.info.id, "NOT_COMPLETED", "This document isn't fully signed yet.");
    const lines = [
      "%PDF-1.4",
      `% Sandbox signed copy of ${e.documentName}`,
      `% Original SHA-256 ${e.documentSha256}`,
      ...e.recipients.map((r) => `% Signed by ${r.name} <${r.email}> at ${r.signedAt}`),
      "%%EOF",
    ];
    const certificate = [
      "%PDF-1.4",
      `% SANDBOX CERTIFICATE OF COMPLETION — envelope ${e.id}`,
      ...e.recipients.map((r) => `% ${r.name}: signed ${r.signedAt}`),
      "%%EOF",
    ];
    return { bytes: new TextEncoder().encode(lines.join("\n")), certificate: new TextEncoder().encode(certificate.join("\n")) };
  }
}
