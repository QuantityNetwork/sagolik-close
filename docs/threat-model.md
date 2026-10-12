# Threat model

Scope: the web app, API, worker, database and provider integrations of Sagolik Close. Method: STRIDE-style, focused on the assets that matter in a closing.

## Assets

1. Closing funds and the instructions that direct them
2. Identity data and documents (IDs, statements, disclosures)
3. Signature integrity and document versions
4. Ownership outcome, i.e. who is recorded as owner
5. Audit trail

## Threats and mitigations

| # | Threat | Mitigations | Where |
| --- | --- | --- | --- |
| T1 | **Wire fraud through altered instructions** (a compromised agent or escrow email, or an insider) | Versioned, immutable instructions; cooling-off; second-person out-of-band verification; step-up to change or verify; critical risk signal near closing; buyers told never to act on emailed instructions | `services/payments.ts`, `bank_instructions_guard`, `security/fraud.ts` |
| T2 | Account takeover of a buyer or professional | MFA/TOTP, step-up for money and signing, rate-limited auth, sign-out of other sessions, sign-in events audited | `auth`, `actions/auth.ts` |
| T3 | Horizontal privilege escalation (IDOR) between transactions or tenants | Service checks plus RLS; 404 for inaccessible rows; DB tests for IDOR and tenant isolation | `authorize.ts`, `rls.sql`, `rls_test.sql` |
| T4 | Forged provider events (fake "payment settled", "signed") | HMAC signatures with timestamp tolerance; unique (provider, event id); settlement only from webhooks | `security/webhooks.ts`, `services/webhooks.ts` |
| T5 | Ownership shown as transferred without recording | State guard requires a recording confirmation reference; the transition cannot be triggered by a UI click | `transactions_state_guard`, `workflow` |
| T6 | Tampering with documents after signing | Append-only versions with SHA-256; signature envelope bound to the document hash | `documents_version_guard` |
| T7 | Audit repudiation | Append-only audit tables (triggers reject UPDATE and DELETE); correlation ids; exportable package | `audit_events` |
| T8 | Malicious upload | Magic-byte MIME checks, size limits, virus scan hook, sanitized names, signed short-lived downloads | `security/uploads.ts` |
| T9 | Secret leakage | No secrets in the repo; production refuses local fallbacks; tokens encrypted at rest; service-role key server-only (`server-only` imports) | `config/env.ts` |
| T10 | Platform staff overreach | No implicit admin access to transactions; admin actions audited; step-up for flags | `authorize.ts`, `admin` |
| T11 | AI takes unintended action | Assistant is read-only and declines imperative requests | `services/assistant.ts` |
| T12 | Denial of service or brute force | Rate limits on API calls (per user), sign-in and contact (per IP), and webhooks; worker backoff | `security/rate-limit.ts` |
| T13 | Phishing that impersonates the platform | Emails carry no links to payment details; repeated in-product warnings; contact page states what we never ask for | UI copy |
| T14 | Claiming someone else's wallet as proof of funds (replayed or phished signatures) | Challenge bound by HMAC to the person, closing, network and address, expiring in 10 minutes; one connection per challenge; message names the site, the closing and that signing moves nothing; signature checked server-side (EOA and EIP-1271/6492) | `services/wallets.ts` |
| T15 | Recording key leaked | The key holds `RECORDER_ROLE` only: it can append fingerprints and pay its own gas, nothing else. The treasury admin revokes and replaces it; earlier entries stay. Kept out of the web app in production (only the worker sends) | `SagolikDealRegistry`, `services/deal-record.ts` |
| T16 | Rewriting or hiding a deal record entry | The registry is append-only with a per-deal hash chain; receipts are immutable once created (`chain_records_guard`) and can't be deleted; anyone can replay receipts against `dealOf` | contract, migration, Record tab, receipts export |
| T17 | Linking on-chain entries to people or deals | Deal ids are an HMAC under a deployment secret; only fingerprints (with a random nonce per receipt) go on chain, never names, addresses, amounts or documents | `chain/records.ts` |
| T18 | A false balance or transaction from a compromised RPC endpoint | Use a reputable RPC provider over https (enforced outside local); results are evidence for people, never automatic money decisions; escrow still records what it received | `config/env.ts`, `chain/base.ts` |

## Residual risks and follow-ups

- The in-memory rate-limit store is per instance. Production should use Redis.
- The virus scanner is a mock. Connect a real scanner (e.g. ClamAV or the storage provider's scanning) before launch.
- Identity, e-signature, payments and escrow have sandbox adapters only. Each production adapter needs its own security review.
- Commission a penetration test before handling real funds.
- The deal registry should get an independent smart-contract review before it is deployed on Base mainnet.
