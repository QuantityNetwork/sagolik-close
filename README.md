# Sagolik Close

**From Decision to Ownership.** Sagolik Close is the orchestration layer for a real-estate closing. It brings buyers, sellers, agents, lenders, title and escrow officers into one workspace, and tracks everything a closing needs: identity, documents, signatures, money, recording and the Home Record afterwards. It runs at `close.sagolik.com`.

Sagolik Close **orchestrates; it does not take custody**. Funds stay with licensed escrow and payment providers. Signatures are made with an e-signature provider. Title is recorded by the registry. The platform shows what those parties report, over signed webhooks, and never infers it from a button click.

## Quick start (demo mode, no accounts needed)

```bash
corepack enable
pnpm install
pnpm dev            # http://localhost:3000
```

With no Supabase configuration, the app starts in **demo mode**:

- It uses an in-memory store seeded with fictional people, properties and money.
- Every provider (bank, identity, signatures, payments, escrow, email, SMS) is a sandbox adapter. Each one signs its webhooks, and those webhooks go through the real webhook pipeline.
- A banner on every page says it is a demo.

Sign in at `/sign-in` and pick a persona. For example, **Olivia Carter** (buyer), **Jessica Morgan** (buyer's agent, with the command center), **Marcus Lee** (escrow officer) or **Platform admin**.

Sensitive actions (signing closing documents, payments, bank instructions) ask you to confirm it's you. In demo mode everyone shares a sandbox authenticator, and the step-up page shows its current code.

## Running against Supabase

```bash
supabase start                             # local stack
supabase db reset                          # migrations + supabase/seed.sql (demo data, dates shifted to "now")
pnpm seed:storage                          # uploads the demo vault PDFs (local projects only)
cp .env.example apps/web/.env.local        # fill the Supabase URL/keys, secrets
pnpm dev
pnpm worker                                # outbox delivery + webhook retries (required in Supabase mode)
```

Demo users are created in `auth.users` with the password `demo-closing-2026`. In Supabase mode, step-up uses Supabase MFA: enroll an authenticator under Settings → Security, or use a recovery code. See [docs/deployment.md](docs/deployment.md) for production.

## Deploy

The public site with the live demo ships as one container. See [docs/deployment.md](docs/deployment.md) for the full guide.

```bash
docker build --target web -t sagolik-close .
docker run -p 3000:3000 -e APP_ENV=staging -e DEMO_MODE=true -e DEMO_RESET_HOURS=6 \
  -e APP_URL=https://close.sagolik.com -e SESSION_SECRET="$(openssl rand -hex 32)" sagolik-close
```

Run a single instance: demo state lives in memory. Real accounts and closings need Supabase and production provider adapters (path B in the guide).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` / `build` / `start` | Web app (Next.js 16, App Router) |
| `pnpm worker` | Background worker (outbox, webhook retries) |
| `pnpm typecheck` | Strict TypeScript across every package |
| `pnpm test` | Unit and integration tests (Vitest), including a full closing lifecycle through signed sandbox webhooks |
| `pnpm test:db` | Migrations applied to a throwaway Postgres 16; RLS, IDOR, tenant isolation, immutability and state-guard checks |
| `pnpm test:e2e` | Playwright against a fresh demo server |
| `pnpm gen:sql` / `gen:seed` | Regenerate reference SQL (role permissions, transitions) and `seed.sql` from TypeScript |

## Repository layout

```
apps/
  web/            Next.js app: landing, auth, workspace, command center, admin, API v1, webhooks
  worker/         Outbox delivery and webhook retry loop
packages/
  types/          Zod schemas for every entity, enum and API input
  auth/           Roles → permissions, authorization, step-up, TOTP
  workflow/       Transaction state machine, facts, rules, jurisdictions, timeline
  database/       Table gateway: in-memory (demo/tests) and Supabase (PostgREST) implementations
  core/           Domain services (transactions, documents, money, closing, ownership…), events, demo seed
  integrations/   Provider interfaces, sandbox adapters, Plaid/Resend/Twilio adapters, registry
  security/       Webhook signatures, field encryption, masking, rate limits, upload checks, fraud signals
  audit/          Audit actions, domain event types
  config/         Environment parsing, feature flags
  ui/             Design system: primitives, domain components and the product icon set (ProductIcon, IconTile)
  i18n/           en, sv, pl, de catalogues and formatting
supabase/         Migrations, generated reference data, RLS, storage policies, seed, database tests
docs/             Architecture, data model, security, threat model, integrations, deployment…
```

## Documentation

- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Security](docs/security.md) and [threat model](docs/threat-model.md)
- [Integrations](docs/integrations.md) and [provider adapters](docs/provider-adapters.md)
- [Money service (Go) — design](docs/money-service.md)
- [Compliance boundaries](docs/compliance-boundaries.md)
- [Deployment](docs/deployment.md)

## Status

| Area | State |
| --- | --- |
| Domain model, state machine, RLS, services, web app, demo | Implemented and tested |
| Banking (Plaid), email (Resend), SMS (Twilio) | Production adapters implemented |
| Identity (e.g. Persona), e-signature (e.g. DocuSign), payments and escrow partner | Interfaces and sandbox adapters are implemented. Production adapters are **not yet written**, and production start-up refuses to run on sandbox adapters. |
| Property data, mortgage, title, insurance | Manual adapters, where professionals enter the data |
| Legal pages | Drafts; they need counsel review |
