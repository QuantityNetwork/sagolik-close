/**
 * Per-request service context. Built by the web app (from the verified
 * session) or by the worker (as the system actor). Services never read
 * identity from request bodies.
 */
import type { MoneyServiceClient } from "./money/client";
import type { Actor } from "@sagolik/auth";
import type { Env, FlagOverride } from "@sagolik/config";
import type { Db } from "@sagolik/database";
import type { Providers } from "@sagolik/integrations";
import type { KeyRing } from "@sagolik/security";
import type { DocumentStorage } from "./storage";

export interface SystemActor {
  kind: "system";
  /** e.g. "workflow", "webhook:mock_payments", "worker" */
  source: string;
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface ServiceContext {
  /** Reads. In Supabase mode: user-scoped client → RLS applies. */
  db: Db;
  /** Writes after explicit authorization. In Supabase mode: service role. */
  writer: Db;
  actor: Actor | SystemActor;
  providers: Providers;
  storage: DocumentStorage;
  keyRing: KeyRing;
  env: Env;
  flags: FlagOverride[];
  correlationId: string;
  log: Logger;
  now(): Date;
  /** "inline": domain events are dispatched in-process right after commit (local/demo). "worker": the worker drains the outbox. */
  outboxMode: "inline" | "worker";
  /** Go money service. When present it is the authority for payment instructions and escrow-reported movements. */
  money: MoneyServiceClient | null;
}

export function isUser(actor: Actor | SystemActor): actor is Actor {
  return !("kind" in actor);
}

export function requireUser(ctx: ServiceContext): Actor {
  if (!isUser(ctx.actor)) throw new Error("This operation requires a signed-in person.");
  return ctx.actor;
}

/** Derive a context acting as the system (workflow engine, webhooks). Same stores, same correlation id. */
export function asSystem(ctx: ServiceContext, source: string): ServiceContext {
  return { ...ctx, db: ctx.writer, actor: { kind: "system", source } };
}

export function actorId(ctx: ServiceContext): string | null {
  return isUser(ctx.actor) ? ctx.actor.userId : null;
}

export const consoleLogger: Logger = {
  info: (msg, f) => console.info(JSON.stringify({ level: "info", msg, ...f })),
  warn: (msg, f) => console.warn(JSON.stringify({ level: "warn", msg, ...f })),
  error: (msg, f) => console.error(JSON.stringify({ level: "error", msg, ...f })),
};
