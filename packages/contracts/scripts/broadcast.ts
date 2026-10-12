/**
 * Sends a transaction that was signed elsewhere (e.g. by PayBox) and waits
 * for it. For a deployment, checks the new registry's admin and recorder.
 *
 *   node --experimental-strip-types scripts/broadcast.ts --network base-sepolia --raw 0x… [--rpc https://…]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, keccak256, stringToHex, type Abi, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const networks = { base, "base-sepolia": baseSepolia } as const;
const network = arg("network") as keyof typeof networks | undefined;
if (!network || !(network in networks)) throw new Error("--network must be base or base-sepolia");
const raw = arg("raw") as Hex | undefined;
if (!raw?.startsWith("0x")) throw new Error("--raw must be the signed transaction (0x…)");
const chain = networks[network];
const client = createPublicClient({ chain, transport: http(arg("rpc") ?? chain.rpcUrls.default.http[0]) });

const hash = await client.sendRawTransaction({ serializedTransaction: raw });
console.log(`sent ${hash}`);
const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
console.log(`status ${receipt.status} in block ${receipt.blockNumber}`);
if (receipt.contractAddress) {
  const here = dirname(fileURLToPath(import.meta.url));
  const { abi } = JSON.parse(readFileSync(join(here, "../artifacts/contracts/SagolikDealRegistry.sol/SagolikDealRegistry.json"), "utf8")) as { abi: Abi };
  const address = receipt.contractAddress;
  const admin = await client.readContract({ address, abi, functionName: "defaultAdmin" });
  console.log(JSON.stringify({ registry: address, admin, recorderRole: keccak256(stringToHex("RECORDER_ROLE")) }, null, 2));
}
