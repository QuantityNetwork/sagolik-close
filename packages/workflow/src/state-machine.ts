/**
 * Transaction state machine.
 *
 * The allowed transitions below are mirrored into the `transaction_transitions`
 * table (seeded by migration 0002) and a database trigger rejects any UPDATE
 * of `transactions.state` that isn't in that table. The TypeScript layer adds
 * fact-based guards on top.
 */
import type { Permission, TransactionState } from "@sagolik/types";
import { type FactKey, evaluateFact } from "./facts";
import { RECORDING_REQUIREMENTS } from "./rules";
import type { TransactionSnapshot } from "./snapshot";

export const TERMINAL_STATES: readonly TransactionState[] = ["closed", "cancelled"];

/** Main forward path, in order. */
export const FORWARD_PATH: readonly TransactionState[] = [
  "draft",
  "invited",
  "identity_pending",
  "documents_pending",
  "financing_pending",
  "conditions_pending",
  "ready_for_signing",
  "signing",
  "escrow_pending",
  "funding_pending",
  "recording_pending",
  "ownership_transfer",
  "closed",
];

const ACTIVE_STATES = FORWARD_PATH.filter((s) => s !== "closed");

/** Allowed regressions — when new information sends a file back a step. */
const REGRESSIONS: Array<[TransactionState, TransactionState]> = [
  ["ready_for_signing", "conditions_pending"],
  ["signing", "conditions_pending"],
  ["escrow_pending", "signing"],
  ["funding_pending", "escrow_pending"],
  ["recording_pending", "funding_pending"],
];

export interface TransitionDef {
  from: TransactionState;
  to: TransactionState;
  permission: Permission;
  /** Facts that must be true to enter `to`. */
  guards: FactKey[];
  /** True when the workflow engine may take this transition on its own. */
  automatic: boolean;
}

const GUARDS: Partial<Record<TransactionState, FactKey[]>> = {
  documents_pending: ["identity_verified"],
  financing_pending: ["purchase_agreement_signed"],
  conditions_pending: ["financing_approved"],
  ready_for_signing: ["title_clear", "lender_clear_to_close", "closing_statement_approved"],
  escrow_pending: ["signing_complete"],
  funding_pending: ["funds_settled"],
  recording_pending: RECORDING_REQUIREMENTS,
  ownership_transfer: ["ownership_recorded"],
  closed: ["ownership_recorded", "escrow_disbursed"],
};

function buildTransitions(): TransitionDef[] {
  const defs: TransitionDef[] = [];
  for (let i = 0; i < FORWARD_PATH.length - 1; i++) {
    const from = FORWARD_PATH[i]!;
    const to = FORWARD_PATH[i + 1]!;
    defs.push({
      from,
      to,
      permission: to === "closed" ? "transaction.close" : "transaction.transition",
      guards: GUARDS[to] ?? [],
      // Leaving draft/invited and ready_for_signing→signing are human decisions.
      // Closing the file is a human sign-off.
      automatic: !["invited", "identity_pending", "signing", "closed"].includes(to),
    });
  }
  for (const [from, to] of REGRESSIONS) {
    defs.push({ from, to, permission: "transaction.transition", guards: [], automatic: false });
  }
  for (const from of ACTIVE_STATES) {
    defs.push({ from, to: "cancelled", permission: "transaction.close", guards: [], automatic: false });
    defs.push({ from, to: "disputed", permission: "transaction.view", guards: [], automatic: false });
  }
  // Resolving a dispute returns the file to an active state; guards still apply.
  for (const to of ACTIVE_STATES) {
    defs.push({ from: "disputed", to, permission: "transaction.transition", guards: GUARDS[to] ?? [], automatic: false });
  }
  defs.push({ from: "disputed", to: "cancelled", permission: "transaction.close", guards: [], automatic: false });
  return defs;
}

export const TRANSITIONS: readonly TransitionDef[] = buildTransitions();

export function findTransition(from: TransactionState, to: TransactionState): TransitionDef | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export class InvalidTransitionError extends Error {
  readonly code = "invalid_transition" as const;
  constructor(
    message: string,
    readonly unmet: Array<{ fact: FactKey; detail: string }> = [],
  ) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

export interface TransitionCheck {
  allowed: boolean;
  def?: TransitionDef;
  unmet: Array<{ fact: FactKey; detail: string }>;
  reason?: string;
}

/** Pure check: is `from → to` defined and are its guards satisfied? */
export function checkTransition(s: TransactionSnapshot, to: TransactionState): TransitionCheck {
  const from = s.transaction.state;
  if (TERMINAL_STATES.includes(from)) return { allowed: false, unmet: [], reason: "This transaction is already finished." };
  const def = findTransition(from, to);
  if (!def) return { allowed: false, unmet: [], reason: `A transaction can't move from ${from} to ${to}.` };
  const unmet = def.guards
    .map((fact) => ({ fact, result: evaluateFact(fact, s) }))
    .filter((g) => !g.result.value)
    .map((g) => ({ fact: g.fact, detail: g.result.detail }));
  return { allowed: unmet.length === 0, def, unmet, reason: unmet.length ? "Some requirements aren't met yet." : undefined };
}

export function assertTransition(s: TransactionSnapshot, to: TransactionState): TransitionDef {
  const check = checkTransition(s, to);
  if (!check.allowed || !check.def) throw new InvalidTransitionError(check.reason ?? "Transition not allowed.", check.unmet);
  return check.def;
}

/**
 * Walk the forward path as far as automatic transitions allow. Returns the
 * states the engine would pass through (possibly empty). Pure — callers
 * persist each step as its own transaction_event.
 */
export function planAutomaticAdvance(s: TransactionSnapshot, maxSteps = FORWARD_PATH.length): TransactionState[] {
  const steps: TransactionState[] = [];
  let current = s;
  for (let i = 0; i < maxSteps; i++) {
    const idx = FORWARD_PATH.indexOf(current.transaction.state);
    if (idx === -1 || idx === FORWARD_PATH.length - 1) break;
    const next = FORWARD_PATH[idx + 1]!;
    const check = checkTransition(current, next);
    if (!check.allowed || !check.def?.automatic) break;
    steps.push(next);
    current = { ...current, transaction: { ...current.transaction, state: next } };
  }
  return steps;
}

export function isTerminal(state: TransactionState): boolean {
  return TERMINAL_STATES.includes(state);
}
