# Deployment

## Components

| Component | Runs as | Notes |
| --- | --- | --- |
| `apps/web` | Next.js (Node runtime), e.g. Vercel or a container | Stateless; scale horizontally |
| `apps/worker` | Long-running Node process (`pnpm worker`) | Required in Supabase mode. Safe to run several instances: rows are claimed with compare-and-set. `pnpm --filter @sagolik/worker once` runs a single pass (for cron). |
| Supabase | Postgres, Auth, Storage | Apply `supabase/migrations` in order. **Do not** load `seed.sql` in production. |

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

`.github/workflows/ci.yml` runs typecheck, unit tests, database tests (Postgres 16 service) and Playwright e2e on every push and pull request.
