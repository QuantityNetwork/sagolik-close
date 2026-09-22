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
export function isSameOrigin(requestUrl: string, origin: string | null, referer: string | null): boolean {
  const target = new URL(requestUrl).origin;
  if (origin) return origin === target;
  if (referer) {
    try {
      return new URL(referer).origin === target;
    } catch {
      return false;
    }
  }
  return false;
}
