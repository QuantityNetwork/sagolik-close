/**
 * In-memory store used for LOCAL/demo mode and tests. It enforces the same
 * unique and append-only constraints as the PostgreSQL schema so behaviour
 * doesn't silently differ between modes.
 */
import { APPEND_ONLY_TABLES, TABLE_SCHEMAS, type Row, type TableName } from "@sagolik/types";
import {
  AppendOnlyViolationError,
  type Db,
  type FindOptions,
  NotFoundError,
  type Table,
  UNIQUE_KEYS,
  UniqueViolationError,
  type Where,
} from "./table";

const clone = <T>(v: T): T => structuredClone(v);

function matches<T>(row: T, where: Where<T> | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where) as Array<[keyof T, unknown]>) {
    if (v === undefined) continue;
    const actual = row[k];
    if (Array.isArray(v)) {
      if (!v.includes(actual)) return false;
    } else if (actual !== v) return false;
  }
  return true;
}

const INSTRUCTION_MUTABLE = new Set(["status", "verifiedBy", "verifiedAt", "verificationMethod", "effectiveAfter"]);

/** Mirrors the `bank_instructions_guard` trigger: content is immutable; only verification may change. */
function guardInstructionUpdate(current: Row<"bank_instructions">, patch: Record<string, unknown>) {
  for (const k of Object.keys(patch)) {
    if (!INSTRUCTION_MUTABLE.has(k)) throw new AppendOnlyViolationError(`bank_instructions.${k}`);
  }
  const allowed: Record<string, string[]> = {
    pending_verification: ["verified", "rejected", "superseded"],
    verified: ["locked", "superseded"],
    locked: ["superseded"],
  };
  const to = patch.status as string | undefined;
  if (to && to !== current.status && !(allowed[current.status] ?? []).includes(to)) {
    throw new AppendOnlyViolationError(`bank_instructions.status ${current.status}→${to}`);
  }
}

class MemoryTable<T extends { id: string }> implements Table<T> {
  private rows = new Map<string, T>();
  constructor(
    private readonly name: TableName,
    private readonly validate: boolean,
  ) {}

  private checkUnique(row: T, ignoreId?: string) {
    for (const cols of UNIQUE_KEYS[this.name] ?? []) {
      for (const other of this.rows.values()) {
        if (other.id === ignoreId) continue;
        if (cols.every((c) => (other as Record<string, unknown>)[c] === (row as Record<string, unknown>)[c])) {
          throw new UniqueViolationError(this.name, cols.join(","));
        }
      }
    }
  }

  private parse(row: T): T {
    if (!this.validate) return row;
    return TABLE_SCHEMAS[this.name].parse(row) as unknown as T;
  }

  async get(id: string) {
    const r = this.rows.get(id);
    return r ? clone(r) : null;
  }

  async find(where?: Where<T>, opts: FindOptions<T> = {}) {
    let out = [...this.rows.values()].filter((r) => matches(r, where));
    if (opts.orderBy) {
      const k = opts.orderBy;
      const dir = opts.ascending === false ? -1 : 1;
      out.sort((a, b) => {
        const av = a[k] as unknown as string | number | null;
        const bv = b[k] as unknown as string | number | null;
        if (av === bv) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return av < bv ? -dir : dir;
      });
    }
    if (opts.limit !== undefined) out = out.slice(0, opts.limit);
    return out.map(clone);
  }

  async findOne(where: Where<T>) {
    return (await this.find(where, { limit: 1 }))[0] ?? null;
  }

  async count(where?: Where<T>) {
    return [...this.rows.values()].filter((r) => matches(r, where)).length;
  }

  async insert(row: T) {
    const parsed = this.parse(row);
    if (this.rows.has(parsed.id)) throw new UniqueViolationError(this.name, "id");
    this.checkUnique(parsed);
    this.rows.set(parsed.id, clone(parsed));
    return clone(parsed);
  }

  async insertMany(rows: T[]) {
    for (const r of rows) await this.insert(r);
  }

  async update(id: string, patch: Partial<T>) {
    if ((APPEND_ONLY_TABLES as readonly string[]).includes(this.name)) throw new AppendOnlyViolationError(this.name);
    const current = this.rows.get(id);
    if (!current) throw new NotFoundError(this.name, id);
    if (this.name === "bank_instructions") guardInstructionUpdate(current as unknown as Row<"bank_instructions">, patch);
    const next = this.parse({ ...current, ...patch, id, ...("updatedAt" in current ? { updatedAt: new Date().toISOString() } : {}) } as T);
    this.checkUnique(next, id);
    this.rows.set(id, clone(next));
    return clone(next);
  }

  async updateIf(id: string, expected: Partial<T>, patch: Partial<T>) {
    const current = this.rows.get(id);
    if (!current || !matches(current, expected as Where<T>)) return null;
    return this.update(id, patch);
  }
}

export function createMemoryDb(opts: { validate?: boolean } = {}): Db {
  const validate = opts.validate ?? true;
  const db = {} as Record<TableName, Table<{ id: string }>>;
  for (const name of Object.keys(TABLE_SCHEMAS) as TableName[]) {
    db[name] = new MemoryTable(name, validate);
  }
  return db as unknown as Db;
}

export type { Row };
