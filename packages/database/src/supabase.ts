/**
 * PostgreSQL store over Supabase (PostgREST).
 *
 * Two instances are used per request:
 *  - a user-scoped client (anon key + the person's JWT) for reads, so Row
 *    Level Security applies to everything a person sees;
 *  - a service client for writes, used only after the service layer has
 *    authorized the action. RLS denies direct writes from browsers.
 *
 * The service-role key is server-only and never reaches browser bundles.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_SCHEMAS, type TableName } from "@sagolik/types";
import { rowToCamel, rowToSnake, toSnake } from "./case";
import { type Db, type FindOptions, NotFoundError, type Table, UniqueViolationError, type Where } from "./table";

interface PgError {
  code?: string;
  message: string;
  details?: string | null;
}

function raise(table: string, err: PgError): never {
  if (err.code === "23505") throw new UniqueViolationError(table, err.details ?? "unique");
  throw new Error(`[${table}] ${err.code ?? ""} ${err.message}`);
}

// PostgREST's builder types are deeply generic; this narrow surface is all we use.
interface FilterBuilder {
  eq(col: string, v: unknown): FilterBuilder;
  in(col: string, v: readonly unknown[]): FilterBuilder;
  is(col: string, v: null): FilterBuilder;
  order(col: string, o: { ascending: boolean }): FilterBuilder;
  limit(n: number): FilterBuilder;
  select(cols?: string): FilterBuilder;
  maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: PgError | null }>;
  single(): PromiseLike<{ data: Record<string, unknown> | null; error: PgError | null }>;
  then: PromiseLike<{ data: Record<string, unknown>[] | null; error: PgError | null; count?: number | null }>["then"];
}

function applyWhere<T>(q: FilterBuilder, where: Where<T> | undefined): FilterBuilder {
  if (!where) return q;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    const col = toSnake(k);
    if (Array.isArray(v)) q = q.in(col, v);
    else if (v === null) q = q.is(col, null);
    else q = q.eq(col, v);
  }
  return q;
}

class SupabaseTable<T extends { id: string }> implements Table<T> {
  constructor(
    private readonly client: SupabaseClient,
    private readonly name: TableName,
  ) {}

  private from() {
    return this.client.from(this.name) as unknown as {
      select(cols?: string, o?: { count?: "exact"; head?: boolean }): FilterBuilder;
      insert(v: unknown): FilterBuilder;
      update(v: unknown): FilterBuilder;
    };
  }

  async get(id: string) {
    const { data, error } = await this.from().select("*").eq("id", id).maybeSingle();
    if (error) raise(this.name, error);
    return data ? rowToCamel<T>(data) : null;
  }

  async find(where?: Where<T>, opts: FindOptions<T> = {}) {
    let q = applyWhere(this.from().select("*"), where);
    if (opts.orderBy) q = q.order(toSnake(opts.orderBy), { ascending: opts.ascending !== false });
    if (opts.limit !== undefined) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) raise(this.name, error);
    return (data ?? []).map((r) => rowToCamel<T>(r));
  }

  async findOne(where: Where<T>) {
    return (await this.find(where, { limit: 1 }))[0] ?? null;
  }

  async count(where?: Where<T>) {
    const { count, error } = await applyWhere(this.from().select("id", { count: "exact", head: true }), where);
    if (error) raise(this.name, error);
    return count ?? 0;
  }

  async insert(row: T) {
    const parsed = TABLE_SCHEMAS[this.name].parse(row);
    const { data, error } = await this.from().insert(rowToSnake(parsed as Record<string, unknown>)).select("*").single();
    if (error) raise(this.name, error);
    return rowToCamel<T>(data!);
  }

  async insertMany(rows: T[]) {
    if (rows.length === 0) return;
    const payload = rows.map((r) => rowToSnake(TABLE_SCHEMAS[this.name].parse(r) as Record<string, unknown>));
    const { error } = await this.from().insert(payload);
    if (error) raise(this.name, error);
  }

  async update(id: string, patch: Partial<T>) {
    const { data, error } = await this.from()
      .update(rowToSnake(patch as Record<string, unknown>))
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) raise(this.name, error);
    if (!data) throw new NotFoundError(this.name, id);
    return rowToCamel<T>(data);
  }

  async updateIf(id: string, expected: Partial<T>, patch: Partial<T>) {
    const q = applyWhere(this.from().update(rowToSnake(patch as Record<string, unknown>)).eq("id", id), expected as Where<T>);
    const { data, error } = await q.select("*").maybeSingle();
    if (error) raise(this.name, error);
    return data ? rowToCamel<T>(data) : null;
  }
}

export function createSupabaseDb(client: SupabaseClient): Db {
  const db = {} as Record<TableName, Table<{ id: string }>>;
  for (const name of Object.keys(TABLE_SCHEMAS) as TableName[]) db[name] = new SupabaseTable(client, name);
  return db as unknown as Db;
}
