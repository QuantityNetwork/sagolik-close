/**
 * Builds the unsigned deployment transaction for SagolikDealRegistry, for the
 * admin wallet (Sagolik Treasury) to sign — for example with PayBox. Nothing
 * is signed or sent here, and no private key is involved.
 *
 *   node --experimental-strip-types scripts/deploy-tx.ts \
 *     --network base-sepolia --admin 0x… --recorder 0x… [--rpc https://…]
 *
 * Prints JSON: the transaction to sign, the address the contract will have,
 * and the most it can cost in ETH.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, encodeDeployData, formatEther, getAddress, getContractAddress, http, type Abi, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const networks = { base, "base-sepolia": baseSepolia } as const;
const network = arg("network") as keyof typeof networks | undefined;
if (!network || !(network in networks)) throw new Error("--network must be base or base-sepolia");
const chain = networks[network];
const admin = getAddress(arg("admin") ?? "");
const recorder = getAddress(arg("recorder") ?? "");
if (admin === recorder) throw new Error("Use separate admin (treasury) and recorder (service) accounts.");

const here = dirname(fileURLToPath(import.meta.url));
const art = JSON.parse(readFileSync(join(here, "../artifacts/contracts/SagolikDealRegistry.sol/SagolikDealRegistry.json"), "utf8")) as { abi: Abi; bytecode: Hex };
const client = createPublicClient({ chain, transport: http(arg("rpc") ?? chain.rpcUrls.default.http[0]) });

const data = encodeDeployData({ abi: art.abi, bytecode: art.bytecode, args: [admin, recorder] });
const [nonce, estimate, fees] = await Promise.all([client.getTransactionCount({ address: admin }), client.estimateGas({ account: admin, data }), client.estimateFeesPerGas()]);
const gas = (estimate * 13n) / 10n;
const tx = {
  type: "eip1559",
  chainId: chain.id,
  from: admin,
  nonce,
  to: null,
  value: "0x0",
  data,
  gas: `0x${gas.toString(16)}`,
  maxFeePerGas: `0x${fees.maxFeePerGas.toString(16)}`,
  maxPriorityFeePerGas: `0x${fees.maxPriorityFeePerGas.toString(16)}`,
};
console.log(
  JSON.stringify(
    {
      network,
      transaction: tx,
      contractAddress: getContractAddress({ from: admin, nonce: BigInt(nonce) }),
      maxCostEth: formatEther(gas * fees.maxFeePerGas),
      constructor: { admin, recorder },
    },
    null,
    2,
  ),
);
