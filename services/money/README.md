# Money service (Go)

Isolated service that will own bank tokens, payment instructions, provider events and the funds-tracking ledger for Sagolik Close. It never holds client funds. Design: [docs/money-service.md](../../docs/money-service.md).

**Status: M1 (foundation) complete.** The web app does not call it yet; M2 moves instruction and ledger logic here.

## What M1 provides

| Area | Implementation |
| --- | --- |
| Transport | TLS 1.3 only. Client certificates are required, and the caller's workload identity (URI SAN, e.g. `spiffe://sagolik/web`) is pinned (`internal/mtls`). |
| Caller identity | A per-request Ed25519 user assertion: algorithm pinned, strict decoding, at most 60 s, single use through a Postgres replay guard (`internal/assertion`). The web app signs it with `signUserAssertion` in `@sagolik/security`. A shared test vector keeps TypeScript and Go byte-compatible. |
| Encryption | Envelope encryption: a fresh AES-256-GCM data key per value, bound to its purpose and record. Two key providers: **local keyring** (no cost) or **AWS KMS** (optional, pay per use) (`internal/keys`). |
| Data | Own Postgres database. Embedded migrations. A **double-entry ledger** where every group must balance, checked at commit. A **hash-chained audit log** that detects any edit. Triggers make both append-only even for the runtime role (`internal/store`). |
| API | `GET /v1/session` and `GET /v1/transactions/{id}/funds`. Funds reads are policy-checked (roles mirror the web app, with a parity test) and audited; if the audit write fails, no data is returned (`internal/httpapi`, `api/openapi.yaml`). |
| Operations | A private health listener (`/healthz`, and `/readyz`, which checks the database plus a key round-trip). JSON logs without ids or secrets. Config that refuses unsafe setups (plaintext, local keys in production, and the database without `sslmode=verify-full` outside local). A 25 MB distroless non-root image. |

## Run locally

```bash
cd services/money
go run ./cmd/devcerts -out .dev          # local CA, server + client certs, keyring (git-ignored)
MONEY_DATABASE_URL=postgres://localhost/money?sslmode=disable \
MONEY_MIGRATE_ON_START=true \
MONEY_TLS_CERT_FILE=.dev/server.pem MONEY_TLS_KEY_FILE=.dev/server-key.pem \
MONEY_TLS_CLIENT_CA_FILE=.dev/ca.pem MONEY_TLS_ALLOWED_CLIENTS=spiffe://sagolik/web \
MONEY_LOCAL_KEYRING_FILE=.dev/keyring.json \
MONEY_ASSERTION_JWKS_FILE=path/to/web-jwks.json \
go run ./cmd/money
```

## Test and check

```bash
./scripts/test-db.sh            # all tests, race detector, throwaway PostgreSQL 16
go vet ./...
go run honnef.co/go/tools/cmd/staticcheck@2025.1.1 ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...
go run github.com/securego/gosec/v2/cmd/gosec@v2.29.0 ./...
```

CI runs all of the above (the `money-service` job).

## Costs

Nothing in M1 needs a paid service or a contract. The local keyring is the default. AWS KMS is optional, pay-as-you-go per key and per request, with no commitment. Production refuses local keys unless you set `MONEY_ALLOW_LOCAL_KEYS_IN_PRODUCTION=true`, so file-based keys can only be used as a deliberate, recorded choice.
