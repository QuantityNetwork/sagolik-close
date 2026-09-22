import type { ServiceContext } from "./context";

export const newId = () => crypto.randomUUID();
export const nowIso = (ctx: ServiceContext) => ctx.now().toISOString();
export const today = (ctx: ServiceContext) => ctx.now().toISOString().slice(0, 10);

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function transactionReference(now: Date): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const code = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `SC-${now.getUTCFullYear()}-${code}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
