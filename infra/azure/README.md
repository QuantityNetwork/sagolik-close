# infra/azure

Sagolik Close on Azure, as code. Design: [docs/azure/architecture.md](../../docs/azure/architecture.md). Deploying: [docs/azure/runbook.md](../../docs/azure/runbook.md).

| Path | What |
| --- | --- |
| `main.bicep` | One environment (subscription scope, its own resource group), in phases: `platform`, `ceremony`, `apps` |
| `params/dev.bicepparam`, `params/prod.bicepparam` | The two environments; the pipeline sets the phase and image digests through environment variables. Dev uses the lean cost profile (`costProfile`), which the template refuses for production |
| `modules/` | Network, firewall, private DNS and endpoints, Key Vault, PostgreSQL, storage, registry, Container Apps environments and apps, Front Door, RBAC, Defender, Activity Log, governance |
| `secrets.bicep`, `scripts/set-secrets.sh` | Operator-run: puts secrets into the private vaults through Resource Manager |
| `sql/bootstrap.sql` | What the migrations expect from PostgreSQL without Supabase (API roles, `auth.uid()`, `auth.users`) |
| `sentinel/detections.kql` | Starting detections for Microsoft Sentinel |
| `bicepconfig.json`, `.checkov.yaml` | Linter rules (strict) and the Checkov checks skipped, with reasons |

Check locally, as CI does:

```bash
cd infra/azure
bicep build main.bicep --outdir out && bicep build secrets.bicep --outdir out
bicep lint main.bicep && for f in modules/*.bicep; do bicep lint "$f"; done
DEPLOY_PHASE=apps bicep build-params params/dev.bicepparam --outfile out/dev.parameters.json
checkov -d out --framework arm --config-file .checkov.yaml
```
