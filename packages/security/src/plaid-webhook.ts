/**
 * Plaid webhook verification, as Plaid documents it: the Plaid-Verification
 * header is an ES256 JWT signed by a Plaid key (fetched by `kid` from
 * /webhook_verification_key/get), issued within the last five minutes, whose
 * `request_body_sha256` is the SHA-256 of the exact body. The Go money
 * service implements the same rules (services/money/internal/plaid).
 */
import { createHash, createPublicKey, type KeyObject, timingSafeEqual, verify } from "node:crypto";

export interface PlaidJwk {
  alg?: string;
  crv: string;
  kid: string;
  kty: string;
  x: string;
  y: string;
  expired_at?: number | null;
}

export type PlaidKeyFetcher = (kid: string) => Promise<PlaidJwk | null>;

export const PLAID_WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

export class PlaidWebhookVerifier {
  private readonly cache = new Map<string, { key: KeyObject; expiredAt: number | null }>();
  private readonly lastFetch = new Map<string, number>();

  constructor(
    private readonly fetchKey: PlaidKeyFetcher,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns null when valid, otherwise a short reason for logs. */
  async verify(token: string | null, rawBody: string): Promise<string | null> {
    const parts = (token ?? "").split(".");
    if (parts.length !== 3) return "malformed_token";
    const [h, p, s] = parts as [string, string, string];
    let header: { alg?: string; kid?: string };
    let claims: { iat?: number; request_body_sha256?: string };
    try {
      header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
      claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    } catch {
      return "malformed_token";
    }
    if (header.alg !== "ES256") return "unexpected_alg";
    if (typeof header.kid !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(header.kid)) return "malformed_kid";
    const entry = await this.key(header.kid);
    if (!entry) return "unknown_kid";
    const nowSec = Math.floor(this.now() / 1000);
    if (entry.expiredAt !== null && nowSec >= entry.expiredAt) return "expired_key";
    const sig = Buffer.from(s, "base64url");
    if (sig.length !== 64) return "malformed_signature";
    if (!verify("sha256", Buffer.from(`${h}.${p}`), { key: entry.key, dsaEncoding: "ieee-p1363" }, sig)) return "bad_signature";
    if (typeof claims.iat !== "number") return "malformed_claims";
    if (nowSec - claims.iat > PLAID_WEBHOOK_MAX_AGE_SECONDS || claims.iat - nowSec > 60) return "stale";
    const want = Buffer.from(createHash("sha256").update(rawBody, "utf8").digest("hex"));
    const got = Buffer.from(String(claims.request_body_sha256 ?? "").toLowerCase());
    if (want.length !== got.length || !timingSafeEqual(want, got)) return "body_mismatch";
    return null;
  }

  private async key(kid: string) {
    const cached = this.cache.get(kid);
    if (cached) return cached;
    const last = this.lastFetch.get(kid);
    if (last !== undefined && this.now() - last < 60_000) return null; // throttle unknown kids
    if (this.lastFetch.size > 1000) this.lastFetch.clear();
    this.lastFetch.set(kid, this.now());
    const jwk = await this.fetchKey(kid);
    if (!jwk || jwk.kid !== kid || jwk.kty !== "EC" || jwk.crv !== "P-256" || (jwk.alg && jwk.alg !== "ES256")) return null;
    let key: KeyObject;
    try {
      key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
    } catch {
      return null;
    }
    const entry = { key, expiredAt: jwk.expired_at ?? null };
    this.cache.set(kid, entry);
    return entry;
  }
}
