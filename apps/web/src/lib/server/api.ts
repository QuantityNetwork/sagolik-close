import "server-only";
/**
 * `/api/v1` route wrapper: request ids, authentication, CSRF (same-origin for
 * cookie sessions), rate limits, idempotency keys and a consistent error
 * envelope. Handlers receive a ready ServiceContext.
 */
import type { Actor } from "@sagolik/auth";
import { AppError, getRuntime, type ServiceContext, toAppError } from "@sagolik/core";
import { RATE_LIMITS, type RateLimitPolicy, isSameOrigin, sha256Hex } from "@sagolik/security";
import type { ApiError } from "@sagolik/types";
import { NextResponse } from "next/server";
import { contextFor, rateLimit } from "./context";
import { getActor } from "./session";

export interface ApiOptions {
  /** Default: authenticated. */
  public?: boolean;
  rateLimit?: RateLimitPolicy;
}

type Handler<P> = (args: { req: Request; ctx: ServiceContext; actor: Actor; params: P; requestId: string }) => Promise<unknown>;

function errorResponse(err: AppError, requestId: string, headers: Record<string, string> = {}) {
  const body: ApiError = { error: { code: err.code, message: err.userMessage, requestId, ...(err.details ? { details: err.details } : {}) } };
  return NextResponse.json(body, { status: err.status, headers: { "x-request-id": requestId, ...headers } });
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function api<P = Record<string, string>>(handler: Handler<P>, opts: ApiOptions = {}) {
  return async (req: Request, route: { params: Promise<P> }) => {
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    try {
      const actor = await getActor();
      if (!actor) return errorResponse(new AppError("unauthenticated", "Please sign in to continue.", 401), requestId);

      // Cookie-authenticated mutations must come from our own origin (CSRF).
      if (MUTATING.has(req.method) && !isSameOrigin([req.url, (await getRuntime()).env.APP_URL], req.headers.get("origin"), req.headers.get("referer"))) {
        return errorResponse(new AppError("forbidden", "This request didn't come from Sagolik Close.", 403), requestId);
      }

      const policy = opts.rateLimit ?? (MUTATING.has(req.method) ? RATE_LIMITS.apiWrite : RATE_LIMITS.apiRead);
      const rl = await rateLimit(`api:${actor.userId}:${req.method}`, policy);
      if (!rl.allowed) {
        return errorResponse(new AppError("rate_limited", "You're doing that too often. Please wait a moment and try again.", 429), requestId, {
          "retry-after": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
        });
      }

      const ctx = { ...(await contextFor(actor)), correlationId: requestId };
      const params = await route.params;

      // Idempotency for mutations: same key + same body → same response.
      const idemKey = MUTATING.has(req.method) ? req.headers.get("idempotency-key") : null;
      const bodyText = MUTATING.has(req.method) ? await req.clone().text() : "";
      const routeKey = `${req.method} ${new URL(req.url).pathname}`;
      if (idemKey) {
        if (!/^[\w-]{8,100}$/.test(idemKey)) return errorResponse(new AppError("bad_request", "Idempotency-Key must be 8–100 letters, digits, - or _.", 400), requestId);
        const rt = await getRuntime();
        const prior = await rt.serviceDb.idempotency_keys.findOne({ key: idemKey, userId: actor.userId, route: routeKey });
        if (prior) {
          if (prior.requestHash !== sha256Hex(bodyText)) return errorResponse(new AppError("idempotency_conflict", "This Idempotency-Key was already used with a different request.", 409), requestId);
          return NextResponse.json(prior.responseBody, { status: prior.responseStatus, headers: { "x-request-id": requestId, "idempotent-replay": "true" } });
        }
      }

      const result = await handler({ req, ctx, actor, params, requestId });
      if (result instanceof Response) return result;
      const status = req.method === "POST" ? 201 : 200;
      const body = { data: result };
      if (idemKey) {
        const rt = await getRuntime();
        await rt.serviceDb.idempotency_keys
          .insert({ id: crypto.randomUUID(), key: idemKey, userId: actor.userId, route: routeKey, requestHash: sha256Hex(bodyText), responseStatus: status, responseBody: body as Record<string, unknown>, createdAt: new Date().toISOString() })
          .catch(() => undefined);
      }
      return NextResponse.json(body, { status, headers: { "x-request-id": requestId } });
    } catch (e) {
      const err = toAppError(e);
      if (err.code === "internal") console.error(JSON.stringify({ level: "error", msg: "api error", requestId, path: new URL(req.url).pathname, error: e instanceof Error ? e.message : String(e) }));
      return errorResponse(err, requestId);
    }
  };
}

export async function jsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("bad_request", "The request body must be valid JSON.", 400);
  }
}
