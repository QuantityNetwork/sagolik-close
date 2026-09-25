# Integrations

Every external capability sits behind an interface. Adapters marked **bold** below are written against the provider's documented API but have **not yet been exercised against a live account**; treat them as untested until a sandbox run is recorded here.

Every external capability sits behind an interface in `packages/integrations`. `createProviders(env)` (in `registry.ts`) picks the real adapter when its credentials are configured, and a clearly labelled sandbox adapter when they are not. Each adapter reports `info.mode` (`production`, `sandbox` or `mock`). The admin console and `/api/health` show the mode.

**Production refuses to start** while identity, signatures, payments, escrow or banking are on sandbox adapters.

| Capability | Interface | Implemented adapters | Configure |
| --- | --- | --- | --- |
| Open banking | `BankingProvider` | **Plaid** (`plaid.ts`), sandbox bank (`mock.ts`, with an expiring-consent institution) | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (or `MONEY_PLAID_*` on the money service) |
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

Consent is always provider-hosted (Plaid Hosted Link, where the person also picks their bank, or the sandbox consent page). Plaid is asked for Identity and Balance only, never Auth, so full account and routing numbers never reach Sagolik. The flow:

- `connectBank` returns a redirect URL and a `state` value, which is bound to the user.
- The callback exchanges the code.
- The access token is stored encrypted in `bank_connection_secrets`, which only the service role can read.
- Accounts are stored masked. Ownership is verified by name matching against the profile.
- Expired or revoked consent moves the connection to `reauthentication_required` and notifies the owner.
- Plaid webhooks go to `/api/webhooks/plaid` and must carry a valid `Plaid-Verification` JWT (ES256, Plaid's key, at most 5 minutes old, SHA-256 of the exact body).
- Proof of funds: the buyer can check one of their own accounts against what the closing still needs.
- With `MONEY_SERVICE_URL` set, all of this runs in the Go money service instead: the access token never reaches the web app, which keeps a masked copy, and escrow sees proof-of-funds results. See [money-service.md](money-service.md) §9b.
