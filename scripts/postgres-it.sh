#!/usr/bin/env bash
# The Azure flavour of the database, end to end, on a throwaway PostgreSQL 16:
#
#  1. The migrate command applies infra/azure/sql/bootstrap.sql and every
#     migration, as a non-superuser migration role (Azure has no superuser).
#  2. A login role, like a workload's managed identity, gets the API roles
#     (SET only, no inherited privileges).
#  3. The demo data goes in through the PostgreSQL store, as service_role.
#  4. The same SQL security suites the Supabase flavour passes: RLS, tenant
#     isolation, immutability, state guard.
#  5. The store's integration tests, connected as the workload login role.
#
#   pnpm test:db:azure
#
# Requires PostgreSQL server binaries (initdb, pg_ctl). Set PG_BIN to override.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$ROOT/.tmp/pg-azure"
PORT="${PGIT_PORT:-54330}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then RUN_AS=(runuser -u postgres --); fi

rm -rf "$WORK" && mkdir -p "$WORK"
chmod 777 "$WORK"
"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=127.0.0.1" -l "$WORK/log" -w start >/dev/null
trap '"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true' EXIT

PSQL=("$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -v ON_ERROR_STOP=1 -q -X -t -A)
# The migration role mirrors Azure's administrator: it owns the database and
# can create roles and bypass RLS, but it isn't a superuser.
"${PSQL[@]}" -U postgres -d postgres <<'SQL'
create role migrator login createrole bypassrls;
create database sagolik_it owner migrator;
create role app_workload login;
SQL

echo "→ migrate (bootstrap + migrations), grant the workload role, seed the demo data"
DATABASE_URL="postgres://migrator@127.0.0.1:$PORT/sagolik_it" APP_ENV=local DEMO_MODE=true \
  pnpm --silent --filter @sagolik/worker exec tsx src/migrate.ts --grant app_workload --seed-demo
echo "→ migrate again (nothing to do, nothing changed)"
DATABASE_URL="postgres://migrator@127.0.0.1:$PORT/sagolik_it" APP_ENV=local DEMO_MODE=true \
  pnpm --silent --filter @sagolik/worker exec tsx src/migrate.ts --seed-demo

status=0
for t in "$ROOT"/supabase/tests/*_test.sql; do
  echo "→ $(basename "$t")"
  if ! "${PSQL[@]}" -U postgres -d sagolik_it -f "$t"; then status=1; fi
done

echo "→ store integration tests (as the workload role)"
DATABASE_IT_URL="postgres://app_workload@127.0.0.1:$PORT/sagolik_it" CI_REQUIRE_DB_IT=1 \
  pnpm exec vitest run packages/core/src/postgres.integration.test.ts || status=1

[ $status -eq 0 ] && echo "✓ Azure database checks passed" || echo "✗ Azure database checks failed"
exit $status
