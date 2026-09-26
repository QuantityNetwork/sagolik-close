/**
 * Fixed-window-with-sliding-estimate rate limiter behind an interface.
 * The in-memory store suits a single instance / local dev; production should
 * back `RateLimitStore` with Redis/Upstash so limits hold across instances.
 */
export interface RateLimitStore {
  incr(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  async incr(key: string, windowMs: number, now: number) {
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      if (this.buckets.size > 50_000) this.sweep(now);
      return fresh;
    }
    b.count += 1;
    return b;
  }
  private sweep(now: number) {
    for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
  }
}

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  /** Credential endpoints: brute force / credential stuffing. */
  auth: { limit: 10, windowMs: 15 * 60_000 },
  stepUp: { limit: 5, windowMs: 15 * 60_000 },
  /** Demo persona picker (demo mode only; no credentials involved). */
  demoSignIn: { limit: 60, windowMs: 15 * 60_000 },
  apiRead: { limit: 300, windowMs: 60_000 },
  apiWrite: { limit: 60, windowMs: 60_000 },
  upload: { limit: 30, windowMs: 60_000 },
  webhook: { limit: 600, windowMs: 60_000 },
  assistant: { limit: 30, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitPolicy>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export async function checkRateLimit(
  store: RateLimitStore,
  key: string,
  policy: RateLimitPolicy,
  now = Date.now(),
): Promise<RateLimitResult> {
  const { count, resetAt } = await store.incr(key, policy.windowMs, now);
  return { allowed: count <= policy.limit, remaining: Math.max(0, policy.limit - count), resetAt };
}
