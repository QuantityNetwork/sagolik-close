/**
 * Rule engine. Rules are plain data: WHEN <facts> THEN <effect>.
 *
 * Every rule evaluation returns the full reasoning (which facts held, which
 * didn't) so the UI, the audit log and support staff can see *why* something
 * happened. No transaction state lives inside AI prompts.
 */
import type { TransactionState } from "@sagolik/types";
import { type FactKey, type FactResult, evaluateAllFacts, FACTS, factLabel } from "./facts";
import type { TransactionSnapshot } from "./snapshot";

export type RuleEffect =
  | { kind: "enable_capability"; capability: "escrow_deposit" | "closing_funds" | "signature_requests" }
  | { kind: "advance_state"; to: TransactionState }
  | { kind: "mark_recording_ready" };

export interface Rule {
  id: string;
  description: string;
  when: FactKey[];
  then: RuleEffect;
}

export const RULES: Rule[] = [
  {
    id: "escrow_deposit_enabled",
    description: "When identities are verified and the purchase agreement is signed, the buyer can send the deposit to escrow.",
    when: ["identity_verified", "purchase_agreement_signed"],
    then: { kind: "enable_capability", capability: "escrow_deposit" },
  },
  {
    id: "closing_funds_enabled",
    description: "Closing funds can only be sent once escrow's payment instructions have been verified and compliance is clear.",
    when: ["bank_instructions_verified", "compliance_clear", "identity_verified"],
    then: { kind: "enable_capability", capability: "closing_funds" },
  },
  {
    id: "ready_for_signing",
    description: "When title is clear, the lender has issued Clear to Close and the closing statement is approved, the transaction is ready for signing.",
    when: ["title_clear", "lender_clear_to_close", "closing_statement_approved"],
    then: { kind: "advance_state", to: "ready_for_signing" },
  },
  {
    id: "request_recording",
    description: "When funds have settled and the deed is signed, the deed can be sent for recording.",
    when: ["funds_settled", "deed_signed"],
    then: { kind: "mark_recording_ready" },
  },
];

/** Section 24: everything that must hold before a deed may be submitted for recording. */
export const RECORDING_REQUIREMENTS: FactKey[] = [
  "identity_verified",
  "funds_settled",
  "deed_signed",
  "mortgage_funded",
  "title_clear",
  "taxes_paid",
  "closing_statement_approved",
  "escrow_conditions_satisfied",
  "signing_complete",
  "compliance_clear",
];

export interface RuleEvaluation {
  rule: Rule;
  satisfied: boolean;
  conditions: Array<{ fact: FactKey; label: string } & FactResult>;
}

export function evaluateRules(s: TransactionSnapshot, rules: Rule[] = RULES): RuleEvaluation[] {
  const facts = evaluateAllFacts(s);
  return rules.map((rule) => {
    const conditions = rule.when.map((fact) => ({ fact, label: factLabel(s, fact), ...facts[fact] }));
    return { rule, satisfied: conditions.every((c) => c.value), conditions };
  });
}

export function capabilityEnabled(s: TransactionSnapshot, capability: string): boolean {
  return evaluateRules(s).some(
    (r) => r.satisfied && r.rule.then.kind === "enable_capability" && r.rule.then.capability === capability,
  );
}

export function recordingReadiness(s: TransactionSnapshot) {
  const facts = evaluateAllFacts(s);
  const items = RECORDING_REQUIREMENTS.map((fact) => ({ fact, label: factLabel(s, fact), ...facts[fact] }));
  return { ready: items.every((i) => i.value), items };
}
