import type { Currency, PaymentRail, PaymentStatus } from "@sagolik/types";
import { MockProviderBase, ProviderError, randomRef, type ProviderInfo, type WebhookCapable } from "../common";
import { globalSingleton } from "../singleton";

export interface CreatePaymentRequest {
  idempotencyKey: string;
  amount: number; // minor units
  currency: Currency;
  rail: PaymentRail;
  reference: string;
  /** Provider-side reference to the payer account (from the banking provider). */
  fromExternalAccountId: string;
  /** Beneficiary details — decrypted server-side only for this call. */
  beneficiary: { name: string; accountNumber: string; routingIdentifier: string; bankName: string };
}

/**
 * Money movement (ACH, wire, FedNow/RTP via partner banks, SEPA/SEPA Instant,
 * open-banking payment initiation).
 *
 * SETTLEMENT IS NEVER ASSUMED. `createPayment` only returns an initial state;
 * `settled` is recorded exclusively from a verified provider webhook.
 */
export interface PaymentProvider extends WebhookCapable {
  readonly info: ProviderInfo;
  readonly supportedRails: readonly PaymentRail[];
  createPayment(req: CreatePaymentRequest): Promise<{ externalPaymentId: string; status: PaymentStatus; authorizationUrl: string | null }>;
  getPaymentStatus(externalPaymentId: string): Promise<{ status: PaymentStatus; failureReason: string | null }>;
  cancelPayment(externalPaymentId: string): Promise<void>;
}

interface MockPayment {
  id: string;
  idempotencyKey: string;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  failureReason: string | null;
}

/**
 * Sandbox rails. `advance()` walks a payment through its lifecycle and emits
 * signed webhooks for each step — the only way a sandbox payment settles.
 */
export class MockPaymentProvider extends MockProviderBase implements PaymentProvider {
  readonly info: ProviderInfo = { id: "mock_payments", displayName: "Sandbox Payments", mode: "mock" };
  readonly supportedRails = ["ach", "wire", "fednow", "rtp", "sepa", "sepa_instant", "open_banking"] as const;
  private payments = globalSingleton("mock_payments", () => new Map<string, MockPayment>());

  async createPayment(req: CreatePaymentRequest) {
    if (!(this.supportedRails as readonly string[]).includes(req.rail)) {
      throw new ProviderError(this.info.id, "RAIL_UNSUPPORTED", "That payment method isn't available for this transaction.");
    }
    const existing = [...this.payments.values()].find((p) => p.idempotencyKey === req.idempotencyKey);
    if (existing) return { externalPaymentId: existing.id, status: existing.status, authorizationUrl: null };
    const id = randomRef("pay");
    this.payments.set(id, { id, idempotencyKey: req.idempotencyKey, amount: req.amount, currency: req.currency, status: "initiated", failureReason: null });
    // The initial status is returned synchronously; later changes arrive by webhook.
    return { externalPaymentId: id, status: "initiated" as PaymentStatus, authorizationUrl: null };
  }

  payment(id: string) {
    return this.payments.get(id) ?? null;
  }

  /** Restore sandbox payment state from persisted payments (after a restart). */
  hydrate(p: { id: string; idempotencyKey: string; amount: number; currency: Currency; status: PaymentStatus }) {
    if (!this.payments.has(p.id)) this.payments.set(p.id, { ...p, failureReason: null });
  }

  /** Sandbox control: move a payment to the next rail state (or fail it). */
  async advance(id: string, outcome: "next" | "fail" | "return" = "next") {
    const p = this.payments.get(id);
    if (!p) throw new ProviderError(this.info.id, "NOT_FOUND", "We couldn't find that payment.");
    const order: PaymentStatus[] = ["initiated", "processing", "received", "settled"];
    if (outcome === "fail") {
      p.status = "failed";
      p.failureReason = "The sending bank rejected the transfer.";
    } else if (outcome === "return") {
      p.status = "returned";
      p.failureReason = "The transfer was returned by the receiving bank.";
    } else {
      const i = order.indexOf(p.status);
      if (i === -1 || i === order.length - 1) return p;
      p.status = order[i + 1]!;
    }
    await this.emit("payment.status_changed", { externalPaymentId: id, status: p.status, failureReason: p.failureReason });
    return p;
  }

  async getPaymentStatus(id: string) {
    const p = this.payments.get(id);
    if (!p) throw new ProviderError(this.info.id, "NOT_FOUND", "We couldn't find that payment.");
    return { status: p.status, failureReason: p.failureReason };
  }

  async cancelPayment(id: string) {
    const p = this.payments.get(id);
    if (!p) return;
    if (["settled", "received"].includes(p.status)) {
      throw new ProviderError(this.info.id, "NOT_CANCELLABLE", "This transfer can no longer be cancelled.");
    }
    p.status = "cancelled";
    await this.emit("payment.status_changed", { externalPaymentId: id, status: "cancelled" });
  }
}
