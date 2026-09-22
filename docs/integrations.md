# Integrations

Every external capability sits behind an interface in `packages/integrations`. `createProviders(env)` (in `registry.ts`) picks the real adapter when its credentials are configured, and a clearly labelled sandbox adapter when they are not. Each adapter reports `info.mode` (`production`, `sandbox` or `mock`). The admin console and `/api/health` show the mode.

**Production refuses to start** while identity, signatures, payments, escrow or banking are on sandbox adapters.

| Capability | Interface | Implemented adapters | Configure |
| --- | --- | --- | --- |
| Open banking | `BankingProvider` | **Plaid** (`plaid.ts`), sandbox bank (`mock.ts`, with an expiring-consent institution) | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_WEBHOOK_SECRET` |
| Identity / KYC | `IdentityProvider` | Sandbox (hosted page at `/sandbox/identity`) | — production adapter to be written (e.g. Persona, Onfido) |
| E-signature | `SignatureProvider` | Sandbox (ceremony at `/sandbox/sign`) | — production adapter to be written (e.g. DocuSign, Dropbox Sign) |
| Payments | `PaymentProvider` | Sandbox (advance a payment's status from the Money page in demo mode) | — production adapter to be written (e.g. Stripe Treasury, Modern Treasury) |
| Escrow | `EscrowProvider` | Sandbox | — partner escrow or title company API |
| Email | `EmailProvider` | **Resend**, local outbox | `RESEND_API_KEY`, `EMAIL_FROM` |
| SMS | `SmsProvider` | **Twilio**, local outbox | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Property, mortgage, title, insurance | `*Provider` | Manual: professionals enter data in the workspace | Feature flags `mortgage_integrations`, `title_integrations` |

## Webhooks

All providers post to `/api/webhooks/{providerId}`. The pipeline (`services/webhooks.ts`) runs these steps:

1. Rate limit per provider.
2. `provider.parseWebhook(raw, headers)` verifies the signature and timestamp, then normalizes the event into `{ externalEventId, type, data }`.
3. Insert into `webhook_events`, which is unique on (provider, external event id). A duplicate returns 200 and is not reprocessed.
4. Dispatch to the domain handler. Examples: `payment.*` → `handlePaymentEvent`; `envelope.completed` → store the signed copy, mark signatures complete, and reconcile the workflow.
5. On failure: status becomes `failed`. The worker retries with backoff, then moves the row to `dead_letter`. Operators can retry from `/admin`.

The sandbox adapters sign their webhooks with `MOCK_WEBHOOK_SECRET` and deliver them through this same pipeline, so demo mode exercises the production code path.

## Bank connections

Consent is always provider-hosted (Plaid Link, or the sandbox consent page). The flow:

- `connectBank` returns a redirect URL and a `state` value, which is bound to the user.
- The callback exchanges the code.
- The access token is stored encrypted in `bank_connection_secrets`, which only the service role can read.
- Accounts are stored masked. Ownership is verified by name matching against the profile.
- Expired or revoked consent moves the connection to `reauthentication_required` and notifies the owner.
