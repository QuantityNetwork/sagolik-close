# Data model

The schema is defined twice, on purpose, and a test keeps the two identical:

- `packages/types/src/entities.ts` — Zod row schemas (`TABLE_SCHEMAS`). Every write through the `Db` gateway is validated against them. In-memory mode also enforces unique keys, append-only tables and the bank-instruction guard.
- `supabase/migrations/*.sql` — the Postgres schema, RLS policies and triggers. `packages/database/src/schema-parity.test.ts` fails if a table or column drifts between the two.

Some SQL is **generated from TypeScript**, so authorization and workflow have a single source of truth (`pnpm gen:sql`):

- `role_permissions`, used by RLS helper functions
- `transaction_states` and `transaction_transitions`, used by the state guard trigger

## Main groups

| Group | Tables |
| --- | --- |
| People & orgs | `profiles`, `organizations`, `organization_members`, `organization_roles`, `organization_settings`, `organization_branding`, `mfa_recovery_codes` |
| Transaction | `properties`, `transactions`, `transaction_participants`, `transaction_events` (append-only), `transaction_requirements`, `transaction_milestones`, `tasks`, `task_dependencies`, `approvals` |
| Documents | `documents`, `document_versions` (append-only, SHA-256 per version), `document_signatures` |
| Identity & compliance | `identity_verifications`, `compliance_cases`, `source_of_funds_declarations`, `consent_records` (append-only) |
| Money | `bank_connections`, `bank_connection_secrets` (encrypted tokens, service role only), `bank_accounts` (masked), `bank_instructions` (versioned, immutable once used), `payments`, `payment_events` (append-only), `escrow_accounts`, `escrow_transactions`, `escrow_conditions` |
| Closing | `mortgages`, `mortgage_conditions`, `title_cases`, `title_issues`, `recordings`, `ownership_records`, `ownership_record_items` |
| Collaboration | `message_threads`, `messages`, `message_reads`, `notifications`, `notification_preferences`, `calendar_events` |
| Platform | `integrations`, `integration_credentials`, `webhook_events`, `domain_events` (outbox), `audit_events` (append-only), `security_signals`, `feature_flags`, `plans`, `billing_accounts`, `subscriptions`, `idempotency_keys` |

## Invariants enforced in the database

These are Postgres triggers, mirrored in `MemoryDb`:

- **Append-only:** `audit_events`, `transaction_events`, `document_versions`, `payment_events` and `consent_records` reject UPDATE and DELETE.
- **Bank instructions:** account details are immutable. A change creates a new version. A used version cannot be edited.
- **Escrow ledger:** entries are immutable once posted.
- **Transaction state:** a state can only change along a transition listed in `transaction_transitions`. `ownership_transfer → closed` also requires a confirmed recording, and ownership cannot be marked transferred without one.
- **Payments:** status moves only forward (e.g. `settled` can never become `pending`).
- **No deletes** on regulated records. Rows are cancelled or superseded, never removed.

## Money

Amounts are integer minor units (`amount` in cents) with an ISO currency. Account and routing numbers are stored encrypted (AES-256-GCM, key ring `v1:…`), with a separate `mask` column for display.

## Demo data

`packages/core/src/demo/seed.ts` builds four fictional transactions (Maple Ridge, Barton Creek, Lakeview, Hillside) with deterministic ids. The same builder feeds the in-memory store and `supabase/seed.sql`. In the SQL seed, dates are shifted to "now" at `db reset`.
