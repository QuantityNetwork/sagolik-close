/**
 * Bridge between the web app's services and the Go money service: who the
 * caller is for this transaction, and turning money-service errors into
 * AppErrors with the same people-facing messages.
 */
import { ROLE_PERMISSIONS } from "@sagolik/auth";
import type { Permission } from "@sagolik/types";
import type { TransactionSnapshot } from "@sagolik/workflow";
import { requireUser, type ServiceContext } from "../context";
import { AppError, forbidden } from "../errors";
import { type MoneyCaller, MoneyServiceError } from "./client";

/** Placeholder stored in the web app's mirror row: the account number lives only in the money service. */
export const HELD_BY_MONEY_SERVICE = "held-by-money-service";

/** The caller, with the participant role on this transaction that grants `permission`. */
export function moneyCaller(ctx: ServiceContext, s: TransactionSnapshot, permission: Permission): MoneyCaller {
  const actor = requireUser(ctx);
  const participation = s.participants.find(
    (p) => p.userId === actor.userId && p.status === "active" && (ROLE_PERMISSIONS[p.role] as readonly string[]).includes(permission),
  );
  if (!participation) throw forbidden();
  return {
    userId: actor.userId,
    transactionId: s.transaction.id,
    role: participation.role,
    aal2: actor.stepUpAt !== null, // step-up is an MFA confirmation in this session
    stepUpAt: actor.stepUpAt !== null ? new Date(actor.stepUpAt) : null,
  };
}

export async function viaMoney<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MoneyServiceError) throw new AppError(e.code, e.userMessage, e.status);
    throw e;
  }
}
