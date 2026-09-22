#!/usr/bin/env bash
# Spins up a throwaway PostgreSQL 16, applies every migration + the seed, and
# runs the SQL test suites (RLS / tenant isolation / immutability / state guard).
#
#   pnpm test:db
#
# Requires PostgreSQL server binaries (initdb, pg_ctl). Set PG_BIN to override.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$ROOT/.tmp/pgtest"
PORT="${PGTEST_PORT:-54329}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then RUN_AS=(runuser -u postgres --); fi

rm -rf "$WORK" && mkdir -p "$WORK"
chmod 777 "$WORK"
"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
trap '"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true' EXIT

PSQL=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -d postgres -c "create database sagolik_test" >/dev/null
PSQL+=(-d sagolik_test)

echo "→ stub Supabase platform objects"
"${PSQL[@]}" -f "$ROOT/supabase/tests/stub_supabase.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ migration $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
echo "→ seed"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"

status=0
for t in "$ROOT"/supabase/tests/*_test.sql; do
  echo "→ $(basename "$t")"
  if ! "${PSQL[@]}" -f "$t"; then status=1; fi
done
[ $status -eq 0 ] && echo "✓ database tests passed" || echo "✗ database tests failed"
exit $status
