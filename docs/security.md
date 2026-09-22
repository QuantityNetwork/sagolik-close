# Security

Where security and convenience conflict, Sagolik Close chooses security. This page lists the controls that exist in the code. [threat-model.md](threat-model.md) maps them to the threats they address.

## Identity and sessions

- Supabase Auth offers password, magic link, OAuth and SAML SSO sign-in. MFA uses TOTP (AAL2).
- Recovery codes are stored only as hashes and can be regenerated from Settings → Security.
- **Step-up:** the following actions need a confirmation made within the last 5 minutes (`packages/auth/src/step-up.ts`):
  - changing or verifying bank instructions
  - initiating or approving a payment
  - adding a beneficiary
  - signing a closing document
  - changing organization roles
  - a full audit export
  - disconnecting a bank

  Services throw `StepUpRequiredError`, and the UI routes the person to `/app/step-up`.
- The demo session is an HMAC-signed, httpOnly, SameSite=Lax cookie. Production refuses to start in demo mode, or without `SESSION_SECRET` and `DATA_ENCRYPTION_KEYS`.

## Authorization

- Each participant role maps to a permission set (`packages/auth/src/permissions.ts`). Services call `assertCan` before every read and write.
- Postgres RLS enforces the same model through `role_permissions`, which is generated from the TypeScript source. Tests cover IDOR, cross-tenant reads, column privileges and write denial (`supabase/tests/rls_test.sql`).
- A transaction someone cannot see returns **404, not 403**, so its existence is not revealed.
- Platform admins get **no implicit access** to transaction contents. The admin console shows operational metadata only, and admin views are audited.

## Money-movement controls

- Bank instructions are versioned and immutable. A change creates a new version. That version goes through a cooling-off period (24 hours by default, per organization). It must also be verified by a second person through an out-of-band call before it can be used. A changed instruction close to closing is rated as a critical risk and raises a `security_signals` row.
- Dual approval: the person who initiated a payment cannot approve it.
- A payment only becomes settled when the provider sends a signed webhook. Client-side status is never trusted.
- Idempotency keys apply to payment initiation and to all API writes.
- Users are never asked for online-banking passwords. Bank access uses provider-hosted consent (Plaid Link, or a sandbox consent screen), and only encrypted access tokens are stored.

## Data protection

- AES-256-GCM field encryption uses a key ring. Rotation: add a new key first in the list, and older keys still decrypt. Associated data binds each ciphertext to its row.
- Account numbers are shown masked everywhere. SMS never contains amounts, addresses or account details.
- Uploads are checked for MIME type by magic bytes and for size, and virus-scanned (with a mock scanner locally; an EICAR test is included). File names are sanitized. Downloads use 60-second signed URLs.
- Personal data export is available in Settings → Privacy. Consent records are append-only.

## Web

- Every response sets:
  - a nonce-based CSP with `frame-ancestors 'none'`
  - HSTS
  - `X-Content-Type-Options: nosniff`
  - a strict Referrer-Policy and Permissions-Policy
- Server actions rely on Next.js origin checks. `/api/v1` uses the session cookie. Mutations must be same-origin (CSRF), and every call is rate-limited per user (`RATE_LIMITS`). Sign-in is rate-limited per IP. Scoped API tokens for system integrations are a planned follow-up.
- Webhooks use HMAC signatures, a timestamp tolerance, and dedup on (provider, event id). Failed webhooks are retried and end in a dead-letter state.
- Errors show people a readable message. Stack traces go only to the logs.

## AI assistant

The assistant answers from structured transaction data the asker is allowed to see. It **cannot** move money, sign, approve identity or compliance, or change state. Imperative requests are declined, and the assistant points to the person responsible.

## Reporting a vulnerability

Use the contact form with the topic "Report a security issue".
