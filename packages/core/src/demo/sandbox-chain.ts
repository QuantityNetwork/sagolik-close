/**
 * Rebuilds the sandbox chain from persisted deal-record entries, so the
 * demo's records still verify after a restart (and every test harness starts
 * from a clean chain). Also scripts the demo buyers' sandbox wallet balances.
 */
import type { Db } from "@sagolik/database";
import { demoWallet, kindHex, type SandboxChainProvider } from "@sagolik/integrations";
import type { Hex } from "viem";
import { DEMO_PERSONAS } from "./seed";

/** Fictional USDC held in each demo buyer's sandbox wallet (cents). */
export const DEMO_WALLET_BALANCES: Record<string, number> = {
  "olivia.carter": 25_000_000,
};

export async function restoreSandboxChain(db: Db, chain: SandboxChainProvider) {
  chain.reset();
  const rows = (await db.chain_records.find({ network: "sandbox", status: "confirmed" })).sort((a, b) => (a.dealId === b.dealId ? a.sequence! - b.sequence! : a.dealId < b.dealId ? -1 : 1));
  for (const r of rows) {
    chain.hydrateRecord({ dealId: r.dealId as Hex, kind: kindHex(r.kind), digest: r.digest as Hex }, r.txHash as Hex, r.recordedAt ?? r.confirmedAt ?? r.createdAt, r.blockNumber ?? undefined);
  }
  for (const [key, cents] of Object.entries(DEMO_WALLET_BALANCES)) {
    const persona = DEMO_PERSONAS.find((p) => p.key === key);
    if (persona) chain.setUsdcBalance(demoWallet(persona.userId).address, cents);
  }
}
