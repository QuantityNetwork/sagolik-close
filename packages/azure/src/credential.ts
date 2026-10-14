/**
 * How workloads sign in to Azure services. In Azure, always the workload's
 * user-assigned managed identity (named by AZURE_CLIENT_ID), never a secret.
 * On a developer machine, the Azure CLI or VS Code sign-in.
 */
import { DefaultAzureCredential, ManagedIdentityCredential, type TokenCredential } from "@azure/identity";

export type { TokenCredential };

export function azureCredential(clientId = process.env.AZURE_CLIENT_ID): TokenCredential {
  // Explicit managed identity in Azure, so a stray developer credential can never be picked up there.
  if (clientId) return new ManagedIdentityCredential({ clientId });
  return new DefaultAzureCredential();
}

/** Scope for Entra tokens accepted by Azure Database for PostgreSQL. */
export const POSTGRES_ENTRA_SCOPE = "https://ossrdbms-aad.database.windows.net/.default";

/** A password provider for node-postgres: a fresh Entra access token for each new connection. */
export function entraPostgresPassword(credential: TokenCredential): () => Promise<string> {
  return async () => {
    const token = await credential.getToken(POSTGRES_ENTRA_SCOPE);
    if (!token?.token) throw new Error("Couldn't get an Entra access token for PostgreSQL.");
    return token.token;
  };
}
