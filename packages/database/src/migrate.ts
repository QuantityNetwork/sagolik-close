/**
 * Applies SQL migrations to PostgreSQL without the Supabase CLI (for Azure
 * Database for PostgreSQL). The bootstrap file runs first, every time (it is
 * idempotent); then each migration not yet recorded runs once, in name
 * order, inside its own transaction.
 *
 * A migration that was applied and then changed on disk stops the run: the
 * rule is "add a new migration, never edit an applied one".
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";

export interface MigrateOptions {
  bootstrapFile: string;
  migrationsDir: string;
  log?: (msg: string) => void;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function migrate(pool: pg.Pool, opts: MigrateOptions): Promise<MigrateResult> {
  const log = opts.log ?? (() => undefined);
  const c = await pool.connect();
  try {
    // One migrator at a time, across processes.
    await c.query("select pg_advisory_lock(hashtext('sagolik-close/migrations'))");
    await c.query(readFileSync(opts.bootstrapFile, "utf8"));
    const done = new Map((await c.query<{ name: string; sha256: string }>("select name, sha256 from migrations.applied")).rows.map((r) => [r.name, r.sha256]));
    const files = readdirSync(opts.migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const result: MigrateResult = { applied: [], skipped: [] };
    for (const name of files) {
      const sql = readFileSync(join(opts.migrationsDir, name), "utf8");
      const hash = sha256(sql);
      const recorded = done.get(name);
      if (recorded) {
        if (recorded !== hash) throw new Error(`Migration ${name} changed after it was applied. Add a new migration instead of editing this one.`);
        result.skipped.push(name);
        continue;
      }
      log(`applying ${name}`);
      await c.query("begin");
      try {
        await c.query(sql);
        await c.query("insert into migrations.applied (name, sha256) values ($1, $2)", [name, hash]);
        await c.query("commit");
      } catch (e) {
        await c.query("rollback").catch(() => undefined);
        throw new Error(`Migration ${name} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      result.applied.push(name);
    }
    return result;
  } finally {
    await c.query("select pg_advisory_unlock(hashtext('sagolik-close/migrations'))").catch(() => undefined);
    c.release();
  }
}

const ROLE = /^[A-Za-z0-9_.@ -]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const quoteRole = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Lets a workload's login role act as the API roles. Membership is SET-only
 * (no inherited privileges): the login role can do nothing until the store
 * takes `authenticated` or `service_role` for a transaction.
 */
export async function grantApiRoles(pool: pg.Pool, loginRole: string): Promise<void> {
  if (!ROLE.test(loginRole)) throw new Error(`Unexpected role name: ${loginRole}`);
  const exists = await pool.query("select 1 from pg_roles where rolname = $1", [loginRole]);
  if (exists.rowCount === 0) throw new Error(`Role ${loginRole} doesn't exist. Create the identity's principal first.`);
  await pool.query(`grant authenticated, service_role to ${quoteRole(loginRole)} with inherit false, set true`);
}

/**
 * Creates the database principal for an Azure managed identity, by its Entra
 * object id (names aren't unique in a tenant; object ids are). Runs as the
 * server's Entra administrator, against the `postgres` database where the
 * pgaadauth functions live. Does nothing if the role already exists.
 */
export async function createEntraPrincipal(adminPool: pg.Pool, name: string, objectId: string): Promise<boolean> {
  if (!ROLE.test(name)) throw new Error(`Unexpected role name: ${name}`);
  if (!UUID.test(objectId)) throw new Error(`Unexpected object id for ${name}: ${objectId}`);
  const exists = await adminPool.query("select 1 from pg_roles where rolname = $1", [name]);
  if (exists.rowCount) return false;
  await adminPool.query("select * from pgaadauth_create_principal_with_oid($1, $2, 'service', false, false)", [name, objectId]);
  return true;
}

/**
 * Records people in auth.users, which profiles reference. Ids come from the
 * identity provider (Entra object ids) or, in demo environments, the
 * fictional personas.
 */
export async function upsertAuthUsers(pool: pg.Pool, users: Array<{ id: string; email: string | null }>): Promise<void> {
  if (users.length === 0) return;
  for (const u of users) if (!UUID.test(u.id)) throw new Error(`Unexpected user id: ${u.id}`);
  await pool.query(
    `insert into auth.users (id, email)
     select * from unnest($1::uuid[], $2::text[])
     on conflict (id) do update set email = excluded.email, updated_at = now()`,
    [users.map((u) => u.id), users.map((u) => u.email)],
  );
}
