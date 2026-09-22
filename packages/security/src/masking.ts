/** Display-safe masking helpers. Full identifiers never leave the server. */

export function lastFour(value: string): string {
  const digits = value.replace(/[^0-9A-Za-z]/g, "");
  return digits.slice(-4);
}

export function maskAccount(mask: string): string {
  return `•••• ${mask.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "•••";
  return `${user[0]}${"•".repeat(Math.max(1, Math.min(user.length - 1, 6)))}@${domain}`;
}

export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length <= 4 ? "••••" : `•••• ${d.slice(-4)}`;
}

const SENSITIVE_KEYS = /(token|secret|password|authorization|account_?number|iban|ssn|api_?key|cookie)/i;

/** Deep-redact values under sensitive keys before anything is logged. */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.test(k) ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out as T;
}
