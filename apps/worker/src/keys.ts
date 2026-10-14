/**
 * Key ceremony helpers for Azure Key Vault. Nothing here ever sees a private
 * key: Key Vault generates the keys in its HSM and only wraps or signs.
 * Signs in like the workloads do (managed identity in Azure, the Azure CLI
 * sign-in on an operator's machine).
 *
 *   pnpm --filter @sagolik/worker keys recorder-address <key id>
 *       The Ethereum address of a secp256k1 (P-256K) key: the deal-record
 *       recording account to grant RECORDER_ROLE and fund with a little gas.
 *   pnpm --filter @sagolik/worker keys new-data-key <version> <key id>
 *       A new random data key wrapped by the key-encryption key, printed as
 *       one DATA_KEYS_WRAPPED entry (add it at the front when rotating).
 */
import { azureCredential, keyVaultEvmAccount, keyVaultWrapper, newWrappedDataKey } from "@sagolik/azure";

const [command, ...args] = process.argv.slice(2);
const usage = "usage: keys recorder-address <key id> | keys new-data-key <version> <key id>";

async function main() {
  const credential = azureCredential();
  if (command === "recorder-address" && args.length === 1) {
    console.log((await keyVaultEvmAccount(args[0]!, credential)).address);
  } else if (command === "new-data-key" && args.length === 2) {
    console.log(await newWrappedDataKey(args[0]!, keyVaultWrapper(args[1]!, credential)));
  } else {
    console.error(usage);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
