/**
 * Restores the sandbox bank's connections from persisted records, so seeded
 * demo flows keep working across restarts (and in the test harness).
 */
import type { Db } from "@sagolik/database";
import type { MockBankingProvider } from "@sagolik/integrations";
import { decryptField, type KeyRing } from "@sagolik/security";
import { addDays } from "@sagolik/workflow";
import { alexBankScript, DEMO_ALEX_BANK } from "./bank-script";

export async function restoreSandboxBanking(db: Db, banking: MockBankingProvider, keyRing: KeyRing) {
  for (const conn of await db.bank_connections.find({ provider: banking.info.id, status: ["connected", "reauthentication_required"] })) {
    const secret = await db.bank_connection_secrets.findOne({ connectionId: conn.id });
    const profile = await db.profiles.get(conn.userId);
    if (!secret || !profile || !conn.externalConnectionId) continue;
    const accounts = await db.bank_accounts.find({ connectionId: conn.id }, { orderBy: "createdAt" });
    const scripted = conn.externalConnectionId === DEMO_ALEX_BANK.externalConnectionId;
    banking.seedConnection({
      accessToken: decryptField(secret.encryptedAccessToken, keyRing, `bank_connection:${conn.id}`),
      externalConnectionId: conn.externalConnectionId,
      institutionId: conn.institutionId,
      ownerName: profile.fullName,
      seed: 1,
      masks: [accounts[0]?.mask ?? "0000", accounts[1]?.mask ?? "0001"],
      // The demo was built `connectedDaysAgo` days after this connection was made.
      script: scripted ? alexBankScript(addDays(conn.createdAt.slice(0, 10), DEMO_ALEX_BANK.connectedDaysAgo)) : undefined,
    });
  }
}
