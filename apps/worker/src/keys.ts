/**
 * Key ceremony helpers for Azure Key Vault. Nothing here ever sees a private
 * key: Key Vault generates the keys in its HSM and only wraps or signs. Runs
 * inside the network as the `keys` job (Key Vault has no public access),
 * signed in as the worker's managed identity; the output is public material
 * only (a wrapped data key, key versions, an address).
 *
 *   keys ceremony <data key version> <data-kek id> <chain-recorder id>
 *       One JSON line: the DATA_KEYS_WRAPPED entry for a new random data key,
 *       the exact key versions for DATA_KEK_ID and CHAIN_RECORDER_KEY_ID, and
 *       the recording account's Ethereum address (grant it RECORDER_ROLE and
 *       fund it with a little gas).
 *   keys recorder-address <key id>
 *   keys new-data-key <version> <key id>
 *   keys rewrap <old data-kek version id> <new data-kek version id>
 *       Key-encryption key rotation: re-wraps DATA_KEYS_WRAPPED (read from the
 *       environment) under the new version; prints the new DATA_KEYS_WRAPPED
 *       and DATA_KEK_ID. The data keys themselves, and the data, don't change.
 */
import { azureCredential, keyVaultSecp256k1Signer, keyVaultWrapper, newWrappedDataKey, rewrapKeyRing, secp256k1Account } from "@sagolik/azure";

const [command, ...args] = process.argv.slice(2);
const usage =
  "usage: keys ceremony <data key version> <data-kek id> <chain-recorder id> | keys recorder-address <key id> | keys new-data-key <version> <key id> | keys rewrap <old version id> <new version id>";

async function recorder(keyId: string) {
  const signer = await keyVaultSecp256k1Signer(keyId, azureCredential());
  return { keyId: signer.keyId, address: (await secp256k1Account(signer)).address };
}

async function main() {
  const credential = azureCredential();
  if (command === "ceremony" && args.length === 3) {
    const data = await newWrappedDataKey(args[0]!, keyVaultWrapper(args[1]!, credential));
    const chain = await recorder(args[2]!);
    console.log(
      JSON.stringify({
        msg: "key ceremony",
        DATA_KEYS_WRAPPED_ENTRY: data.entry,
        DATA_KEK_ID: data.keyId,
        CHAIN_RECORDER_KEY_ID: chain.keyId,
        recordingAccount: chain.address,
      }),
    );
  } else if (command === "recorder-address" && args.length === 1) {
    console.log(JSON.stringify(await recorder(args[0]!)));
  } else if (command === "rewrap" && args.length === 2) {
    const wrapped = process.env.DATA_KEYS_WRAPPED;
    if (!wrapped) throw new Error("Set DATA_KEYS_WRAPPED (the current entries) for the job.");
    const out = await rewrapKeyRing(wrapped, keyVaultWrapper(args[0]!, credential), keyVaultWrapper(args[1]!, credential));
    console.log(JSON.stringify({ msg: "key rotation", DATA_KEYS_WRAPPED: out.wrapped, DATA_KEK_ID: out.keyId }));
  } else if (command === "new-data-key" && args.length === 2) {
    console.log(JSON.stringify(await newWrappedDataKey(args[0]!, keyVaultWrapper(args[1]!, credential))));
  } else {
    console.error(usage);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
