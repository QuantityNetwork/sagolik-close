/**
 * Page wording per kind of deal. Real estate keeps its established terms;
 * business acquisitions (beta) use the terms deal teams use.
 */
import type { DocumentCategory } from "@sagolik/types";
import { DOCUMENT_CATEGORIES } from "@sagolik/types";
import { getJurisdiction } from "@sagolik/workflow";

const BUSINESS_DOCUMENTS: DocumentCategory[] = [
  "letter_of_intent",
  "due_diligence_report",
  "disclosure_schedules",
  "definitive_agreement",
  "lien_search",
  "funds_flow_memo",
  "transfer_instrument",
  "closing_certificate",
  "identity",
  "mortgage",
  "tax",
  "insurance",
  "escrow",
  "other",
];

const REAL_ESTATE_DOCUMENTS = DOCUMENT_CATEGORIES.filter((c) => !BUSINESS_DOCUMENTS.includes(c) || ["identity", "mortgage", "tax", "insurance", "escrow", "other"].includes(c));

export function wording(jurisdiction: string) {
  const business = getJurisdiction(jurisdiction).vertical === "business";
  return business
    ? {
        business,
        documentCategories: BUSINESS_DOCUMENTS,
        title: {
          page: "Lien search",
          orderTitle: "Order the lien search",
          orderDescription: "UCC, tax and judgment lien searches on the seller and the business assets.",
          providerLabel: "Who runs the search",
          start: "Start lien search",
          empty: "The lien search hasn't been ordered yet",
          issuesTitle: "Liens, judgments and other findings",
          issuesDescription: "Every finding must be released or accepted before closing.",
          ownerLabel: "Owner of the assets",
        },
        closing: {
          readyTitle: "Ready to close?",
          readyDescription: "The closing filings can be submitted only when every requirement below is met.",
          cardTitle: "Closing and transfer",
          registryLabel: "Record",
          submit: "Submit closing filings",
          confirm: "Confirm the ownership transfer is complete",
          referenceLabel: "Confirmation reference (e.g. stock ledger entry or filing number)",
          done: "Counsel confirmed the ownership transfer",
          status: { not_ready: "Not ready", ready_for_recording: "Ready to close", submitted_for_recording: "Closing filings submitted", recorded: "Transfer confirmed", rejected: "Filing rejected" },
        },
      }
    : {
        business,
        documentCategories: REAL_ESTATE_DOCUMENTS,
        title: {
          page: "Title",
          orderTitle: "Order title",
          orderDescription: "Start the title search and insurance commitment.",
          providerLabel: "Title company",
          start: "Start title search",
          empty: "Title hasn't been ordered yet",
          issuesTitle: "Liens, judgments, easements and other issues",
          issuesDescription: "Title must be clear of unresolved issues before closing.",
          ownerLabel: "Current owner of record",
        },
        closing: {
          readyTitle: "Ready to record?",
          readyDescription: "The deed can be submitted for recording only when every requirement below is met.",
          cardTitle: "Recording",
          registryLabel: "Registry",
          submit: "Submit deed for recording",
          confirm: "Confirm the registry recorded the deed",
          referenceLabel: "Recording reference",
          done: "The registry confirmed the recording",
          status: { not_ready: "Not ready", ready_for_recording: "Ready for recording", submitted_for_recording: "Submitted to the registry", recorded: "Recorded", rejected: "Rejected by the registry" },
        },
      };
}
