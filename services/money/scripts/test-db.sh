#!/usr/bin/env bash
# Runs the money service tests against a throwaway PostgreSQL 16.
# Requires PostgreSQL server binaries (initdb, pg_ctl). Set PG_BIN to override.
set -euo pipefail
cd "$(dirname "$0")/.."

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PG_BIN/initdb" ] || { echo "PostgreSQL server binaries not found (set PG_BIN)"; exit 1; }
WORK="$(mktemp -d)"
PORT="${PORT:-55432}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then RUN_AS=(runuser -u postgres --); chown postgres "$WORK"; fi

"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
trap '"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
"$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -q -c "create database money_test" >/dev/null

export MONEY_TEST_DATABASE_URL="postgres://postgres@/money_test?host=$WORK&port=$PORT&sslmode=disable"
go test -race -count=1 "${@:-./...}"
