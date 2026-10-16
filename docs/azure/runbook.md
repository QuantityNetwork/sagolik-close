# Runbook: deploying Sagolik Close on Azure

How to stand up an environment and keep it running. The design is in [architecture.md](architecture.md); the code is in [`infra/azure`](../../infra/azure) and [`.github/workflows/deploy-azure.yml`](../../.github/workflows/deploy-azure.yml).

Deployment runs in three phases, each including the ones before it:

| Phase | What it adds | When |
| --- | --- | --- |
| `platform` | Network, firewall or NAT, Key Vaults with their keys, PostgreSQL, Blob Storage, registry, Container Apps environments, Front Door and WAF, Defender, Sentinel, budget | First, and after infrastructure changes |
| `ceremony` | The images, and the `keys` job that wraps the data keys inside the network | Once per environment, and for key rotation |
| `apps` | The apps and jobs, database migrations, Front Door routes, smoke test | Every release |

Production waits for real sign-in on Microsoft Entra and contracted identity, signature, payment and escrow providers. The app refuses to start in production without them. Until then, deploy `dev` (the fictional demo on the real platform), and deploy production's `platform` phase if you want it ready.

## What you need

- A Microsoft Entra tenant and Azure subscriptions. Prefer one subscription per environment, so dev can never touch production.
- An Owner on each subscription for the one-off bootstrap. Afterwards, nobody needs standing rights: use Privileged Identity Management for the rare manual step.
- Admin rights on the GitHub repository, to create environments.
- On the operator's machine: Azure CLI 2.70 or later, `jq`, `openssl`, and Go 1.26 (only for the money service's certificates).

## 1. Bootstrap (once per subscription)

Sign in as an Owner of the subscription:

```bash
az login --tenant <tenant id>
az account set --subscription <subscription id>
```

Register the resource providers. Front Door's Private Link to Container Apps needs `Microsoft.Cdn` registered:

```bash
for p in Microsoft.App Microsoft.Cdn Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL Microsoft.Insights \
         Microsoft.KeyVault Microsoft.ManagedIdentity Microsoft.Network Microsoft.OperationalInsights \
         Microsoft.OperationsManagement Microsoft.Security Microsoft.SecurityInsights Microsoft.Storage Microsoft.Consumption; do
  az provider register --namespace "$p"
done
```

Create the deploy identity. GitHub Actions signs in as this identity with OpenID Connect, so no Azure credential is ever stored in GitHub. Its federated credentials accept tokens only from this repository's `azure-dev` and `azure-prod` environments:

```bash
az group create --name rg-sagolik-deploy --location eastus2
az identity create --resource-group rg-sagolik-deploy --name id-sagolik-deploy
for env in dev prod; do
  az identity federated-credential create --resource-group rg-sagolik-deploy --identity-name id-sagolik-deploy \
    --name "github-azure-$env" --issuer https://token.actions.githubusercontent.com \
    --subject "repo:QuantityNetwork/sagolik-close:environment:azure-$env" --audiences api://AzureADTokenExchange
done
principal=$(az identity show -g rg-sagolik-deploy -n id-sagolik-deploy --query principalId -o tsv)
client=$(az identity show -g rg-sagolik-deploy -n id-sagolik-deploy --query clientId -o tsv)
sub=$(az account show --query id -o tsv)
```

The template creates role assignments (least privilege for every workload), resource locks and a policy assignment, so the deploy identity needs Contributor plus User Access Administrator on the subscription. Tighten the second one with a condition that allows only the roles the template assigns (AcrPull, AcrPush, Key Vault Crypto User, Key Vault Crypto Service Encryption User, Key Vault Secrets User, Storage Blob Data Contributor):

```bash
az role assignment create --assignee-object-id "$principal" --assignee-principal-type ServicePrincipal --role Contributor --scope "/subscriptions/$sub"
az role assignment create --assignee-object-id "$principal" --assignee-principal-type ServicePrincipal --role "User Access Administrator" --scope "/subscriptions/$sub"
```

In GitHub, open Settings, then Environments, and create `azure-dev` and `azure-prod`. On `azure-prod`, require reviewers and allow only the `main` branch. On each environment, add these variables. They are identifiers, not secrets:

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | `$client` |
| `AZURE_TENANT_ID` | the tenant id |
| `AZURE_SUBSCRIPTION_ID` | `$sub` |
| `AZURE_DEPLOYER_PRINCIPAL_ID` | `$principal` (allows the pipeline to push images) |
| `AZURE_LOCATION` | `eastus2` (optional) |
| `DEV_ALLOWED_IPS` | `azure-dev` only, optional: comma-separated addresses IPv4 addresses or CIDR ranges allowed to reach dev's web app, for example the office's. Empty means anyone with the link (the data is fictional) |

## 2. Platform

Run the **Deploy to Azure** workflow with environment `dev` and phase `platform`. The run prints a what-if preview, then deploys. Its summary lists the outputs: resource group, registry, the app's host (`appHost`), vault names, and the money service host.

Dev uses the lean cost profile ([architecture.md](architecture.md#environments-and-regions)): it has no Front Door, so its app is at `https://web.<environment domain>` (the `appHost` output), the registry takes pushes without an address window, and the Private Link approval step below has nothing to do.

Restart each PostgreSQL server once, so pgaudit loads (it's a preloaded library):

```bash
az postgres flexible-server restart --resource-group rg-sagolik-dev --name <server>
```

For production's custom domain, two DNS records are needed:
- **Validation:** `TXT _dnsauth.close` with the `customDomainValidationToken` output. This validates the domain without moving any traffic.
- **Go-live:** `CNAME close` pointing to `frontDoorHost`. This moves traffic from Vercel to Azure, so create it only at go-live.

## 3. Key ceremony

Run the workflow with phase `ceremony`. It builds and pushes the images and runs the `keys` job inside the network:
- The job wraps a new random data key with `data-kek`. The data key never exists outside the job's memory.
- It also reads the recording key's public half.

The run's summary shows one JSON line with public material only:
- `DATA_KEYS_WRAPPED_ENTRY`
- `DATA_KEK_ID` (with its version)
- `CHAIN_RECORDER_KEY_ID`
- `recordingAccount`, the Ethereum address of the deal-record recording account

If the summary couldn't read the log, open the job's execution in the portal, or query `ContainerAppConsoleLogs` in the workspace.

Put the secrets in Key Vault. The vaults have no public access, so the script writes through Azure Resource Manager. Values never appear on a command line or in deployment history:

```bash
RESOURCE_GROUP=rg-sagolik-dev CORE_VAULT=<coreVault output> NEW_SESSION_SECRET=1 \
DATA_KEYS_WRAPPED='<DATA_KEYS_WRAPPED_ENTRY>' DATA_KEK_ID='<DATA_KEK_ID>' \
  infra/azure/scripts/set-secrets.sh
```

With the money service (production), first create its mutual-TLS and assertion material on the operator's machine. `<moneyHost>` is the `moneyHost` output:

```bash
cd services/money && go run ./cmd/devcerts -out ~/sagolik-prod-certs -hosts <moneyHost> -days 397 -keyring=false
```

Then add `MONEY_VAULT=<moneyVault output> CERTS_DIR=~/sagolik-prod-certs` to the command above, and `PLAID_SECRET_FILE=<file>` once Plaid production access exists. Afterwards:
- Move `ca-key.pem` to offline, encrypted storage. It's needed only to issue the next certificates.
- Delete the rest of the directory.

For the deal record on Base, do two things:
- **Register the recording account.** The treasury wallet grants `recordingAccount` the `RECORDER_ROLE` on the registry, then funds it with a little ETH ([../onchain.md](../onchain.md)).
- **Configure the environment.** Add `NEW_CHAIN_DEAL_SALT=1 CHAIN_RECORDER_KEY_ID='<CHAIN_RECORDER_KEY_ID>'` to the secrets command, and set `chain` in the parameter file. Generate the salt once and keep it: changing it starts a new deal id for every closing.

## 4. Apps

Run the workflow with phase `apps`. It:
1. deploys the apps and jobs, and the Front Door routes
2. approves Front Door's Private Link requests on the environments; only requests that carry the message derived from this Front Door profile are approved
3. runs the migrate jobs: the database schema, then the web and worker identities' database roles (in dev, also the demo data)
4. waits for `https://<appHost>/api/health` to answer (through Front Door in production), with the database in PostgreSQL mode

Then sign in once in a browser (in dev, as a demo persona). In production, this checks that server actions work through Front Door: Next.js compares the browser's `Origin` with the `X-Forwarded-Host` that Front Door sends.

## Every release

Run phase `apps`. Migrations run before the smoke test. Write them so the previous release keeps working while they apply (add first, remove later), because the new revision starts alongside.

## Rotation

| What | How |
| --- | --- |
| Session secret | `NEW_SESSION_SECRET=1` with the secrets script, then run phase `apps` (or restart the web revision). Everyone is signed out. |
| A new data key (same key-encryption key) | Start the `keys` job with `new-data-key v2 <DATA_KEK_ID>` as its arguments (`az containerapp job start --name keys --resource-group <rg> --args new-data-key v2 <DATA_KEK_ID>`, or edit the arguments in the portal). Then set `DATA_KEYS_WRAPPED='v2:…,v1:…'`, newest first. New values use v2; old ones keep decrypting with v1. |
| The key-encryption key | A controlled ceremony, two people, with elevated rights through Privileged Identity Management. First add a new version of `data-kek`: Key Vault's data plane is private, so temporarily allow the operator's address on the vault, run `az keyvault key rotate`, then remove the rule. Next, start the `keys` job with `rewrap <old version id> <new version id>` and `DATA_KEYS_WRAPPED` in its environment. It prints the new `DATA_KEYS_WRAPPED` and `DATA_KEK_ID`; store them with the secrets script. The data itself doesn't change. |
| Money service certificates (every 397 days) | Issue new ones from the offline CA (`devcerts`), store them with the secrets script, then run phase `apps`. |
| Money service key-encryption key | Add a version of `money-kek`. New values use it; each stored value names the version that sealed it. |
| Recording key | Don't rotate it routinely: its address is the registry's recording account. If it's ever exposed, the treasury wallet revokes `RECORDER_ROLE` from the old address before a new key is registered. |

## Restore drill (twice a year, recorded as evidence)

```bash
az postgres flexible-server restore --resource-group <rg> --name psql-restore-$(date +%Y%m%d) \
  --source-server <server> --restore-time "<UTC time within the retention window>"
```

Check the restored server's row counts against production for the restore time, record the time taken, then delete the restored server.

## Recreating an environment

Key Vaults keep their names for 90 days after deletion (soft delete with purge protection), and their keys protect the data. To recreate an environment after deleting its resource group, recover the vaults first (`az keyvault recover --name <vault>`). This brings back their keys, and with them access to the restored data.
