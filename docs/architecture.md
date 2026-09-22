# Architecture

## Principles

1. **Orchestration, not custody.** Sagolik Close never holds funds, never signs for anyone, and never records title. It coordinates the regulated parties who do those things, and reflects what they report.
2. **Facts over clicks.** Milestones advance when facts are true, and each fact comes from a verifiable source: a settled payment webhook, a completed signature envelope, a recording reference. A person saying something happened is not enough.
3. **Authorization at every layer.** Permissions are checked in services, and again in Postgres through row-level security. The browser never decides access.
4. **Everything is auditable.** State changes, approvals and money movements write append-only audit rows and domain events.

## Runtime shape

```
Browser ──▶ Next.js (apps/web)
             ├─ Server Components  → read through services (RLS client in Supabase mode)
             ├─ Server Actions     → mutate through services (CSRF-safe by construction)
             ├─ /api/v1/*          → same services; JSON, idempotency keys, rate limits
             └─ /api/webhooks/:p   → signature check → webhook_events (dedup) → service handler
                                      │
packages/core services ◀──────────────┘
   ├─ authorize (packages/auth) → load snapshot → validate (packages/types)
   ├─ write rows (packages/database: Supabase service client or in-memory)
   ├─ audit() + emit() → domain_events outbox
   └─ reconcile() → workflow facts/rules → automatic, guarded state transitions

apps/worker ── drains domain_events (notifications, reactions) and retries failed webhooks
```

### One service layer, three front doors

Server actions, the REST API and webhook handlers all call the same functions in `packages/core/src/services`. Each takes a `ServiceContext` containing:

- the actor (a user or a named system source)
- a reader database (RLS-scoped in Supabase mode)
- a writer database (service role)
- providers, storage, the key ring, feature flags, a correlation id and a clock

Tests construct the same context with an in-memory database (`createTestHarness`).

### Demo mode vs. Supabase mode

| | Demo (`memory`) | Supabase |
| --- | --- | --- |
| Store | `MemoryDb` with the same validation, unique keys, append-only and bank-instruction guards as the SQL triggers | Postgres via PostgREST; RLS for reads, triggers for invariants |
| Auth | Signed demo session cookie, persona picker | Supabase Auth: password, magic link, OAuth, SAML SSO, TOTP MFA (AAL2) |
| Events | Processed inline after each write | Written to the outbox; `apps/worker` delivers them |
| Providers | Sandbox adapters, delivering signed webhooks into the real pipeline | Real adapters where configured. Production refuses sandbox adapters for regulated functions. |

## Workflow engine (`packages/workflow`)

- **States:** draft → invited → identity_pending → documents_pending → financing_pending → conditions_pending → ready_for_signing → signing → escrow_pending → funding_pending → recording_pending → ownership_transfer → closed. Any active state can move to `cancelled` or `disputed`.
- **Facts:** named, computed booleans such as `all_buyers_identity_verified`, `closing_funds_settled` and `recording_confirmed`. Each one is derived from a snapshot of the transaction.
- **Transitions:** each transition declares its guard facts and the permission it requires. `checkTransition` returns every unmet fact with a readable explanation, and the UI shows that explanation.
- **Rules:** inspectable capabilities such as "escrow deposit enabled" or "ready to request recording". They depend on facts and on the jurisdiction's requirements (US-TX, US-CA, SE, PL, DE, LI, CH).
- `reconcile()` runs after relevant events. It advances the transaction along the forward path while guards hold, and never past `ownership_transfer` → `closed` without a registry confirmation.

## Events and webhooks

- `emit()` writes a `domain_events` row, keyed for idempotency. Workers claim a row with a compare-and-set update (`updateIf`), so several workers can run at once without processing an event twice. Failures back off (`OUTBOX_BACKOFF_MS`) and end in `dead_letter`.
- Webhooks are verified with an HMAC `t=…,v1=…` signature and a timestamp tolerance. They are then stored once per (provider, event id) and processed. Failed rows are retried by the worker or from the admin console.

## Web app

- Next.js 16 App Router, React 19 and Tailwind v4.
- `src/proxy.ts` sets a per-request CSP nonce and `x-request-id`.
- Every mutating control is an `<ActionForm>`. It shows pending, error and success states, and prompts for step-up confirmation when a service requires it.
- Mobile has a bottom navigation bar. Desktop has a sidebar.
- Localized in en, sv, pl and de.
