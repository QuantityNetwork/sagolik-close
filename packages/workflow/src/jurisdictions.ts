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

export interface JurisdictionConfig {
  code: string;
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
