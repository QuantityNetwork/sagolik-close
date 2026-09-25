/**
 * Shared adapter vocabulary. Business logic depends only on the interfaces
 * in this package — never on a vendor SDK.
 */
import { signWebhookPayload, verifyWebhookSignature } from "@sagolik/security";

export type ProviderMode = "mock" | "sandbox" | "production";

export interface ProviderInfo {
  /** Stable identifier persisted in the database, e.g. "plaid", "mock_banking". */
  id: string;
  displayName: string;
  mode: ProviderMode;
}

/**
 * All adapter failures are normalised to this. `userMessage` is written for
 * a person, never a stack trace or vendor code. Details go to logs only.
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly code: string,
    readonly userMessage: string,
    readonly opts: { retryable?: boolean; action?: "reconnect_bank" | "retry" | "contact_support"; cause?: unknown } = {},
  ) {
    super(`${provider}: ${code}`);
    this.name = "ProviderError";
  }
}

export interface NormalizedWebhook {
  externalEventId: string;
  eventType: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export interface WebhookCapable {
  /** Verify + parse a raw webhook. Throws (or rejects with) `WebhookRejectedError` when invalid. */
  parseWebhook(rawBody: string, headers: Headers): NormalizedWebhook | Promise<NormalizedWebhook>;
}

export class WebhookRejectedError extends Error {
  constructor(readonly reason: string) {
    super(`Webhook rejected: ${reason}`);
  }
}

/**
 * Where mock providers deliver their webhooks. In the web app this is wired
 * to the same `handleWebhook` pipeline real providers hit over HTTP, so the
 * signature → idempotency → mapping path is exercised end to end locally.
 */
export type WebhookSink = (providerId: string, rawBody: string, signatureHeader: string) => Promise<void>;

let sink: WebhookSink | null = null;
export function setMockWebhookSink(s: WebhookSink | null) {
  sink = s;
}

export const MOCK_SIGNATURE_HEADER = "x-sagolik-mock-signature";

/** Base for mock providers: signs and emits webhooks in the canonical format. */
export abstract class MockProviderBase implements WebhookCapable {
  abstract readonly info: ProviderInfo;
  constructor(protected readonly webhookSecret: string) {}

  protected async emit(eventType: string, data: Record<string, unknown>): Promise<NormalizedWebhook> {
    const event: NormalizedWebhook = {
      externalEventId: `evt_${crypto.randomUUID().replace(/-/g, "")}`,
      eventType,
      occurredAt: new Date().toISOString(),
      data,
    };
    const raw = JSON.stringify(event);
    if (sink) await sink(this.info.id, raw, signWebhookPayload(raw, this.webhookSecret));
    return event;
  }

  parseWebhook(rawBody: string, headers: Headers): NormalizedWebhook {
    const v = verifyWebhookSignature({ rawBody, header: headers.get(MOCK_SIGNATURE_HEADER), secret: this.webhookSecret });
    if (!v.ok) throw new WebhookRejectedError(v.reason);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new WebhookRejectedError("invalid_json");
    }
    const e = parsed as Partial<NormalizedWebhook>;
    if (typeof e.externalEventId !== "string" || typeof e.eventType !== "string" || typeof e.data !== "object" || e.data === null) {
      throw new WebhookRejectedError("schema");
    }
    return { externalEventId: e.externalEventId, eventType: e.eventType, occurredAt: String(e.occurredAt ?? new Date().toISOString()), data: e.data };
  }
}

export function randomRef(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
