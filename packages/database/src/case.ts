/** Top-level key conversion between TypeScript (camelCase) and SQL (snake_case). JSON column contents are left untouched. */
export function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/([a-z])(\d)/g, "$1_$2");
}

export function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function rowToSnake(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (v !== undefined) out[toSnake(k)] = v;
  return out;
}

export function rowToCamel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out as T;
}
