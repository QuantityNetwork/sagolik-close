import type { Actor } from "./authorize";

/**
 * Actions that require a fresh step-up authentication (MFA / passkey /
 * re-authentication) regardless of role.
 */
export const STEP_UP_ACTIONS = [
  "bank_instruction.change",
  "bank_instruction.verify",
  "bank_instruction.reveal",
  "escrow.record_movement",
  "payment.initiate",
  "payment.approve",
  "beneficiary.add",
  "signature.sign_closing_document",
  "organization.role_change",
  "audit.export_full",
  "bank.disconnect",
] as const;
export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

/** Step-up freshness window. */
export const STEP_UP_MAX_AGE_MS = 5 * 60 * 1000;

export class StepUpRequiredError extends Error {
  readonly code = "step_up_required" as const;
  constructor(readonly action: StepUpAction) {
    super("Please confirm it's you before continuing.");
    this.name = "StepUpRequiredError";
  }
}

export function hasFreshStepUp(actor: Actor, now = Date.now()): boolean {
  return actor.stepUpAt !== null && now - actor.stepUpAt <= STEP_UP_MAX_AGE_MS && actor.stepUpAt <= now;
}

export function assertStepUp(actor: Actor, action: StepUpAction, now = Date.now()): void {
  if (!hasFreshStepUp(actor, now)) throw new StepUpRequiredError(action);
}
