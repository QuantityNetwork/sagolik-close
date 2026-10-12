import type { CSSProperties } from "react";

/** Stagger index for children of a revealed block: style={stagger(i)}. */
export function stagger(i: number, delayMs?: number): CSSProperties {
  return { "--i": i, ...(delayMs !== undefined ? { "--d": `${delayMs}ms` } : {}) } as CSSProperties;
}

/** Entrance delay for load-time animations: style={delay(120)}. */
export function delay(ms: number): CSSProperties {
  return { "--d": `${ms}ms` } as CSSProperties;
}
