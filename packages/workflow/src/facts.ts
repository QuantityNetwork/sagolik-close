/**
 * Facts: named, pure predicates over a transaction snapshot.
 *
 * Rules, state-machine guards, the timeline and the assistant all speak in
 * terms of these facts, so every automated decision can be explained as
 * "fact X was true / false because …".
 */
import type { ParticipantRole } from "@sagolik/types";
import { getJurisdiction } from "./jurisdictions";
import type { TransactionSnapshot } from "./snapshot";

export interface FactResult {
  value: boolean;
  /** Human-readable explanation, safe to show to participants. */
  detail: string;
  /** Which participant role is responsible for making this true, when it's false. */
  responsibleRole?: ParticipantRole;
}

export type FactKey =
  | "identity_verified"
  | "purchase_agreement_signed"
  | "documents_received"
  | "financing_approved"
  | "lender_clear_to_close"
  | "mortgage_funded"
  | "inspection_completed"
  | "title_clear"
  | "closing_statement_approved"
  | "signing_complete"
  | "deed_signed"
  | "earnest_money_settled"
  | "funds_settled"
  | "escrow_conditions_satisfied"
  | "escrow_disbursed"
  | "bank_instructions_verified"
  | "compliance_clear"
  | "taxes_paid"
  | "recording_submitted"
  | "ownership_recorded";

const PRINCIPALS: ParticipantRole[] = ["buyer", "co_buyer", "seller", "co_seller"];
const SIGNATURE_DONE = new Set(["completed", "not_required"]);

type FactFn = (s: TransactionSnapshot) => FactResult;

/** The deal's workflow profile: vertical, vocabulary, document roles and step owners. */
const profile = (s: TransactionSnapshot) => getJurisdiction(s.transaction.jurisdiction);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const docsOf = (s: TransactionSnapshot, category: string) =>
  s.documents.filter((d) => d.category === category && d.status !== "superseded" && d.status !== "rejected");

export const FACTS: Record<FactKey, { label: string; evaluate: FactFn }> = {
  identity_verified: {
    label: "Everyone's identity is verified",
    evaluate: (s) => {
      const principals = s.participants.filter((p) => PRINCIPALS.includes(p.role) && p.status !== "removed" && p.status !== "declined");
      const missing = principals.filter(
        (p) => !s.identityVerifications.some((v) => v.participantId === p.id && v.status === "verified"),
      );
      if (principals.length === 0) return { value: false, detail: "No buyers or sellers have joined yet.", responsibleRole: "transaction_coordinator" };
      return missing.length === 0
        ? { value: true, detail: `${principals.length} identities verified.` }
        : {
            value: false,
            detail: `Waiting on identity verification for ${missing.map((m) => m.displayName).join(", ")}.`,
            responsibleRole: missing[0]!.role,
          };
    },
  },
  purchase_agreement_signed: {
    label: "Purchase agreement signed",
    evaluate: (s) => {
      const j = profile(s);
      const signed = docsOf(s, j.documentRoles.agreement).some((d) => d.signatureStatus === "completed");
      return signed
        ? { value: true, detail: `The ${j.vocabulary.agreement} is fully signed.` }
        : { value: false, detail: `The ${j.vocabulary.agreement} still needs every signature.`, responsibleRole: j.stepOwners.agreement };
    },
  },
  documents_received: {
    label: "Required documents received",
    evaluate: (s) => {
      const required = getJurisdiction(s.transaction.jurisdiction).requiredDocuments;
      const missing = required.filter((c) => docsOf(s, c).length === 0);
      return missing.length === 0
        ? { value: true, detail: "All required documents are in the vault." }
        : { value: false, detail: `Missing: ${missing.map((m) => m.replace(/_/g, " ")).join(", ")}.`, responsibleRole: "transaction_coordinator" };
    },
  },
  financing_approved: {
    label: "Financing approved",
    evaluate: (s) => {
      if (!s.mortgage) return { value: true, detail: `No ${profile(s).vocabulary.financing} on this ${profile(s).vertical === "business" ? "deal" : "transaction"}.` };
      const ok = ["conditional_approval", "clear_to_close", "funded"].includes(s.mortgage.status);
      return ok
        ? { value: true, detail: `${s.mortgage.lenderName} has approved the loan.` }
        : { value: false, detail: `${s.mortgage.lenderName} is still reviewing the loan.`, responsibleRole: "loan_officer" };
    },
  },
  lender_clear_to_close: {
    label: "Lender issued Clear to Close",
    evaluate: (s) => {
      if (!s.mortgage) return { value: true, detail: `No ${profile(s).vocabulary.financing} on this ${profile(s).vertical === "business" ? "deal" : "transaction"}.` };
      const ok = s.mortgage.status === "clear_to_close" || s.mortgage.status === "funded";
      const open = s.mortgageConditions.filter((c) => !c.satisfied).length;
      return ok
        ? { value: true, detail: `${s.mortgage.lenderName} issued Clear to Close.` }
        : {
            value: false,
            detail: `${s.mortgage.lenderName} has not issued Clear to Close${open ? ` (${open} loan condition${open > 1 ? "s" : ""} open)` : ""}.`,
            responsibleRole: "loan_officer",
          };
    },
  },
  mortgage_funded: {
    label: "Mortgage funded",
    evaluate: (s) => {
      if (!s.mortgage) return { value: true, detail: `No ${profile(s).vocabulary.financing} on this ${profile(s).vertical === "business" ? "deal" : "transaction"}.` };
      return s.mortgage.status === "funded"
        ? { value: true, detail: "The lender has funded the loan." }
        : { value: false, detail: "The lender has not funded the loan yet.", responsibleRole: "loan_officer" };
    },
  },
  inspection_completed: {
    label: "Inspection completed",
    evaluate: (s) => {
      const j = profile(s);
      const v = j.vocabulary;
      const doc = docsOf(s, j.documentRoles.inspection).some((d) => d.status === "approved");
      const waived = s.tasks.some((t) => t.actionKind === "book_inspection" && t.status === "waived");
      return doc || waived
        ? { value: true, detail: waived ? `The ${v.inspection} was waived.` : `The ${v.inspectionReport} has been reviewed.` }
        : { value: false, detail: `The ${v.inspectionReport} hasn't been reviewed yet.`, responsibleRole: j.stepOwners.inspection };
    },
  },
  title_clear: {
    label: "Title is clear",
    evaluate: (s) => {
      const j = profile(s);
      const owner = j.stepOwners.title;
      const business = j.vertical === "business";
      const t = s.titleCase;
      if (!t) return { value: false, detail: business ? "The lien search hasn't started." : "Title search hasn't started.", responsibleRole: owner };
      const open = s.titleIssues.filter((i) => !i.resolved);
      if ((t.status === "clear" || t.status === "insured") && open.length === 0)
        return { value: true, detail: business ? `${t.titleCompany} reports no open liens.` : `${t.titleCompany} has cleared title.` };
      const noun = business ? "lien" : "title issue";
      return {
        value: false,
        detail: open.length ? `${open.length} ${noun}${open.length > 1 ? "s" : ""} to resolve.` : business ? `${t.titleCompany} is still running the lien search.` : `${t.titleCompany} is still searching title.`,
        responsibleRole: owner,
      };
    },
  },
  closing_statement_approved: {
    label: "Closing statement approved",
    evaluate: (s) => {
      const j = profile(s);
      const ok = docsOf(s, j.documentRoles.closingStatement).some((d) => d.status === "approved");
      return ok
        ? { value: true, detail: `The ${j.vocabulary.closingStatement} is approved.` }
        : { value: false, detail: `The ${j.vocabulary.closingStatement} hasn't been approved.`, responsibleRole: "escrow_officer" };
    },
  },
  signing_complete: {
    label: "All closing documents signed",
    evaluate: (s) => {
      const live = s.documents.filter((d) => d.status !== "superseded" && d.status !== "rejected");
      const needs = live.filter((d) => !SIGNATURE_DONE.has(d.signatureStatus));
      const j = profile(s);
      const hasDeed = live.some((d) => d.category === j.documentRoles.transferInstrument);
      if (!hasDeed) return { value: false, detail: `The ${j.vocabulary.transferInstrument} ${j.vertical === "business" ? "haven't" : "hasn't"} been prepared yet.`, responsibleRole: j.stepOwners.recording };
      return needs.length === 0
        ? { value: true, detail: "Every document has all required signatures." }
        : { value: false, detail: `${needs.length} document${needs.length > 1 ? "s" : ""} still need signatures: ${needs.map((d) => d.name).join(", ")}.`, responsibleRole: "buyer" };
    },
  },
  deed_signed: {
    label: "Deed signed",
    evaluate: (s) => {
      const j = profile(s);
      const plural = j.vertical === "business";
      return docsOf(s, j.documentRoles.transferInstrument).some((d) => d.signatureStatus === "completed")
        ? { value: true, detail: `The ${j.vocabulary.transferInstrument} ${plural ? "are" : "is"} signed.` }
        : { value: false, detail: `The ${j.vocabulary.transferInstrument} ${plural ? "haven't" : "hasn't"} been signed.`, responsibleRole: j.stepOwners.transferInstrument };
    },
  },
  earnest_money_settled: {
    label: "Earnest money received",
    evaluate: (s) =>
      s.payments.some((p) => (p.type === "earnest_money" || p.type === "deposit") && p.status === "settled")
        ? { value: true, detail: "The deposit has settled in escrow." }
        : { value: false, detail: "The deposit hasn't settled yet.", responsibleRole: "buyer" },
  },
  funds_settled: {
    label: "Closing funds settled",
    evaluate: (s) => {
      if (!s.escrow) {
        const settled = s.payments.some((p) => p.type === "closing_funds" && p.status === "settled");
        return settled
          ? { value: true, detail: "Closing funds have settled." }
          : { value: false, detail: "Closing funds haven't settled yet.", responsibleRole: "buyer" };
      }
      const inFlight = s.payments.some((p) => ["initiated", "processing", "received"].includes(p.status));
      const enough = s.escrow.receivedAmount >= s.escrow.requiredAmount;
      if (enough && !inFlight) return { value: true, detail: "All funds have settled in escrow." };
      return {
        value: false,
        detail: inFlight ? "A transfer is on its way and being finalized." : "Funds are still outstanding in escrow.",
        responsibleRole: "buyer",
      };
    },
  },
  escrow_conditions_satisfied: {
    label: "Escrow conditions satisfied",
    evaluate: (s) => {
      const open = s.escrowConditions.filter((c) => !c.satisfied);
      return open.length === 0
        ? { value: true, detail: "All escrow conditions are satisfied." }
        : { value: false, detail: `${open.length} escrow condition${open.length > 1 ? "s" : ""} open.`, responsibleRole: "escrow_officer" };
    },
  },
  escrow_disbursed: {
    label: "Escrow disbursed",
    evaluate: (s) => {
      if (!s.escrow) return { value: true, detail: "No escrow account on this transaction." };
      return s.escrow.status === "disbursed" || s.escrow.status === "closed"
        ? { value: true, detail: "Escrow has disbursed all funds." }
        : { value: false, detail: "Escrow has not disbursed funds yet.", responsibleRole: "escrow_officer" };
    },
  },
  bank_instructions_verified: {
    label: "Payment instructions verified",
    evaluate: (s) => {
      const latest = latestInstruction(s, "closing_funds_to_escrow");
      return latest && (latest.status === "verified" || latest.status === "locked")
        ? { value: true, detail: `Escrow payment instructions verified (v${latest.version}).` }
        : { value: false, detail: "Escrow payment instructions haven't been verified.", responsibleRole: "escrow_officer" };
    },
  },
  compliance_clear: {
    label: "No open compliance reviews",
    evaluate: (s) => {
      const open = s.complianceCases.filter((c) => c.status !== "approved");
      return open.length === 0
        ? { value: true, detail: "No open compliance reviews." }
        : { value: false, detail: `${open.length} compliance review${open.length > 1 ? "s" : ""} open.`, responsibleRole: "escrow_officer" };
    },
  },
  taxes_paid: {
    label: "Transfer taxes paid",
    evaluate: (s) => {
      const taxes = getJurisdiction(s.transaction.jurisdiction).taxes.filter((t) => t.key !== "property_tax_proration");
      if (taxes.length === 0)
        return {
          value: true,
          detail: profile(s).vertical === "business" ? "No transfer taxes are tracked for this deal; counsel handles any state tax clearance." : "No transfer taxes apply in this jurisdiction.",
        };
      return s.payments.some((p) => p.type === "tax" && p.status === "settled")
        ? { value: true, detail: "Transfer taxes are paid." }
        : { value: false, detail: `${taxes.map((t) => t.label).join(", ")} not yet paid.`, responsibleRole: "escrow_officer" };
    },
  },
  recording_submitted: {
    label: "Submitted for recording",
    evaluate: (s) =>
      s.recording && (s.recording.status === "submitted_for_recording" || s.recording.status === "recorded")
        ? { value: true, detail: `Submitted to ${s.recording.registry}.` }
        : profile(s).vertical === "business"
          ? { value: false, detail: "The closing filings haven't been submitted.", responsibleRole: profile(s).stepOwners.recording }
          : { value: false, detail: "The deed hasn't been submitted for recording.", responsibleRole: profile(s).stepOwners.recording },
  },
  ownership_recorded: {
    label: "Ownership recorded",
    evaluate: (s) => {
      const r = s.recording;
      // Only a confirmed recording with a registry reference counts. A click is not enough.
      const ok = !!r && r.status === "recorded" && !!r.recordingReference && !!r.confirmationSource && !!r.recordedAt;
      const j = profile(s);
      if (j.vertical === "business")
        return ok
          ? { value: true, detail: `Transfer confirmed by counsel (ref ${r!.recordingReference}).` }
          : { value: false, detail: "Counsel hasn't confirmed the ownership transfer yet.", responsibleRole: j.stepOwners.recording };
      return ok
        ? { value: true, detail: `Recorded at ${r!.registry} (ref ${r!.recordingReference}).` }
        : { value: false, detail: "The registry hasn't confirmed the recording yet.", responsibleRole: j.stepOwners.recording };
    },
  },
};

export function latestInstruction(s: TransactionSnapshot, purpose: string) {
  return s.bankInstructions
    .filter((b) => b.purpose === purpose)
    .sort((a, b) => b.version - a.version)[0];
}

export function evaluateFact(key: FactKey, s: TransactionSnapshot): FactResult {
  return FACTS[key].evaluate(s);
}

export function evaluateAllFacts(s: TransactionSnapshot): Record<FactKey, FactResult> {
  const out = {} as Record<FactKey, FactResult>;
  for (const key of Object.keys(FACTS) as FactKey[]) out[key] = FACTS[key].evaluate(s);
  return out;
}

/** Per-profile wording for fact labels shown in rules and readiness lists. */
const BUSINESS_FACT_LABELS: Partial<Record<FactKey, string>> = {
  purchase_agreement_signed: "Definitive agreement signed",
  financing_approved: "Acquisition financing approved",
  mortgage_funded: "Acquisition loan funded",
  inspection_completed: "Due diligence complete",
  title_clear: "No open liens",
  closing_statement_approved: "Funds flow memo approved",
  signing_complete: "All closing documents signed",
  deed_signed: "Transfer documents signed",
  earnest_money_settled: "Deposit received",
  taxes_paid: "Transfer taxes handled",
  recording_submitted: "Closing filings submitted",
  ownership_recorded: "Ownership transfer confirmed",
};

export function factLabel(s: TransactionSnapshot, key: FactKey): string {
  const business = getJurisdiction(s.transaction.jurisdiction).vertical === "business";
  return (business ? BUSINESS_FACT_LABELS[key] : undefined) ?? FACTS[key].label;
}
