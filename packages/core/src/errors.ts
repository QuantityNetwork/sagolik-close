/**
 * Application errors. Every error that can reach a person carries a message
 * written for that person; technical detail stays in logs.
 */
import { AuthorizationError, StepUpRequiredError } from "@sagolik/auth";
import { NotFoundError as DbNotFound, UniqueViolationError } from "@sagolik/database";
import { ProviderError } from "@sagolik/integrations";
import type { ErrorCode } from "@sagolik/types";
import { InvalidTransitionError } from "@sagolik/workflow";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly userMessage: string,
    readonly status: number,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(userMessage);
    this.name = "AppError";
  }
}

export const notFound = (what = "That item") => new AppError("not_found", `${what} couldn't be found, or you don't have access to it.`, 404);
export const badRequest = (msg: string, details?: Array<{ path: string; message: string }>) => new AppError("bad_request", msg, 400, details);
export const conflict = (msg: string) => new AppError("conflict", msg, 409);
export const forbidden = (msg = "You don't have access to do that.") => new AppError("forbidden", msg, 403);

/** Normalise anything thrown inside a service into an AppError. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof AuthorizationError) return new AppError("forbidden", e.message, 403);
  if (e instanceof StepUpRequiredError) return new AppError("step_up_required", e.message, 403);
  if (e instanceof InvalidTransitionError) {
    return new AppError(
      "invalid_transition",
      e.unmet.length ? `${e.message} ${e.unmet.map((u) => u.detail).join(" ")}` : e.message,
      409,
      e.unmet.map((u) => ({ path: u.fact, message: u.detail })),
    );
  }
  if (e instanceof ProviderError) return new AppError("provider_error", e.userMessage, 502);
  if (e instanceof DbNotFound) return notFound();
  if (e instanceof UniqueViolationError) return conflict("That already exists.");
  if (e instanceof ZodError) {
    return badRequest(
      "Some of the information provided isn't valid.",
      e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return new AppError("internal", "Something went wrong on our side. We've been notified and are looking into it.", 500);
}
