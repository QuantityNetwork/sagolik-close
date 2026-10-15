#!/usr/bin/env bash
# Writes an environment's secrets into its Key Vaults through Azure Resource
# Manager (the vaults have no public access). Values never touch the command
# line or shell history: they're read from files and the environment into a
# parameters file only the current user can read, which is deleted on exit.
# Run once per environment after the key ceremony; rerun to add or rotate.
#
#   RESOURCE_GROUP=rg-sagolik-dev CORE_VAULT=<name> \
#   DATA_KEYS_WRAPPED='v1:…' DATA_KEK_ID='https://…/keys/data-kek/<version>' \
#   NEW_SESSION_SECRET=1 \
#     infra/azure/scripts/set-secrets.sh
#
# Optional:
#   MONEY_VAULT=<name> CERTS_DIR=<cmd/devcerts output>   the money service's mTLS and assertion material
#   NEW_CHAIN_DEAL_SALT=1 CHAIN_RECORDER_KEY_ID=…         the deal record on Base (generate the salt once, keep it)
#   PLAID_SECRET_FILE=<file>                              Plaid, for the money service
# Requires: az (signed in, with rights to deploy to the resource group), jq, openssl.
set -euo pipefail
umask 077

here="$(cd "$(dirname "$0")/.." && pwd)"
: "${RESOURCE_GROUP:?set RESOURCE_GROUP}" "${CORE_VAULT:?set CORE_VAULT}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

params='{}'
add() { params="$(jq --arg k "$1" --arg v "$2" '. + {($k): {value: $v}}' <<<"$params")"; }
add_file() { [ -f "$2" ] || { echo "missing $2" >&2; exit 1; }; params="$(jq --arg k "$1" --rawfile v "$2" '. + {($k): {value: $v}}' <<<"$params")"; }

add coreVaultName "$CORE_VAULT"
[ -n "${MONEY_VAULT:-}" ] && add moneyVaultName "$MONEY_VAULT"
[ -n "${NEW_SESSION_SECRET:-}" ] && add sessionSecret "$(openssl rand -hex 32)"
[ -n "${DATA_KEYS_WRAPPED:-}" ] && add dataKeysWrapped "$DATA_KEYS_WRAPPED"
[ -n "${DATA_KEK_ID:-}" ] && add dataKekId "$DATA_KEK_ID"
[ -n "${NEW_CHAIN_DEAL_SALT:-}" ] && add chainDealSalt "$(openssl rand -hex 32)"
[ -n "${CHAIN_RECORDER_KEY_ID:-}" ] && add chainRecorderKeyId "$CHAIN_RECORDER_KEY_ID"
if [ -n "${CERTS_DIR:-}" ]; then
  add_file moneyCa "$CERTS_DIR/ca.pem"
  add_file webClientCert "$CERTS_DIR/web.pem"
  add_file webClientKey "$CERTS_DIR/web-key.pem"
  add_file workerClientCert "$CERTS_DIR/worker.pem"
  add_file workerClientKey "$CERTS_DIR/worker-key.pem"
  add_file assertionSigningJwk "$CERTS_DIR/signing.jwk"
  add_file moneyServerCert "$CERTS_DIR/server.pem"
  add_file moneyServerKey "$CERTS_DIR/server-key.pem"
  add_file moneyAssertionJwks "$CERTS_DIR/jwks.json"
fi
[ -n "${PLAID_SECRET_FILE:-}" ] && add_file plaidSecret "$PLAID_SECRET_FILE"

jq -n --argjson p "$params" '{"$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#", contentVersion: "1.0.0.0", parameters: $p}' > "$work/parameters.json"
echo "Writing: $(jq -r '.parameters | keys - ["coreVaultName", "moneyVaultName"] | join(", ")' "$work/parameters.json")"
az deployment group create --resource-group "$RESOURCE_GROUP" --name "secrets-$(date -u +%Y%m%d%H%M%S)" \
  --template-file "$here/secrets.bicep" --parameters "@$work/parameters.json" --only-show-errors --output none
echo "Done. Secrets now in the vaults (names only):"
az rest --method get --url "https://management.azure.com$(az keyvault show --name "$CORE_VAULT" --query id -o tsv)/secrets?api-version=2024-11-01" --query "value[].name" -o tsv
if [ -n "${MONEY_VAULT:-}" ]; then
  az rest --method get --url "https://management.azure.com$(az keyvault show --name "$MONEY_VAULT" --query id -o tsv)/secrets?api-version=2024-11-01" --query "value[].name" -o tsv
fi
