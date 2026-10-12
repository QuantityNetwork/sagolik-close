import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";

// Deployment happens outside Hardhat: scripts/deploy-tx.ts builds an unsigned
// transaction for the treasury wallet to sign (PayBox), so no private key is
// ever configured here.
const compiler = {
  version: "0.8.30",
  settings: {
    evmVersion: "cancun",
    optimizer: { enabled: true, runs: 200 },
  },
};

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: compiler,
      production: compiler,
    },
  },
  networks: {
    // Base is an OP-stack chain.
    hardhatBase: {
      type: "edr-simulated",
      chainType: "op",
    },
  },
});
