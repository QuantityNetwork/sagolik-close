#!/usr/bin/env bash
# Cross-service integration: the web app's services (TypeScript) against the
# real money service (Go) over mutual TLS with signed assertions, on a
# throwaway PostgreSQL 16.
set -euo pipefail
cd "$(dirname "$0")/.."
MONEY_DIR="$(pwd)"
REPO="$(cd ../.. && pwd)"

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
PGPORT="${PGPORT:-55433}"
API_PORT="${API_PORT:-58443}"
HEALTH_PORT="${HEALTH_PORT:-58081}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then RUN_AS=(runuser -u postgres --); chown postgres "$WORK"; fi
SERVICE_PID=""
PLAID_PID=""
cleanup() {
  [ -n "$SERVICE_PID" ] && kill "$SERVICE_PID" 2>/dev/null || true
  [ -n "$PLAID_PID" ] && kill "$PLAID_PID" 2>/dev/null || true
  "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PGPORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null
"$PG_BIN/psql" -h "$WORK" -p "$PGPORT" -U postgres -q -c "create database money" >/dev/null

mkdir -p "$WORK/certs" && chmod 700 "$WORK/certs"
go run ./cmd/devcerts -out "$WORK/certs" >/dev/null
# Web app's assertion signing key (private JWK for TS) and public JWKS (for Go).
node -e '
const { generateKeyPairSync } = require("node:crypto");
const fs = require("node:fs");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const dir = process.argv[1];
fs.writeFileSync(dir + "/signing.jwk", JSON.stringify(privateKey.export({ format: "jwk" })), { mode: 0o600 });
const pub = publicKey.export({ format: "jwk" });
fs.writeFileSync(dir + "/jwks.json", JSON.stringify({ keys: [{ kty: "OKP", crv: "Ed25519", kid: "web-it", x: pub.x, use: "sig", alg: "EdDSA" }] }));
' "$WORK/certs"

go build -o "$WORK/money" ./cmd/money
# Stand-in Plaid API (same request/response shapes as Plaid's reference).
go build -o "$WORK/plaidfake" ./cmd/plaidfake
"$WORK/plaidfake" > "$WORK/plaid.url" 2>"$WORK/plaid.log" &
PLAID_PID=$!
for _ in $(seq 1 50); do [ -s "$WORK/plaid.url" ] && break; sleep 0.1; done
PLAID_URL="$(head -1 "$WORK/plaid.url")"
printf 'test-secret' > "$WORK/certs/plaid-secret" && chmod 600 "$WORK/certs/plaid-secret"
MONEY_PLAID_ENV=sandbox MONEY_PLAID_CLIENT_ID=test-client-id MONEY_PLAID_SECRET_FILE="$WORK/certs/plaid-secret" \
MONEY_PLAID_OPTIONAL_PRODUCTS=transactions,liabilities \
MONEY_PLAID_BASE_URL="$PLAID_URL" MONEY_PLAID_REDIRECT_URI="http://localhost:3000/api/v1/bank-connections/callback" \
MONEY_ENV=local \
MONEY_LISTEN_ADDR="127.0.0.1:$API_PORT" MONEY_HEALTH_ADDR="127.0.0.1:$HEALTH_PORT" \
MONEY_DATABASE_URL="postgres://postgres@/money?host=$WORK&port=$PGPORT&sslmode=disable" MONEY_MIGRATE_ON_START=true \
MONEY_TLS_CERT_FILE="$WORK/certs/server.pem" MONEY_TLS_KEY_FILE="$WORK/certs/server-key.pem" \
MONEY_TLS_CLIENT_CA_FILE="$WORK/certs/ca.pem" MONEY_TLS_ALLOWED_CLIENTS=spiffe://sagolik/web \
MONEY_LOCAL_KEYRING_FILE="$WORK/certs/keyring.json" MONEY_ASSERTION_JWKS_FILE="$WORK/certs/jwks.json" \
  "$WORK/money" > "$WORK/money.log" 2>&1 &
SERVICE_PID=$!
for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$HEALTH_PORT/readyz" >/dev/null && break; sleep 0.2; done
curl -sf "http://127.0.0.1:$HEALTH_PORT/readyz" >/dev/null || { echo "money service did not become ready"; cat "$WORK/money.log"; exit 1; }

cd "$REPO"
set +e
MONEY_IT_URL="https://localhost:$API_PORT" \
MONEY_IT_CA="$WORK/certs/ca.pem" MONEY_IT_CERT="$WORK/certs/web.pem" MONEY_IT_KEY="$WORK/certs/web-key.pem" \
MONEY_IT_SIGNING_JWK="$WORK/certs/signing.jwk" MONEY_IT_PLAID_FAKE="$PLAID_URL" \
  npx vitest run packages/core/src/money/money.integration.test.ts
status=$?
set -e
if [ $status -ne 0 ]; then echo "--- money service log"; cat "$WORK/money.log"; fi
exit $status
