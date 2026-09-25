/**
 * Jurisdiction engine.
 *
 * Real-estate closing differs dramatically between markets. Everything that
 * varies by market lives here as data, never as `if (country === ...)` inside
 * business logic. Adding a market means adding a config entry + tests.
 *
 * These configs describe the product's workflow model for each market. They
 * are NOT legal advice and must be reviewed by local counsel before launch in
 * a market (see docs/compliance-boundaries.md).
 */
import type { Currency, DocumentCategory, Locale, MilestoneKey, ParticipantRole } from "@sagolik/types";

export type Vertical = "real_estate" | "business";

/** Words the product uses for this kind of deal (lowercase, used inside sentences). */
export interface Vocabulary {
  subject: string; // "property" | "business"
  agreement: string; // "purchase agreement" | "definitive agreement"
  inspection: string; // "inspection" | "due diligence"
  inspectionReport: string; // "inspection report" | "due diligence report"
  title: string; // "title" | "lien search"
  closingStatement: string; // "closing statement" | "funds flow memo"
  transferInstrument: string; // "deed" | "transfer documents"
  recording: string; // "recording" | "closing filings"
  financing: string; // "mortgage" | "acquisition financing"
  deposit: string; // "earnest money" | "deposit"
}

/** Which document category plays each role in the workflow. */
export interface DocumentRoles {
  agreement: DocumentCategory;
  inspection: DocumentCategory;
  closingStatement: DocumentCategory;
  transferInstrument: DocumentCategory;
}

/** Who is responsible for moving each step forward. */
export interface StepOwners {
  agreement: ParticipantRole;
  inspection: ParticipantRole;
  title: ParticipantRole;
  recording: ParticipantRole;
  transferInstrument: ParticipantRole;
}

export interface JurisdictionConfig {
  code: string;
  vertical: Vertical;
  vocabulary: Vocabulary;
  documentRoles: DocumentRoles;
  stepOwners: StepOwners;
  name: string;
  country: string;
  currency: Currency;
  locale: Locale;
  /** Launch status inside the product. */
  availability: "available" | "pilot" | "planned";
  requiredParticipants: ParticipantRole[];
  requiredDocuments: DocumentCategory[];
  /** Ordered milestones shown on the timeline for this market. */
  milestones: MilestoneKey[];
  milestoneLabels?: Partial<Record<MilestoneKey, string>>;
  identity: { methods: string[]; livenessRequired: boolean; sanctionsScreening: boolean };
  signatures: { qualifiedSignatureForDeed: boolean; notaryRequiredForDeed: boolean; wetInkDeed: boolean };
  escrow: {
    available: boolean;
    model: "escrow_company" | "title_company" | "notary_trust_account" | "bank_settlement";
  };
  recording: { registry: string; confirmation: "registry_api" | "authorized_professional"; confirmingRoles: ParticipantRole[] };
  taxes: Array<{ key: string; label: string; payer: "buyer" | "seller" | "split" }>;
}

/** Real-estate defaults shared by every property market. */
const REAL_ESTATE = {
  vertical: "real_estate",
  vocabulary: {
    subject: "property",
    agreement: "purchase agreement",
    inspection: "inspection",
    inspectionReport: "inspection report",
    title: "title",
    closingStatement: "closing statement",
    transferInstrument: "deed",
    recording: "recording",
    financing: "mortgage",
    deposit: "earnest money",
  },
  documentRoles: { agreement: "purchase_agreement", inspection: "inspection", closingStatement: "closing_statement", transferInstrument: "deed" },
  stepOwners: { agreement: "buyer_agent", inspection: "buyer_agent", title: "title_officer", recording: "title_officer", transferInstrument: "seller" },
} satisfies Pick<JurisdictionConfig, "vertical" | "vocabulary" | "documentRoles" | "stepOwners">;

const ALL_US_MILESTONES: MilestoneKey[] = [
  "offer_accepted",
  "transaction_opened",
  "identity_verified",
  "documents_received",
  "financing_approved",
  "inspection_completed",
  "title_cleared",
  "signing_complete",
  "funds_received",
  "recording_submitted",
  "ownership_transferred",
];

export const JURISDICTIONS: Record<string, JurisdictionConfig> = {
  "US-TX": {
    code: "US-TX",
    ...REAL_ESTATE,
    name: "Texas, United States",
    country: "US",
    currency: "USD",
    locale: "en",
    availability: "available",
    requiredParticipants: ["buyer", "seller", "title_officer", "escrow_officer"],
    requiredDocuments: ["purchase_agreement", "disclosure", "inspection", "title", "closing_statement", "deed"],
    milestones: ALL_US_MILESTONES,
    identity: { methods: ["document_liveness"], livenessRequired: true, sanctionsScreening: true },
    signatures: { qualifiedSignatureForDeed: false, notaryRequiredForDeed: true, wetInkDeed: false },
    escrow: { available: true, model: "title_company" },
    recording: { registry: "County Clerk — Real Property Records", confirmation: "authorized_professional", confirmingRoles: ["title_officer", "escrow_officer"] },
    taxes: [{ key: "property_tax_proration", label: "Property tax proration", payer: "split" }],
  },
  "US-CA": {
    code: "US-CA",
    ...REAL_ESTATE,
    name: "California, United States",
    country: "US",
    currency: "USD",
    locale: "en",
    availability: "pilot",
    requiredParticipants: ["buyer", "seller", "escrow_officer", "title_officer"],
    requiredDocuments: ["purchase_agreement", "disclosure", "inspection", "title", "closing_statement", "deed"],
    milestones: ALL_US_MILESTONES,
    identity: { methods: ["document_liveness"], livenessRequired: true, sanctionsScreening: true },
    signatures: { qualifiedSignatureForDeed: false, notaryRequiredForDeed: true, wetInkDeed: false },
    escrow: { available: true, model: "escrow_company" },
    recording: { registry: "County Recorder", confirmation: "authorized_professional", confirmingRoles: ["escrow_officer", "title_officer"] },
    taxes: [{ key: "documentary_transfer_tax", label: "Documentary transfer tax", payer: "seller" }],
  },
  SE: {
    code: "SE",
    ...REAL_ESTATE,
    name: "Sweden",
    country: "SE",
    currency: "SEK",
    locale: "sv",
    availability: "pilot",
    requiredParticipants: ["buyer", "seller", "agent"],
    requiredDocuments: ["purchase_agreement", "mortgage", "closing_statement", "deed"],
    milestones: [
      "offer_accepted",
      "transaction_opened",
      "identity_verified",
      "documents_received",
      "financing_approved",
      "inspection_completed",
      "signing_complete",
      "funds_received",
      "recording_submitted",
      "ownership_transferred",
    ],
    milestoneLabels: {
      offer_accepted: "Köpekontrakt signed",
      signing_complete: "Köpebrev signed",
      funds_received: "Tillträde — payment settled",
      recording_submitted: "Lagfart applied for",
      ownership_transferred: "Lagfart granted",
    },
    identity: { methods: ["bankid_se"], livenessRequired: false, sanctionsScreening: true },
    signatures: { qualifiedSignatureForDeed: false, notaryRequiredForDeed: false, wetInkDeed: true },
    escrow: { available: false, model: "bank_settlement" },
    recording: { registry: "Lantmäteriet (inskrivningsmyndigheten)", confirmation: "authorized_professional", confirmingRoles: ["agent", "attorney"] },
    taxes: [{ key: "stamp_duty", label: "Stämpelskatt (1.5%)", payer: "buyer" }],
  },
  PL: {
    code: "PL",
    ...REAL_ESTATE,
    name: "Poland",
    country: "PL",
    currency: "PLN",
    locale: "pl",
    availability: "planned",
    requiredParticipants: ["buyer", "seller", "notary"],
    requiredDocuments: ["purchase_agreement", "title", "deed", "tax"],
    milestones: [
      "offer_accepted",
      "transaction_opened",
      "identity_verified",
      "documents_received",
      "financing_approved",
      "title_cleared",
      "signing_complete",
      "funds_received",
      "recording_submitted",
      "ownership_transferred",
    ],
    milestoneLabels: {
      title_cleared: "Księga wieczysta checked",
      signing_complete: "Akt notarialny signed",
      recording_submitted: "Wniosek wieczystoksięgowy filed",
    },
    identity: { methods: ["document_liveness", "eidas"], livenessRequired: true, sanctionsScreening: true },
    signatures: { qualifiedSignatureForDeed: true, notaryRequiredForDeed: true, wetInkDeed: true },
    escrow: { available: true, model: "notary_trust_account" },
    recording: { registry: "Księgi wieczyste (Sąd rejonowy)", confirmation: "authorized_professional", confirmingRoles: ["notary", "attorney"] },
    taxes: [{ key: "pcc", label: "PCC 2%", payer: "buyer" }],
  },
  DE: {
    code: "DE",
    ...REAL_ESTATE,
    name: "Germany",
    country: "DE",
    currency: "EUR",
    locale: "de",
    availability: "planned",
    requiredParticipants: ["buyer", "seller", "notary"],
    requiredDocuments: ["purchase_agreement", "title", "deed", "tax"],
    milestones: [
      "offer_accepted",
      "transaction_opened",
      "identity_verified",
      "financing_approved",
      "signing_complete",
      "title_cleared",
      "funds_received",
      "recording_submitted",
      "ownership_transferred",
    ],
    milestoneLabels: {
      signing_complete: "Notarieller Kaufvertrag beurkundet",
      title_cleared: "Auflassungsvormerkung eingetragen",
      recording_submitted: "Umschreibung beantragt",
      ownership_transferred: "Grundbuch umgeschrieben",
    },
    identity: { methods: ["eidas", "document_liveness"], livenessRequired: true, sanctionsScreening: true },
    signatures: { qualifiedSignatureForDeed: true, notaryRequiredForDeed: true, wetInkDeed: true },
    escrow: { available: true, model: "notary_trust_account" },
    recording: { registry: "Grundbuchamt", confirmation: "authorized_professional", confirmingRoles: ["notary"] },
    taxes: [{ key: "grunderwerbsteuer", label: "Grunderwerbsteuer", payer: "buyer" }],
  },
  LI: {
    code: "LI",
    ...REAL_ESTATE,
    name: "Liechtenstein",
    country: "LI",
    currency: "CHF",
    locale: "de",
    availability: "planned",
    requiredParticipants: ["buyer", "seller", "attorney"],
    requiredDocuments: ["purchase_agreement", "title", "deed"],
    milestones: ["offer_accepted", "transaction_opened", "identity_verified", "financing_approved", "signing_complete", "funds_received", "recording_submitted", "ownership_transferred"],
    identity: { methods: ["document_liveness"], livenessRequired: true, sanctionsScreening: true },
    signatures: { qualifiedSignatureForDeed: true, notaryRequiredForDeed: false, wetInkDeed: true },
    escrow: { available: true, model: "bank_settlement" },
    recording: { registry: "Grundbuch (Amt für Justiz)", confirmation: "authorized_professional", confirmingRoles: ["attorney"] },
    taxes: [],
  },
  CH: {
    code: "CH",
    ...REAL_ESTATE,
    name: "Switzerland",
    country: "CH",
    currency: "CHF",
    locale: "de",
    availability: "planned",
    requiredParticipants: ["buyer", "seller", "notary"],
    requiredDocuments: ["purchase_agreement", "title", "deed", "tax"],
    milestones: ["offer_accepted", "transaction_opened", "identity_verified", "financing_approved", "signing_complete", "funds_received", "recording_submitted", "ownership_transferred"],
    milestoneLabels: { ownership_transferred: "Grundbucheintrag erfolgt" },
    identity: { methods: ["document_liveness"], livenessRequired: true, sanctionsScreening: true },
    signatures: { qualifiedSignatureForDeed: true, notaryRequiredForDeed: true, wetInkDeed: true },
    escrow: { available: true, model: "notary_trust_account" },
    recording: { registry: "Grundbuchamt (cantonal)", confirmation: "authorized_professional", confirmingRoles: ["notary"] },
    taxes: [{ key: "handaenderungssteuer", label: "Handänderungssteuer (cantonal)", payer: "split" }],
  },
  /**
   * Business acquisitions in the United States (beta). One profile for asset,
   * stock and membership-interest purchases; state-specific steps (bulk-sale
   * notices, tax clearance, consents) are tracked as tasks and conditions, not
   * modelled per state yet. Needs counsel review before any live use.
   */
  "US-BUSINESS": {
    code: "US-BUSINESS",
    vertical: "business",
    vocabulary: {
      subject: "business",
      agreement: "definitive agreement",
      inspection: "due diligence",
      inspectionReport: "due diligence report",
      title: "lien search",
      closingStatement: "funds flow memo",
      transferInstrument: "transfer documents",
      recording: "closing filings",
      financing: "acquisition financing",
      deposit: "deposit",
    },
    documentRoles: { agreement: "definitive_agreement", inspection: "due_diligence_report", closingStatement: "funds_flow_memo", transferInstrument: "transfer_instrument" },
    stepOwners: { agreement: "attorney", inspection: "accountant", title: "attorney", recording: "attorney", transferInstrument: "seller" },
    name: "United States — business acquisition (beta)",
    country: "US",
    currency: "USD",
    locale: "en",
    availability: "pilot",
    requiredParticipants: ["buyer", "seller", "attorney", "escrow_officer"],
    // Diligence set for "documents received"; closing documents are tracked by the signing and closing steps.
    requiredDocuments: ["letter_of_intent", "due_diligence_report", "disclosure_schedules"],
    milestones: ALL_US_MILESTONES,
    milestoneLabels: {
      offer_accepted: "LOI signed",
      transaction_opened: "Deal room opened",
      identity_verified: "Parties verified",
      documents_received: "Diligence documents in",
      financing_approved: "Financing approved",
      inspection_completed: "Due diligence complete",
      title_cleared: "Lien search clear",
      signing_complete: "Closing documents signed",
      funds_received: "Funds received",
      recording_submitted: "Closing filings submitted",
      ownership_transferred: "Ownership transferred",
    },
    identity: { methods: ["document_liveness"], livenessRequired: true, sanctionsScreening: true },
    signatures: { qualifiedSignatureForDeed: false, notaryRequiredForDeed: false, wetInkDeed: false },
    escrow: { available: true, model: "escrow_company" },
    recording: {
      registry: "Closing record (stock ledger or bill of sale) and state filings",
      confirmation: "authorized_professional",
      confirmingRoles: ["attorney"],
    },
    taxes: [],
  },
};

export class UnknownJurisdictionError extends Error {
  constructor(code: string) {
    super(`Unsupported jurisdiction: ${code}`);
  }
}

export function getJurisdiction(code: string): JurisdictionConfig {
  const j = JURISDICTIONS[code];
  if (!j) throw new UnknownJurisdictionError(code);
  return j;
}
