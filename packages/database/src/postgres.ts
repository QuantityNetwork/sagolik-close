/**
 * PostgreSQL store without Supabase: Azure Database for PostgreSQL, or any
 * PostgreSQL 16+, with the same migrations and the same row-level security.
 *
 * Each call runs in its own short transaction that first takes the database
 * role and claims, the way Supabase does per request:
 *  - a person's reads: role `authenticated`, with `request.jwt.claims` set to
 *    { sub: <user id> }, so the RLS policies decide what they see;
 *  - writes after the service layer has authorized them: role
 *    `service_role` (BYPASSRLS).
 * Both settings are transaction-local, so nothing leaks between callers that
 * share a pooled connection. The login role (on Azure, a managed identity
 * signing in with an Entra token) only needs membership in those two roles.
 */
import { TABLE_SCHEMAS, type TableName } from "@sagolik/types";
import pg from "pg";
import { rowToCamel, rowToSnake, toSnake } from "./case";
import { AppendOnlyViolationError, type Db, type FindOptions, NotFoundError, type Table, UniqueViolationError, type Where } from "./table";

export type PostgresScope = { role: "service_role" } | { role: "authenticated"; userId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PostgreSQL text timestamps ("2026-10-12 14:07:00.123456+00") as the ISO strings the app writes. */
export function isoFromPg(value: string): string {
  const m = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(?:([+-]\d{2})(?::?(\d{2}))?(?::?\d{2})?)?$/);
  if (!m) return new Date(value).toISOString();
  const [, date, time, frac = "", oh, om = "00"] = m;
  const ms = (frac + "000").slice(0, 3);
  return new Date(`${date}T${time}.${ms}${oh ? `${oh}:${om}` : "Z"}`).toISOString();
}

/** Type parsers for this store only (the global `pg.types` stay untouched). */
const TYPES = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    switch (oid) {
      case 1184: // timestamptz
      case 1114: // timestamp (treated as UTC)
        return (v: string) => isoFromPg(v);
      case 1082: // date: keep "YYYY-MM-DD"
        return (v: string) => v;
      case 20: // int8: money in cents fits well inside 2^53
        return (v: string) => Number(v);
      default:
        return pg.types.getTypeParser(oid, format);
    }
  },
};

export interface PostgresPoolOptions {
  connectionString: string;
  /** For Entra authentication: returns a fresh access token, used as the password on each new connection. */
  password?: () => Promise<string>;
  max?: number;
}

/** A pool configured for this store: TLS verified whenever the connection string asks for it, and our type parsing. */
export function createPostgresPool(opts: PostgresPoolOptions): pg.Pool {
  const url = new URL(opts.connectionString);
  const sslmode = url.searchParams.get("sslmode") ?? "disable";
  url.searchParams.delete("sslmode");
  return new pg.Pool({
    connectionString: url.toString(),
    ...(opts.password ? { password: opts.password } : {}),
    ssl: sslmode === "disable" ? false : { rejectUnauthorized: sslmode === "verify-full" || sslmode === "verify-ca" },
    max: opts.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    types: TYPES,
  });
}

interface TableColumns {
  /** Column name → PostgreSQL type name. */
  types: Map<string, string>;
  /**
   * What a person's reads select: the columns the `authenticated` role may
   * read. Some columns are never readable by people (for example the
   * encrypted account number on bank instructions); `select *` would be
   * refused outright, so their reads leave those columns out.
   */
  personSelect: string;
}
type Columns = Map<string, TableColumns>;
const columnCache = new WeakMap<pg.Pool, Promise<Columns>>();

/** Columns per table, read once per pool, so JSON columns are sent as JSON and arrays as arrays. */
function tableColumns(pool: pg.Pool): Promise<Columns> {
  let cached = columnCache.get(pool);
  if (!cached) {
    cached = pool
      // pg_catalog rather than information_schema: it lists every column whatever the login role's own grants.
      .query<{ table_name: string; column_name: string; udt_name: string; person_can_read: boolean }>(
        `select c.relname as table_name, a.attname as column_name, t.typname as udt_name,
                has_column_privilege('authenticated', c.oid, a.attnum, 'SELECT') as person_can_read
           from pg_attribute a
           join pg_class c on c.oid = a.attrelid
           join pg_namespace n on n.oid = c.relnamespace
           join pg_type t on t.oid = a.atttypid
          where n.nspname = 'public' and c.relkind in ('r', 'p', 'v') and a.attnum > 0 and not a.attisdropped
          order by c.relname, a.attnum`,
      )
      .then((r) => {
        const byTable = new Map<string, Array<{ column: string; udt: string; readable: boolean }>>();
        for (const row of r.rows) {
          if (!byTable.has(row.table_name)) byTable.set(row.table_name, []);
          byTable.get(row.table_name)!.push({ column: row.column_name, udt: row.udt_name, readable: row.person_can_read });
        }
        const out: Columns = new Map();
        for (const [table, cols] of byTable) {
          const readable = cols.filter((c) => c.readable);
          // With nothing readable, `*` lets the database refuse with its own error.
          const personSelect = readable.length === cols.length || readable.length === 0 ? "*" : readable.map((c) => ident(c.column)).join(", ");
          out.set(table, { types: new Map(cols.map((c) => [c.column, c.udt])), personSelect });
        }
        return out;
      });
    cached.catch(() => columnCache.delete(pool));
    columnCache.set(pool, cached);
  }
  return cached;
}

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected identifier: ${name}`);
  return `"${name}"`;
};

interface PgError {
  code?: string;
  constraint?: string;
  message: string;
}

function mapError(table: string, e: unknown): Error {
  const err = e as PgError;
  if (err?.code === "23505") return new UniqueViolationError(table, err.constraint ?? "unique");
  if (err?.code === "42501" && /append-only|immutable|final|not allowed/i.test(err.message)) return Object.assign(new AppendOnlyViolationError(table), { cause: e, message: err.message });
  return e instanceof Error ? e : new Error(String(e));
}

class PostgresTable<T extends { id: string }> implements Table<T> {
  constructor(
    private readonly pool: pg.Pool,
    private readonly name: TableName,
    private readonly scope: PostgresScope,
  ) {}

  /** One transaction per call: role and claims first, then the statement. */
  private async run<R>(fn: (c: pg.PoolClient, types: Map<string, string>, select: string) => Promise<R>): Promise<R> {
    const table = (await tableColumns(this.pool)).get(this.name);
    if (!table) throw new Error(`Table ${this.name} doesn't exist in the database. Run the migrations.`);
    const { types } = table;
    const select = this.scope.role === "authenticated" ? table.personSelect : "*";
    const c = await this.pool.connect();
    try {
      if (this.scope.role === "authenticated") {
        if (!UUID.test(this.scope.userId)) throw new Error("A database reader needs a valid user id.");
        const claims = c.escapeLiteral(JSON.stringify({ sub: this.scope.userId, role: "authenticated" }));
        await c.query(`begin; set local role authenticated; select set_config('request.jwt.claims', ${claims}, true);`);
      } else {
        await c.query("begin; set local role service_role;");
      }
      const result = await fn(c, types, select);
      await c.query("commit");
      return result;
    } catch (e) {
      await c.query("rollback").catch(() => undefined);
      throw mapError(this.name, e);
    } finally {
      c.release();
    }
  }

  private encode(types: Map<string, string>, col: string, v: unknown): unknown {
    const udt = types.get(col);
    if (udt === undefined) throw new Error(`Column ${this.name}.${col} doesn't exist in the database.`);
    if (v === null || v === undefined) return null;
    if (udt === "jsonb" || udt === "json") return JSON.stringify(v);
    return v;
  }

  private where(types: Map<string, string>, where: Where<T> | undefined, params: unknown[]): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(where ?? {})) {
      if (v === undefined) continue;
      const col = toSnake(k);
      if (!types.has(col)) throw new Error(`Column ${this.name}.${col} doesn't exist in the database.`);
      if (v === null) parts.push(`${ident(col)} is null`);
      else if (Array.isArray(v)) {
        if (v.length === 0) {
          parts.push("false");
          continue;
        }
        params.push(v);
        parts.push(`${ident(col)} = any($${params.length})`);
      } else {
        params.push(this.encode(types, col, v));
        parts.push(`${ident(col)} = $${params.length}`);
      }
    }
    return parts.length ? ` where ${parts.join(" and ")}` : "";
  }

  private camel(row: Record<string, unknown>): T {
    return rowToCamel<T>(row);
  }

  async get(id: string) {
    return this.run(async (c, _types, select) => {
      const r = await c.query(`select ${select} from public.${ident(this.name)} where id = $1`, [id]);
      return r.rows[0] ? this.camel(r.rows[0]) : null;
    });
  }

  async find(where?: Where<T>, opts: FindOptions<T> = {}) {
    return this.run(async (c, types, select) => {
      const params: unknown[] = [];
      let sql = `select ${select} from public.${ident(this.name)}${this.where(types, where, params)}`;
      if (opts.orderBy) {
        const col = toSnake(opts.orderBy);
        if (!types.has(col)) throw new Error(`Column ${this.name}.${col} doesn't exist in the database.`);
        // Nulls last in both directions, like the in-memory store.
        sql += ` order by ${ident(col)} ${opts.ascending === false ? "desc" : "asc"} nulls last`;
      }
      if (opts.limit !== undefined) {
        params.push(opts.limit);
        sql += ` limit $${params.length}`;
      }
      const r = await c.query(sql, params);
      return r.rows.map((row) => this.camel(row));
    });
  }

  async findOne(where: Where<T>) {
    return (await this.find(where, { limit: 1 }))[0] ?? null;
  }

  async count(where?: Where<T>) {
    return this.run(async (c, types) => {
      const params: unknown[] = [];
      const r = await c.query<{ n: number }>(`select count(*)::int as n from public.${ident(this.name)}${this.where(types, where, params)}`, params);
      return r.rows[0]?.n ?? 0;
    });
  }

  private insertSql(types: Map<string, string>, select: string, rows: T[]): { sql: string; params: unknown[] } {
    const snakes = rows.map((r) => rowToSnake(TABLE_SCHEMAS[this.name].parse(r) as Record<string, unknown>));
    const cols = Object.keys(snakes[0]!);
    const params: unknown[] = [];
    const values = snakes.map(
      (row) =>
        `(${cols
          .map((col) => {
            params.push(this.encode(types, col, row[col]));
            return `$${params.length}`;
          })
          .join(", ")})`,
    );
    return { sql: `insert into public.${ident(this.name)} (${cols.map(ident).join(", ")}) values ${values.join(", ")} returning ${select}`, params };
  }

  async insert(row: T) {
    return this.run(async (c, types, select) => {
      const { sql, params } = this.insertSql(types, select, [row]);
      const r = await c.query(sql, params);
      return this.camel(r.rows[0]);
    });
  }

  async insertMany(rows: T[]) {
    if (rows.length === 0) return;
    await this.run(async (c, types, select) => {
      // Batches keep each statement well under PostgreSQL's 65,535-parameter limit.
      const perBatch = Math.max(1, Math.floor(30_000 / Math.max(1, Object.keys(rows[0]!).length)));
      for (let i = 0; i < rows.length; i += perBatch) {
        const { sql, params } = this.insertSql(types, select, rows.slice(i, i + perBatch));
        await c.query(sql, params);
      }
    });
  }

  private setClause(types: Map<string, string>, patch: Partial<T>, params: unknown[]): string {
    const snake = rowToSnake(patch as Record<string, unknown>);
    delete snake.id;
    return Object.entries(snake)
      .map(([col, v]) => {
        params.push(this.encode(types, col, v));
        return `${ident(col)} = $${params.length}`;
      })
      .join(", ");
  }

  async update(id: string, patch: Partial<T>) {
    const row = await this.run(async (c, types, select) => {
      const params: unknown[] = [id];
      const set = this.setClause(types, patch, params);
      const r = set
        ? await c.query(`update public.${ident(this.name)} set ${set} where id = $1 returning ${select}`, params)
        : await c.query(`select ${select} from public.${ident(this.name)} where id = $1`, [id]);
      return r.rows[0] ? this.camel(r.rows[0]) : null;
    });
    if (!row) throw new NotFoundError(this.name, id);
    return row;
  }

  async updateIf(id: string, expected: Partial<T>, patch: Partial<T>) {
    return this.run(async (c, types, select) => {
      const params: unknown[] = [id];
      const set = this.setClause(types, patch, params);
      if (!set) throw new Error("updateIf needs at least one column to change.");
      const cond = this.where(types, expected as Where<T>, params).replace(/^ where /, " and ");
      const r = await c.query(`update public.${ident(this.name)} set ${set} where id = $1${cond} returning ${select}`, params);
      return r.rows[0] ? this.camel(r.rows[0]) : null;
    });
  }
}

/** A store acting as one scope: a person's reads, or the service's writes. */
export function createPostgresDb(pool: pg.Pool, scope: PostgresScope): Db {
  const db = {} as Record<TableName, Table<{ id: string }>>;
  for (const name of Object.keys(TABLE_SCHEMAS) as TableName[]) db[name] = new PostgresTable(pool, name, scope);
  return db as unknown as Db;
}
