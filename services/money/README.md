# Money service (Go)

Isolated service that will own bank tokens, payment instructions, provider events and the funds-tracking ledger for Sagolik Close. It never holds client funds. Design: [docs/money-service.md](../../docs/money-service.md).

**Status: M1 (foundation), M2 (instructions and ledger) and M3 (Plaid) complete.** The web app uses it when `MONEY_SERVICE_URL` is set. M3 is verified against Plaid's live sandbox: the automated live test, plus a Hosted Link session completed by a person and finished with this client (public token from `/link/token/get`, exchange, Identity, Balance, removal).

## What M1 provides

| Area | Implementation |
| --- | --- |
| Transport | TLS 1.3 only. Client certificates are required, and the caller's workload identity (URI SAN, e.g. `spiffe://sagolik/web`) is pinned (`internal/mtls`). |
| Caller identity | A per-request Ed25519 user assertion: algorithm pinned, strict decoding, at most 60 s, single use through a Postgres replay guard (`internal/assertion`). The web app signs it with `signUserAssertion` in `@sagolik/security`. A shared test vector keeps TypeScript and Go byte-compatible. |
| Encryption | Envelope encryption: a fresh AES-256-GCM data key per value, bound to its purpose and record. Key providers: **local keyring** (no cost), **Azure Key Vault** (RSA-HSM key, the target platform) or **AWS KMS** (`internal/keys`). |
| Data | Own Postgres database. Embedded migrations. A **double-entry ledger** where every group must balance, checked at commit. A **hash-chained audit log** that detects any edit. Triggers make both append-only even for the runtime role (`internal/store`). |
| Instructions (M2) | Versioned, sealed payment instructions: cooling-off on changes, second-person verification (the author is refused), step-up for every write, and audited reveal of full wire details to the payer. |
| Ledger (M2) | Escrow-reported movements (expected, received, paid out), idempotent per reference, double-entry. |
| Bank connections (M3) | Plaid Hosted Link: the person picks their bank and consents on Plaid's pages. Only Identity (account ownership) and Balance (proof of funds) are used; Auth isn't requested, so full account and routing numbers never arrive. The access token is sealed and can only be destroyed (disconnect). Proof of funds compares a real-time balance with what the closing needs: the owner sees the balance, everyone else only the result. Plaid webhooks arrive on a separate listener and are checked against Plaid's signed JWT (`internal/plaid`). |
| API | `GET /v1/session`, `GET /v1/transactions/{id}/funds`, plus instruction and ledger endpoints (see `api/openapi.yaml`). Funds reads are policy-checked (roles mirror the web app, with a parity test) and audited; if the audit write fails, no data is returned (`internal/httpapi`, `api/openapi.yaml`). |
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

### With Plaid (sandbox)

```bash
printf '%s' "$YOUR_PLAID_SANDBOX_SECRET" > .dev/plaid-secret && chmod 600 .dev/plaid-secret
MONEY_PLAID_ENV=sandbox MONEY_PLAID_CLIENT_ID=<client id> MONEY_PLAID_SECRET_FILE=.dev/plaid-secret \
MONEY_PLAID_REDIRECT_URI=http://localhost:3000/api/v1/bank-connections/callback \
# optional webhooks: MONEY_WEBHOOK_ADDR=127.0.0.1:8090 MONEY_PLAID_WEBHOOK_URL=https://<public tunnel>/webhooks/plaid
…the command above
```

| Variable | Meaning |
| --- | --- |
| `MONEY_PLAID_ENV` | `off` (default), `sandbox` or `production`. Sandbox is refused when `MONEY_ENV=production`. |
| `MONEY_PLAID_CLIENT_ID` | Plaid client id. |
| `MONEY_PLAID_SECRET_FILE` / `MONEY_PLAID_SECRET` | Exactly one. Prefer the file; the variable is for secrets injected by AWS Secrets Manager. |
| `MONEY_PLAID_REDIRECT_URI` | The web app's `/api/v1/bank-connections/callback` (https outside local). Plaid returns the person there with `?link=…`. |
| `MONEY_PLAID_OPTIONAL_PRODUCTS` | Optional, comma-separated `transactions` and/or `liabilities` for Property Autopilot (read-only). Requested as Plaid optional products; the `/transactions` and `/mortgages` endpoints answer 503 unless listed. |
| `MONEY_WEBHOOK_ADDR`, `MONEY_PLAID_WEBHOOK_URL` | Optional. A separate listener for Plaid webhooks (no mTLS, since Plaid can't present a client certificate; every request is signature-checked). Put it behind the load balancer or WAF that terminates TLS. |

### On Azure

The target platform ([docs/azure/architecture.md](../../docs/azure/architecture.md)): the service signs in with its user-assigned managed identity, so neither the database nor Key Vault needs a stored credential.

| Variable | Meaning |
| --- | --- |
| `AZURE_CLIENT_ID` | The service's managed identity. Required outside local development whenever Azure is used. |
| `MONEY_KEY_PROVIDER=azurekv`, `MONEY_AZURE_KEY_ID` | Key Vault key that wraps every data key (RSA-OAEP-256): `https://<vault>.vault.azure.net/keys/money-kek`. The key never leaves the HSM. Rotate by adding a key version: new values use it, older values keep the version they name. Stored values can only ever point at versions of this key. |
| `MONEY_DATABASE_AUTH=entra` | Sign in to Azure Database for PostgreSQL with an Entra token instead of a password; `MONEY_DATABASE_URL` then carries none (`postgres://<identity name>@<server>.postgres.database.azure.com:5432/money?sslmode=verify-full`). |
| `MONEY_HEALTH_ADDR` | Set to `:8081` so the platform's health probes can reach `/healthz` and `/readyz`. |

## Test and check

```bash
./scripts/test-db.sh            # all tests, race detector, throwaway PostgreSQL 16
./scripts/integration.sh        # the web app's services against this service over mTLS
go vet ./...
go run honnef.co/go/tools/cmd/staticcheck@2025.1.1 ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...
go run github.com/securego/gosec/v2/cmd/gosec@v2.29.0 ./...

# Live Plaid sandbox (your keys; skipped when unset)
PLAID_CLIENT_ID=… PLAID_SECRET=… go test ./internal/plaid -run LiveSandbox -v
```

CI runs all of the above (the `money-service` job).

## Costs

Nothing in M1 or M2 needs a paid service or a contract. The local keyring is the default. Azure Key Vault Premium and AWS KMS are pay-as-you-go per key and per operation, with no commitment. Production refuses local keys unless you set `MONEY_ALLOW_LOCAL_KEYS_IN_PRODUCTION=true`, so file-based keys can only be used as a deliberate, recorded choice.

Plaid: the sandbox is free. Production needs Plaid's approval and is billed by Plaid under the plan you choose (at the time of writing, Identity is charged per connected account and Balance per request; check Plaid's current pricing before going live). To keep that bill small, the service calls Balance only when the buyer asks for a funds check, at most five times per account per hour, and never polls. Transactions and Liabilities are off unless `MONEY_PLAID_OPTIONAL_PRODUCTS` lists them; each read happens only when the account's owner asks (Check bank activity).
