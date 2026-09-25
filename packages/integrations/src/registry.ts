/**
 * Provider registry. Chooses a real adapter when its credentials are present
 * and falls back to a clearly-labelled mock otherwise, so the whole platform
 * runs locally with zero keys.
 */
import type { Env } from "@sagolik/config";
import type { WebhookCapable } from "./common";
import { MockBankingProvider } from "./banking/mock";
import { PlaidBankingProvider } from "./banking/plaid";
import type { BankingProvider } from "./banking/provider";
import { MockEscrowProvider, type EscrowProvider } from "./escrow";
import { MockIdentityProvider, type IdentityProvider } from "./identity";
import { ManualInsuranceProvider, type InsuranceProvider } from "./insurance";
import { ManualMortgageProvider, type MortgageProvider } from "./mortgage";
import {
  type EmailProvider,
  OutboxEmailProvider,
  OutboxSmsProvider,
  ResendEmailProvider,
  type SmsProvider,
  TwilioSmsProvider,
} from "./notifications";
import { MockPaymentProvider, type PaymentProvider } from "./payments";
import { ManualPropertyProvider, type PropertyProvider } from "./property";
import { MockSignatureProvider, type SignatureProvider } from "./signatures";
import { ManualTitleProvider, type TitleProvider } from "./title";

export interface Providers {
  banking: BankingProvider;
  identity: IdentityProvider;
  signatures: SignatureProvider;
  payments: PaymentProvider;
  escrow: EscrowProvider;
  property: PropertyProvider;
  mortgage: MortgageProvider;
  title: TitleProvider;
  insurance: InsuranceProvider;
  email: EmailProvider;
  /** Delivers contact-form enquiries to the Sagolik team (real email whenever configured, even in demo mode). */
  contactEmail: EmailProvider;
  sms: SmsProvider;
  /** Every provider that can receive webhooks, keyed by provider id (the URL segment). */
  webhookReceivers: Map<string, WebhookCapable>;
  /** Present only when mocks are active — used by sandbox pages. */
  mocks: {
    banking?: MockBankingProvider;
    identity?: MockIdentityProvider;
    signatures?: MockSignatureProvider;
    payments?: MockPaymentProvider;
    escrow?: MockEscrowProvider;
  };
}

export function createProviders(env: Env): Providers {
  const secret = env.MOCK_WEBHOOK_SECRET;
  const mocks: Providers["mocks"] = {};

  let banking: BankingProvider;
  if (env.PLAID_CLIENT_ID && env.PLAID_SECRET) {
    banking = new PlaidBankingProvider({
      clientId: env.PLAID_CLIENT_ID,
      secret: env.PLAID_SECRET,
      env: env.PLAID_ENV,
      webhookUrl: `${env.APP_URL}/api/webhooks/plaid`,
    });
  } else {
    banking = mocks.banking = new MockBankingProvider(secret, env.APP_URL);
  }

  // Production identity / signature / payment / escrow adapters plug in here
  // behind the same interfaces once contracts are in place (docs/integrations.md).
  const identity = (mocks.identity = new MockIdentityProvider(secret, env.APP_URL));
  const signatures = (mocks.signatures = new MockSignatureProvider(secret, env.APP_URL));
  const payments = (mocks.payments = new MockPaymentProvider(secret));
  const escrow = (mocks.escrow = new MockEscrowProvider(secret));

  // Demo data belongs to fictional people: in demo mode transaction email/SMS never leave the outbox.
  // The contact form is the one exception — it reaches the real team whenever Resend is configured.
  const resend = env.RESEND_API_KEY ? new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM) : null;
  const email: EmailProvider = resend && !env.demoMode ? resend : new OutboxEmailProvider();
  const contactEmail: EmailProvider = resend ?? email;
  const sms: SmsProvider =
    !env.demoMode && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER
      ? new TwilioSmsProvider({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM_NUMBER })
      : new OutboxSmsProvider();

  if (env.APP_ENV === "production") {
    const sandboxed = Object.entries(mocks)
      // With the money service, bank connections go through it (and its own Plaid settings), not this adapter.
      .filter(([k, v]) => v && !(k === "banking" && env.MONEY_SERVICE_URL))
      .map(([k]) => k);
    if (sandboxed.length > 0) {
      // Regulated functions must never silently run on sandbox adapters in production.
      throw new Error(`Production requires real providers for: ${sandboxed.join(", ")}. See docs/integrations.md.`);
    }
  }

  const webhookReceivers = new Map<string, WebhookCapable>();
  for (const p of [banking, identity, signatures, payments, escrow] as Array<WebhookCapable & { info: { id: string } }>) {
    webhookReceivers.set(p.info.id, p);
  }

  return {
    banking,
    identity,
    signatures,
    payments,
    escrow,
    property: new ManualPropertyProvider(),
    mortgage: new ManualMortgageProvider(),
    title: new ManualTitleProvider(),
    insurance: new ManualInsuranceProvider(),
    email,
    contactEmail,
    sms,
    webhookReceivers,
    mocks,
  };
}
