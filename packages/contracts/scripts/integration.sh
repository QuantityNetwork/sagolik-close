#!/usr/bin/env bash
# The Base adapter (packages/integrations/src/chain/base.ts) against a local
# Hardhat node running the compiled contracts. No real network, no real keys.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(cd ../.. && pwd)"
PORT="${CHAIN_IT_PORT:-58545}"
LOG="$(mktemp)"
pnpm exec hardhat node --port "$PORT" >"$LOG" 2>&1 &
NODE_PID=$!
trap 'kill $NODE_PID 2>/dev/null || true; rm -f "$LOG"' EXIT
for _ in $(seq 1 60); do
  curl -sf -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "http://127.0.0.1:$PORT" >/dev/null && break
  sleep 1
done
cd "$REPO"
CHAIN_IT_RPC_URL="http://127.0.0.1:$PORT" pnpm exec vitest run packages/integrations/src/chain/base.live.test.ts || { cat "$LOG"; exit 1; }
