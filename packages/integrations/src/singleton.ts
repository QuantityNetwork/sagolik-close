/**
 * Process-wide singleton. Next.js can evaluate a module more than once per
 * process (separate server bundles), so in-memory sandbox state is anchored
 * on globalThis to stay consistent across route handlers, actions and pages.
 */
export function globalSingleton<T>(key: string, factory: () => T): T {
  const g = globalThis as unknown as Record<string, unknown>;
  const k = `__sagolik_${key}`;
  if (!(k in g)) g[k] = factory();
  return g[k] as T;
}

/** Drop a singleton, but only if it is still `expected` — so concurrent callers can't discard a fresh replacement. */
export function dropSingletonIf(key: string, expected: unknown): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const k = `__sagolik_${key}`;
  if (g[k] === expected) delete g[k];
}
