import "server-only";
import { toAppError } from "@sagolik/core";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; code: string; details?: Array<{ path: string; message: string }> };

/**
 * Runs a server action body, converting any failure into a message a person
 * can act on. Technical details are logged, never shown.
 */
export async function runAction<T>(fn: () => Promise<{ message?: string; data?: T; revalidate?: string[] } | void>): Promise<ActionResult<T>> {
  try {
    const r = (await fn()) ?? {};
    for (const p of r.revalidate ?? []) revalidatePath(p, "layout");
    return { ok: true, message: r.message, data: r.data };
  } catch (e) {
    unstable_rethrow(e); // let redirect()/notFound() through
    const err = toAppError(e);
    if (err.code === "internal") console.error(JSON.stringify({ level: "error", msg: "action failed", error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e) }));
    return { ok: false, error: err.userMessage, code: err.code, details: err.details };
  }
}

export function formString(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** Parses a money input like "25,000.50" into integer minor units. */
export function parseMoneyInput(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
}

/**
 * Exact money parsing for amounts people type ("2,870.50", "$14,200"): digits
 * and at most two decimals, converted to integer minor units without floating
 * point. Returns undefined when empty and null when it isn't an amount.
 */
export function parseAmount(v: string | undefined): number | undefined | null {
  if (!v) return undefined;
  const m = v.replace(/[\s$,]/g, "").match(/^(\d{1,12})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
