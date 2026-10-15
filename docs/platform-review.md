# Platform review: what we have built, and what a bank-grade platform still needs

October 2026. A step back before moving the platform onto Microsoft Azure ([azure/architecture.md](azure/architecture.md)).

## The system at a glance

Sagolik Close coordinates the regulated parties in a closing: buyers, sellers, agents, lenders, title, escrow and counsel. **It never holds or moves money, never signs for anyone and never records title.** Everything below is built around that rule.

| Part | What it is | Size |
| --- | --- | --- |
| `apps/web` | Next.js 16 app: public site, the workspace, `/api/v1`, provider webhooks | One service layer behind three front doors (pages, API, webhooks) |
| `apps/worker` | Background process: event outbox, webhook retries, deal-record delivery, Property Autopilot checks | Safe to run several copies (rows are claimed with compare-and-set) |
| `services/money` | Go service for the dangerous data: bank tokens, full account numbers, payment instructions, the funds ledger | ~7,200 lines; mutual TLS + signed user assertions; its own database |
| `packages/core` | Every business rule: transactions, documents, signatures, identity, banking, payments, escrow, closing, autopilot, wallets, deal record | One `ServiceContext`; the same code runs in tests, the web app and the worker |
| `packages/workflow` | The closing state machine, facts, guards and rules per jurisdiction (US-TX, US-CA, SE, PL, DE, LI, CH, US business deals) | Pure functions |
| `packages/auth`, `security`, `audit` | Role → permission matrix, step-up, TOTP; encryption, webhook signatures, fraud signals, rate limits; audit and event vocabulary | |
| `packages/database` | One table interface, three stores: in-memory (demo/tests), Supabase, and direct PostgreSQL (Azure) | 65 tables |
| `packages/integrations` | Adapters behind interfaces: Plaid, identity, e-signature, payments, escrow, email/SMS, Base chain | Sandbox versions of each, clearly labelled |
| `packages/contracts` | `SagolikDealRegistry` (Solidity) for the on-chain deal record | Hardhat tests |
| `supabase/` | SQL migrations (7 files, ~2,000 lines), row-level security, integrity triggers, seed, SQL tests | 77 database security checks |

About 30,000 lines of TypeScript and 7,000 of Go. Tests: about 280 unit and service tests, 21 browser tests against a production build, 9 contract tests, a cross-service test (TypeScript → Go over mTLS), a local-chain integration test, and the Azure database flavour on PostgreSQL 16. CI runs all of them, plus `govulncheck`, `gosec` and `staticcheck` on the Go service, the Bicep linter and Checkov on the infrastructure, and builds of all three images.

Today the public demo runs on Vercel, in memory, with sandbox providers. Supabase, the worker and the money service aren't deployed yet.

## Foundations that are already institutional-grade

These were designed in from the start, and they carry over to any cloud unchanged:

1. **No custody, by construction.** Funds move from the buyer's bank to the licensed escrow company. Production refuses to start with sandbox adapters for regulated functions. The deal registry contract can't receive money.
2. **Authorization twice.** Services check permissions before every read and write, and PostgreSQL row-level security enforces the same matrix (generated from the TypeScript source, with a parity test). An inaccessible transaction returns 404, not 403.
3. **Facts, not clicks.** Milestones advance only on verifiable facts: a provider's signed webhook, a completed signature envelope, a recording reference. Database triggers enforce the state machine as well.
4. **Wire-fraud controls.** Bank instructions are immutable and versioned, with a cooling-off period and verification by a second person over a known phone number. Step-up confirmation is required for every money action. A change near closing raises a critical signal.
5. **Isolation of the dangerous data.** The Go money service holds bank tokens and full account numbers. The web app sees masked projections only and has no credentials for the money database. Calls carry a 60-second signed user assertion, and the service re-checks authorization itself.
6. **Evidence.** The audit log and state history are append-only (enforced by triggers), with correlation ids end to end. The deal record anchors fingerprints of key facts on Base without putting personal data on chain.
7. **Envelope encryption.** The money service gives each secret its own data key, wrapped by a key-encryption key and bound to its record. The web app encrypts with AES-256-GCM, a versioned key ring and associated data.
8. **Supply chain and quality gates.** Lockfiles, `govulncheck`, `gosec` and `staticcheck`, tests against real PostgreSQL, browser tests against the production build, ABI drift checks for the contract, and a scan that blocks unverifiable marketing claims.

## Gaps against a bank-grade environment

What a bank's vendor-risk team, a SOC 2 auditor or a DORA/NIS2 review would ask about, and what we don't have yet:

| Area | Today | Bank-grade expectation | Priority |
| --- | --- | --- | --- |
| Hosting | Vercel (shared multi-tenant edge); no worker or money service deployed | Dedicated, private network; nothing but the edge reachable from the internet; data services on private endpoints only | P1 |
| Identity | Supabase Auth (or demo cookies) | Workforce identity in Microsoft Entra ID (Conditional Access, phishing-resistant MFA, PIM for admins); customer identity in Entra External ID with MFA and passkeys | P1 |
| Keys and secrets | Data keys and the session secret in environment variables; the money service's KEK in AWS KMS | Keys in HSMs (Key Vault Premium or Managed HSM), wrapped data keys, no secrets in environment variables, managed identities instead of passwords | P1 |
| Database | Supabase Postgres (not provisioned) | Zone-redundant PostgreSQL with private access, customer-managed keys, geo-redundant backups, Entra authentication, pgaudit | P1 |
| Documents | Supabase Storage | Private blob storage with customer-managed keys, versioning, soft delete, and write-once retention for executed documents | P1 |
| Edge | Vercel's default protections | Web application firewall (OWASP rules, bot protection, rate limits) and DDoS protection in front of everything | P1 |
| Egress | Unrestricted | Outbound traffic only to an allow-list (Plaid, Base RPC, email/SMS, identity) | P2 |
| Security operations | JSON logs to stdout | Central logs, a SIEM with detections for our own audit signals (instruction changes, step-up failures, key use), threat detection on every resource | P1 |
| Rate limits | In memory, per instance | Shared store (Redis) plus edge rate limits at the WAF | P2 |
| Deployment | Manual deploy calls | Infrastructure as code, pipeline identity without stored secrets, signed images, separated environments with approvals | P1 |
| Resilience | None formal | Zone redundancy, backups tested by restore drills, stated RTO/RPO, a disaster-recovery runbook (DORA expects tested continuity plans) | P2 |
| Chain recording key | A private key in an environment variable | Key generated and kept inside an HSM; signing by reference only | P2 (before mainnet) |
| Virus scanning | Mock scanner | Real scanning on upload (Defender for Storage malware scanning) | P1 |
| Assurance | Internal tests only | Penetration test, SOC 2 Type I then Type II, ISO 27001 later; written security program (GLBA Safeguards Rule for US customers) | P2 (process) |

None of these require rewriting the product. They're the platform underneath it: the rails. [azure/architecture.md](azure/architecture.md) describes the target and what this change adds toward it.

## What this change adjusts in the code

| Concern | Before | After this change |
| --- | --- | --- |
| Infrastructure | none | `infra/azure`: Bicep for a whole environment (network, firewall, Key Vaults with HSM keys, PostgreSQL, Blob Storage, registry, Container Apps, Front Door and WAF, Defender, Sentinel, budget, policy). Compiles with no warnings, passes strict linter rules and Checkov in CI |
| Database access | Supabase client only | Direct PostgreSQL store: each call takes the `authenticated` role with the person's claims (RLS decides) or `service_role` for writes; workloads sign in with Entra tokens; their login roles can do nothing on their own. Migrations without the Supabase CLI. The same 77 SQL security checks pass on it, and every demo persona sees exactly what they saw before |
| Hidden columns | `select *` for people's reads (fails on column-protected tables) | People's reads leave out what the database hides from them (the encrypted account number); payments read it through the service layer. Fixed for the Supabase reader too |
| Documents | Supabase Storage | Azure Blob Storage adapter (managed identity, no account keys, write-once keys) |
| Encryption keys | Key ring from an environment variable | Data keys wrapped by a Key Vault HSM key, unwrapped at start-up, the key version pinned; ceremony and re-wrap commands run inside the network |
| Chain recording key | Environment variable | Signing inside Key Vault (secp256k1, ES256K); the key never leaves the HSM. Production refuses a raw key |
| Money service | AWS KMS; one admin database login | Azure Key Vault provider (RSA-OAEP-256, versioned, only its own key); Entra sign-in; a `migrate` command under its own identity, so the runtime role can't change the schema; Go 1.26.9 |
| Images | Built by hand | Web, worker (with the migrate and keys jobs) and money images built and checked in CI; the worker runs Node directly so shutdown signals arrive |
| Deployment | Manual deploy calls | GitHub Actions to Azure with OpenID Connect (no stored cloud credentials), in phases (platform, key ceremony, apps), what-if before every change, signed build provenance for every image, migrations and smoke test through Front Door |
| Security operations | JSON logs to stdout | Every resource's diagnostics in Log Analytics, Sentinel on top; audit events also logged as structured lines (ids and actions only); starting detections in `infra/azure/sentinel` |

Identity on Entra (sign-in, MFA, step-up) is the next step after this one. It touches every page, so it gets its own change. Until then the Azure environment runs the fictional demo (`dev`); production's apps wait for it, and for contracted identity, signature, payment and escrow providers.
