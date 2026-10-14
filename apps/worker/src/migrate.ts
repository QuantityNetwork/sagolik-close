/**
 * Database migrations for PostgreSQL without Supabase (Azure Database for
 * PostgreSQL). Runs as the `migrate` job, under the migration identity: the
 * server's Entra administrator, signing in with no password
 * (DATABASE_AUTH=entra).
 *
 *   pnpm --filter @sagolik/worker migrate
 *       Applies the bootstrap and every new migration.
 *   … migrate --grant <role>[=<entra object id>]   (repeatable)
 *       Lets a workload's login role act as the API roles. With an object
 *       id, first creates the role for that managed identity.
 *   … migrate --seed-demo
 *       Demo environments only: loads the fictional demo data into an empty
 *       database. Needs the app's data keys and document storage settings.
 */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getEnv } from "@sagolik/config";
import { blobOrMemoryStorage, buildDemoData, loadDemoData, loadKeyRing, postgresPoolFor } from "@sagolik/core";
import { createEntraPrincipal, createPostgresDb, grantApiRoles, migrate, upsertAuthUsers } from "@sagolik/database";

const log = (level: "info" | "error", msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, msg, service: "migrate", at: new Date().toISOString(), ...extra }));

const root = fileURLToPath(new URL("../../../", import.meta.url));
const { values } = parseArgs({
  options: {
    grant: { type: "string", multiple: true, default: [] },
    "seed-demo": { type: "boolean", default: false },
    bootstrap: { type: "string", default: process.env.MIGRATE_BOOTSTRAP_FILE ?? `${root}infra/azure/sql/bootstrap.sql` },
    migrations: { type: "string", default: process.env.MIGRATE_MIGRATIONS_DIR ?? `${root}supabase/migrations` },
  },
});

async function main() {
  const env = getEnv();
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL isn't set.");
  const pool = await postgresPoolFor(env);
  try {
    const result = await migrate(pool, { bootstrapFile: values.bootstrap, migrationsDir: values.migrations, log: (msg) => log("info", msg) });
    log("info", "migrations up to date", { applied: result.applied.length, alreadyApplied: result.skipped.length });

    for (const spec of values.grant) {
      const [role, objectId] = spec.split("=") as [string, string | undefined];
      if (objectId) {
        // Entra principals are created from the `postgres` database, where the pgaadauth functions live.
        const adminUrl = new URL(env.DATABASE_URL);
        adminUrl.pathname = "/postgres";
        const admin = await postgresPoolFor(env, adminUrl.toString());
        try {
          if (await createEntraPrincipal(admin, role, objectId)) log("info", "created the database role for a managed identity", { role });
        } finally {
          await admin.end();
        }
      }
      await grantApiRoles(pool, role);
      log("info", "granted the API roles", { role });
    }

    if (values["seed-demo"]) await seedDemo(env, pool);
  } finally {
    await pool.end();
  }
}

async function seedDemo(env: ReturnType<typeof getEnv>, pool: Awaited<ReturnType<typeof postgresPoolFor>>) {
  if (!env.demoMode) throw new Error("Demo data goes only into demo environments (DEMO_MODE=true, never production).");
  const existing = await pool.query<{ n: number }>("select count(*)::int as n from public.profiles");
  if (existing.rows[0]!.n > 0) {
    log("info", "demo data already present; nothing to seed", { profiles: existing.rows[0]!.n });
    return;
  }
  // Tables force row-level security, even for their owner: the seed writes as service_role, like the app.
  await pool.query("grant service_role to current_user");
  const demo = buildDemoData(new Date(), await loadKeyRing(env));
  await upsertAuthUsers(pool, (demo.rows.profiles ?? []).map((p) => ({ id: p.id, email: p.email })));
  await loadDemoData(createPostgresDb(pool, { role: "service_role" }), demo);
  const storage = await blobOrMemoryStorage(env);
  let uploaded = 0;
  for (const f of demo.files) {
    try {
      await storage.put(f.key, f.bytes, f.mimeType);
      uploaded++;
    } catch (e) {
      // A rerun after a partial seed finds some objects already there; stored objects never change.
      if (!(e instanceof Error && /immutable/.test(e.message))) throw e;
    }
  }
  if (!env.AZURE_STORAGE_BLOB_URL) log("info", "AZURE_STORAGE_BLOB_URL isn't set, so demo documents weren't stored anywhere lasting");
  log("info", "demo data loaded", { profiles: demo.rows.profiles?.length ?? 0, documents: uploaded });
}

main().catch((e) => {
  log("error", "migration failed", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
