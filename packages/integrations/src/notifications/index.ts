import { ProviderError, type ProviderInfo } from "../common";
import { globalSingleton } from "../singleton";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SmsMessage {
  to: string;
  /** Never include amounts, account numbers, addresses or document contents. */
  body: string;
}

export interface EmailProvider {
  readonly info: ProviderInfo;
  send(msg: EmailMessage): Promise<{ id: string }>;
}

export interface SmsProvider {
  readonly info: ProviderInfo;
  send(msg: SmsMessage): Promise<{ id: string }>;
}

/** Captures outgoing mail in memory (visible in the admin console's outbox in demo mode). */
export class OutboxEmailProvider implements EmailProvider {
  readonly info: ProviderInfo = { id: "outbox_email", displayName: "Local outbox (no email sent)", mode: "mock" };
  readonly sent = globalSingleton("mock_email_outbox", () => [] as Array<EmailMessage & { id: string; at: string }>);
  async send(msg: EmailMessage) {
    const id = `mail_${this.sent.length + 1}`;
    this.sent.unshift({ ...msg, id, at: new Date().toISOString() });
    this.sent.splice(200);
    return { id };
  }
}

export class OutboxSmsProvider implements SmsProvider {
  readonly info: ProviderInfo = { id: "outbox_sms", displayName: "Local outbox (no SMS sent)", mode: "mock" };
  readonly sent = globalSingleton("mock_sms_outbox", () => [] as Array<SmsMessage & { id: string; at: string }>);
  async send(msg: SmsMessage) {
    const id = `sms_${this.sent.length + 1}`;
    this.sent.unshift({ ...msg, id, at: new Date().toISOString() });
    this.sent.splice(200);
    return { id };
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly info: ProviderInfo = { id: "resend", displayName: "Resend", mode: "production" };
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(msg: EmailMessage) {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!res.ok) throw new ProviderError("resend", `HTTP_${res.status}`, "We couldn't send that email.", { retryable: res.status >= 500 });
    const json = (await res.json()) as { id: string };
    return { id: json.id };
  }
}

export class TwilioSmsProvider implements SmsProvider {
  readonly info: ProviderInfo = { id: "twilio", displayName: "Twilio", mode: "production" };
  constructor(
    private readonly cfg: { accountSid: string; authToken: string; from: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(msg: SmsMessage) {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid}/Messages.json`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: msg.to, From: this.cfg.from, Body: msg.body }),
    });
    if (!res.ok) throw new ProviderError("twilio", `HTTP_${res.status}`, "We couldn't send that text message.", { retryable: res.status >= 500 });
    const json = (await res.json()) as { sid: string };
    return { id: json.sid };
  }
}
