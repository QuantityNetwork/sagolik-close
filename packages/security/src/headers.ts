/**
 * HTTP security headers. CSP is nonce-based for scripts; styles allow
 * 'unsafe-inline' because Next.js/Framer inject style attributes.
 */
export function contentSecurityPolicy(nonce: string, opts: { dev?: boolean; supabaseUrl?: string } = {}): string {
  const connect = ["'self'", opts.supabaseUrl, opts.supabaseUrl?.replace(/^http/, "ws")].filter(Boolean).join(" ");
  const directives: Record<string, string> = {
    "default-src": "'self'",
    "script-src": `'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' data: blob: https://images.unsplash.com",
    "font-src": "'self' data:",
    "connect-src": connect,
    "frame-src": "'self'",
    "frame-ancestors": "'none'",
    "form-action": "'self'",
    "base-uri": "'self'",
    "object-src": "'none'",
    "worker-src": "'self' blob:",
  };
  const csp = Object.entries(directives).map(([k, v]) => `${k} ${v}`);
  if (!opts.dev) csp.push("upgrade-insecure-requests");
  return csp.join("; ");
}

export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/**
 * CSRF defence for cookie-authenticated mutations: require same-origin
 * Origin (or Referer) header. Server Actions already enforce this in Next.js;
 * route handlers call this explicitly.
 */
/**
 * CSRF check for cookie-authenticated requests. `ours` lists the URLs whose
 * origins count as this site: the request URL and the configured public
 * APP_URL (behind a proxy or container, the request URL carries the internal
 * address, e.g. http://0.0.0.0:3000, not the one the browser used).
 */
export function isSameOrigin(ours: string | string[], origin: string | null, referer: string | null): boolean {
  const allowed = new Set((Array.isArray(ours) ? ours : [ours]).map((u) => new URL(u).origin));
  if (origin) return allowed.has(origin);
  if (referer) {
    try {
      return allowed.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * A redirect target taken from user input (`?next=`, notification links):
 * only same-site absolute paths. Rejects protocol-relative (`//x`), backslash
 * (`/\x`, which browsers treat as `//x`) and control characters.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  return next;
}
