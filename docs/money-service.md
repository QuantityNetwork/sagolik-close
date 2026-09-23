# Money service (Go) — design

Status: **M1 (foundation) implemented** in `services/money` — see its README. M2 onwards not started. Decisions this design rests on: **US first**, and Sagolik Close stays **an orchestration layer only**. It never holds, receives or moves client funds.

## 1. What "orchestration only" means for money in the US

Funds always move **from the buyer's bank straight to the escrow or title company's trust account**. Sagolik Close is never a party to the payment. That keeps us outside:

- **money-transmitter licensing**, which is required state by state for anyone who receives or transmits funds;
- **escrow licensing**, for example under California DFPI escrow law, which applies to whoever holds the deposit;
- **NACHA originator obligations**, because the escrow company or its bank originates any ACH, not us.

Supported money flows, in the order we build them:

| # | Flow | Who moves the money | Our role |
| --- | --- | --- | --- |
| F1 | **Verified wire** (the default in US closings) | Buyer, from their own bank | Show wire instructions only after they have been verified. Confirm the buyer's account ownership and proof of funds. Track receipt from the escrow partner's confirmation. |
| F2 | **Escrow-initiated ACH/RTP pull** | The escrow company, through *its* bank or payment provider account | Software acting for the escrow company. It creates the request in the escrow's system; funds settle into the escrow's trust account. |
| F3 | **Disbursement tracking** | The escrow company | Mirror the disbursement status reported by the escrow partner. We never initiate disbursements. |

F2 needs counsel to confirm, per state, that acting as the escrow company's software vendor keeps us outside money transmission. Until counsel signs off, the product ships F1 and F3 only (the `payment_initiation` flag stays off).

## 2. Why a separate Go service

The web app (TypeScript) keeps UI, workflow, documents, identity, signatures and messaging. The Go service owns only the things that are dangerous if they leak or are tampered with:

- bank-connection access tokens (Plaid) and full account and routing numbers
- beneficiary and wire instructions: versioned, cooling-off, dual control
- payment intents and provider events (webhooks from Plaid, escrow partners and payment providers)
- the funds-tracking ledger and reconciliation

Why Go:
- **Small dependency tree:** the standard library plus pgx and a few audited modules, versus the npm graph.
- **A single static binary** in a distroless image.
- **Built-in crypto and TLS.**
- **Maintained Go libraries** for US bank file formats (moov-io `ach`, `wire`, `iso20022`), in case an escrow partner ever wants files rather than APIs.

The important part is the **isolation**. A compromise of the web app must not expose bank tokens, full account numbers, or the ability to change where money goes.

## 3. Architecture

```
Browser ─▶ Next.js web app (public) ── mTLS, signed user assertion ──▶ Go money service (private subnet)
               │  masked projections only                                   │  own Postgres DB + role
               ▼                                                            ├─▶ AWS KMS (envelope encryption)
          App Postgres (Supabase)  ◀── outbox events (masked) ──────────────┤
                                                                            ├─▶ Plaid (Auth, Identity, Balance)
Provider webhooks ─▶ WAF/edge ─▶ /webhooks/* on the money service ──────────┤─▶ Escrow partner / title production system
                                                                            └─▶ wire-fraud verification provider
```

**Trust boundaries**

1. **Web app → money service.** Mutual TLS with a service identity per workload. Every request carries a **short-lived signed user assertion**: an Ed25519 JWT valid for 60 seconds, containing user id, transaction id, role, authentication level (AAL2 or not) and the time of the last step-up. The money service verifies the assertion and **re-checks authorization itself**. It never trusts the web app's decision for money actions.
2. **Providers → money service.** Webhooks reach a dedicated ingress path, never the web app. They are checked for signature, timestamp tolerance and dedup, as the TypeScript pipeline does today.
3. **Money service → web app.** Only masked, non-secret events (for example "instruction v3 verified" or "deposit received: $25,000") go through an outbox into the app database.

**Controls the money service enforces itself, not just the UI**

- A new instruction version cannot be used during its cooling-off period (24 hours by default, configurable per organization).
- Verification must be done by a **different person** from the author, with a recorded out-of-band call reference.
- Approving a payment intent requires a second person, AAL2, and a step-up within the last 5 minutes.
- Beneficiary details are checked against the escrow partner's system of record, or a wire-fraud verification provider (e.g. CertifID or a similar service). Any mismatch blocks the instruction and raises a security signal.
- Rate limits and anomaly rules apply: instruction changes near closing, new devices, geo-velocity.

## 4. Keys and secrets

- **Envelope encryption with AWS KMS**, backed by FIPS 140-validated HSMs.
  - Every sensitive record (a Plaid access token, a full account number) gets its own data key.
  - The data key is stored wrapped by a KMS key that only the money service's IAM role can use.
- **No secrets in environment variables.** Provider credentials sit in AWS Secrets Manager, can be read only by the service role, are rotated, and every read is logged in CloudTrail.
- **Separate KMS keys** per environment and per data class: tokens, account numbers, signing keys.
- The signing keys for user assertions belong to the web app; the money service holds only the public keys, and rotates them through a published key set (JWKS).
- **Break-glass access** requires two people and is time-boxed and audited.

## 5. Data model (money service database)

| Table | Notes |
| --- | --- |
| `bank_connections` | Plaid item id; access token encrypted with its data key; status; consent expiry |
| `bank_accounts` | Mask, type, ownership-match result; full account/routing numbers encrypted; never returned by the API |
| `beneficiaries` | The escrow or title trust account for a transaction |
| `instruction_versions` | **Immutable, append-only.** Author, verifier, verification method and reference, `effective_after`, source-of-truth check result |
| `payment_intents` | F1/F2 intent, amount in cents, idempotency key, status that only moves forward |
| `provider_events` | Raw webhook, signature result, unique on (provider, event id) |
| `ledger_entries` | **Append-only, double-entry funds tracking**: *expected*, *received*, *disbursed* per closing, mirrored from provider events. Balances are derived, never stored. |
| `audit_events` | Hash-chained: each row includes the hash of the previous row, so tampering is detectable |

Postgres roles:
- The service's own role cannot UPDATE or DELETE the append-only tables, which is enforced by triggers.
- Migrations run under a separate role.
- The web app has **no credentials** for this database.

## 6. Internal API (v1)

```
POST /v1/bank-connections:start        → Plaid Link token
POST /v1/bank-connections:complete     → exchange public token; ownership match
GET  /v1/transactions/{id}/funds       → masked accounts, proof of funds, ledger summary
POST /v1/transactions/{id}/instructions            → new version (step-up required)
POST /v1/instructions/{id}:verify                   → second person, out-of-band reference (step-up)
GET  /v1/transactions/{id}/instructions/current    → shown to the buyer only once effective and verified
POST /v1/transactions/{id}/payment-intents         → F2 only, behind a flag, idempotency key required
POST /v1/payment-intents/{id}:approve              → dual control, step-up
POST /webhooks/{provider}
```

- Contract: an OpenAPI 3.1 spec in `services/money/api/`. The TypeScript client is generated from it, so the two languages cannot drift apart.
- Errors: the same shape as today's `ApiError`, with messages written for people.

## 7. Build, supply chain, operations

- **Language and dependencies:** Go 1.24+ and `go.mod` with the fewest dependencies possible.
- **CI checks:** `govulncheck`, `gosec` and `staticcheck` gate every pull request. Tests run with the race detector and against real Postgres.
- **Images:**
  - built reproducibly with `-trimpath`, on a distroless base, running as non-root with a read-only filesystem
  - shipped with an SBOM and signed with cosign
- **Runtime:**
  - a private subnet with no public ingress, except webhook routes through the WAF
  - outbound traffic allowed only to Plaid, the escrow partner, KMS and Secrets Manager
- **Observability:** structured logs that redact sensitive fields by type, not by convention. Traces carry the web app's correlation id.
- **Reconciliation job:** every night, compare the ledger's expected and received amounts with the escrow partner's reports, and alert on any mismatch.

## 8. US compliance frame (for a vendor that doesn't hold custody)

| Obligation | Why it applies to us | What we do |
| --- | --- | --- |
| GLBA Safeguards Rule (FTC) | Our customers (title, escrow, lenders) are covered financial institutions and must oversee their service providers | Written information security program, a qualified individual, risk assessment, MFA, encryption, incident response |
| ALTA Best Practices (title industry) | Title agents must vet the vendors that handle nonpublic personal information and wire processes | Security package mapped to the ALTA pillars |
| SOC 2 Type II | Expected by title companies and lenders | Type I first, then Type II after the observation period |
| NACHA | Only if F2 ACH goes live, and then as the escrow company's third-party service provider | Follow NACHA's third-party sender and service-provider guidance with counsel |
| RESPA §8 | Settlement-service fees and referrals | Pricing is a software subscription; no per-referral fees |
| State privacy laws (CCPA/CPRA, etc.) | Consumer data | Existing export, consent and retention features |

## 9. Migration from today's TypeScript code

The rules already exist in `packages/core/src/services/{banking,payments,escrow}.ts` and the SQL guards. We port the behaviour, keep the existing tests as the specification, and switch over behind a flag.

1. **M1 — Skeleton** ✅ done:
   - the Go service, OpenAPI spec, database, KMS envelope encryption, mTLS and user assertions
   - health endpoints and CI gates
   - local development with LocalStack KMS
2. **M2 — Instructions and ledger:**
   - port instruction versioning, cooling-off, dual control and the ledger
   - a TypeScript adapter (`MoneyServiceClient`) replaces the in-process calls when `MONEY_SERVICE_URL` is set
   - the lifecycle tests run against both implementations
3. **M3 — Plaid:** Plaid Auth, Identity and Balance for account ownership and proof of funds. Tokens now live only in the money service.
4. **M4 — First escrow partner: Fidelity National Financial (FNF).** FNF is the largest US title insurer (brands include Fidelity National Title and Chicago Title) and owns SoftPro, a title production system also widely used by independent agents. Integrate with SoftPro through its partner program, to verify beneficiaries and confirm receipt and disbursement (F1, F3). This needs a signed partnership: the APIs are partner-gated. FNF also runs its own consumer closing app (inHere), so position Sagolik Close as the multi-party layer that works *with* their systems, not a replacement for them.
5. **M5 — Hardening:** penetration test, SOC 2 Type I readiness, runbooks, and delete the TypeScript money code.
6. **Later, only with counsel sign-off:** F2 escrow-initiated ACH/RTP.

## 10. Decisions

| Decision | Outcome |
| --- | --- |
| First market | United States |
| Custody | None: orchestration only |
| Cloud for the money service | AWS (KMS/HSM, Secrets Manager, private networking) |
| First escrow/title partner | Fidelity National Financial, through SoftPro |
| Wire-fraud verification provider | Open: choose alongside the FNF conversation |
