# Deployment

## Components

| Component | Runs as | Notes |
| --- | --- | --- |
| `apps/web` | Next.js (Node runtime), e.g. Vercel or a container | Stateless; scale horizontally |
| `apps/worker` | Long-running Node process (`pnpm worker`) | Required in Supabase mode. Safe to run several instances: rows are claimed with compare-and-set. `pnpm --filter @sagolik/worker once` runs a single pass (for cron). |
| Supabase | Postgres, Auth, Storage | Apply `supabase/migrations` in order. **Do not** load `seed.sql` in production. |

## Launch paths

### A. Public site with live demo (can ship today)

The marketing site, contact form and the interactive demo all run without Supabase or provider contracts. The demo uses fictional data and sandbox providers, and a banner on every app page says so.

This mode keeps state in memory, so run **exactly one instance** of a long-running container. Serverless platforms spread requests across instances, and each instance would hold its own copy of the demo.

```bash
docker build --target web -t sagolik-close .
docker run -p 3000:3000 \
  -e APP_ENV=staging -e DEMO_MODE=true -e DEMO_RESET_HOURS=6 \
  -e APP_URL=https://close.sagolik.com \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e RESEND_API_KEY=… -e CONTACT_INBOX=hello@… \
  sagolik-close
```

Any container host works: Fly.io, Railway, Render, Google Cloud Run with max instances set to 1, or a VM. Point `close.sagolik.com` at it (a CNAME, or an A record for a VM) and terminate TLS at the host. Health check: `GET /api/health`.

- `DEMO_RESET_HOURS` restores the fictional closing at regular intervals, so every visitor sees the intended journey.
- Transaction emails to fictional people never leave the in-memory outbox.
- Contact-form enquiries do reach `CONTACT_INBOX` when `RESEND_API_KEY` is set.

### B. Full product (real accounts, real closings)

This path needs Supabase, plus production adapters for identity, e-signature, payments and escrow (see [integrations.md](integrations.md)). The app refuses to start with `APP_ENV=production` until those adapters exist. It can run on Vercel with the root directory set to `apps/web`, or on the same container image with any number of instances. Run the worker next to it: `docker build --target worker`, or `pnpm worker`.

## Production checklist

1. `APP_ENV=production`, `APP_URL=https://close.sagolik.com`. The app refuses to start if it would run in demo mode.
2. Supabase URL, anon key, and service role key (server and worker only).
3. `SESSION_SECRET` (at least 32 random characters) and `DATA_ENCRYPTION_KEYS` (`v1:<32-byte base64>`). Keep them in the platform's secret store. Rotate the encryption key by adding `v2:…` at the front and keeping `v1` until the data is re-encrypted.
4. Real adapters for banking, identity, signatures, payments and escrow. Production refuses sandbox adapters (see [integrations.md](integrations.md)).
5. Webhook endpoints registered with each provider: `https://close.sagolik.com/api/webhooks/{provider}`, with their signing secrets set.
6. Supabase Auth configuration:
   - site URL, and redirect URL `/auth/callback`
   - TOTP MFA enabled
   - SAML SSO, if used
   - SMTP set to the Resend domain
7. Replace the in-memory rate-limit store with Redis (`RateLimitStore`), and the mock virus scanner with a real one.
8. `SENTRY_DSN` for errors. Logs are JSON lines with `requestId` and `correlationId`.
9. Health check: `GET /api/health`. It returns mode, database status and provider modes, and never secrets.

## Database changes

- Add a new timestamped migration. Never edit an applied one.
- If a role's permissions or the transition table changed, run `pnpm gen:sql`.
- Run `pnpm test` (the schema-parity test catches drift between Zod and SQL) and `pnpm test:db` (RLS and integrity checks against a real Postgres).

## CI

`.github/workflows/ci.yml` runs typecheck, unit tests, database tests (Postgres 16) and Playwright e2e on every push and pull request. The e2e job runs against the **production standalone build**, because the nonce-based CSP only applies to real builds.
