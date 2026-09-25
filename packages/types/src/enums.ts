/**
 * Canonical enumerations for Sagolik Close.
 *
 * Every enum here has a matching PostgreSQL enum in
 * `supabase/migrations/0001_foundation.sql`. The `schema-parity` test keeps
 * them aligned — change both together.
 */
import { z } from "zod";

const e = <const T extends readonly [string, ...string[]]>(values: T) => ({
  values,
  schema: z.enum(values),
});

export const TRANSACTION_STATES = [
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
  "cancelled",
  "disputed",
] as const;
export const TransactionState = e(TRANSACTION_STATES).schema;
export type TransactionState = (typeof TRANSACTION_STATES)[number];

export const TRANSACTION_TYPES = ["purchase", "sale", "refinance", "ownership_transfer", "business_acquisition"] as const;
export const TransactionType = e(TRANSACTION_TYPES).schema;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const PARTICIPANT_ROLES = [
  "buyer",
  "co_buyer",
  "seller",
  "co_seller",
  "agent",
  "buyer_agent",
  "seller_agent",
  "broker",
  "loan_officer",
  "mortgage_processor",
  "title_officer",
  "escrow_officer",
  "attorney",
  "notary",
  "insurance_agent",
  "transaction_coordinator",
  "auditor",
  "accountant",
] as const;
export const ParticipantRole = e(PARTICIPANT_ROLES).schema;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const ORGANIZATION_ROLES = ["organization_admin", "member", "auditor"] as const;
export const OrganizationRole = e(ORGANIZATION_ROLES).schema;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const ORGANIZATION_TYPES = [
  "real_estate_agency",
  "title_company",
  "law_firm",
  "mortgage_lender",
  "escrow_provider",
  "bank",
  "developer",
  "property_company",
  "brokerage",
  "ma_advisory",
  "accounting_firm",
] as const;
export const OrganizationType = e(ORGANIZATION_TYPES).schema;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const PARTICIPANT_STATUSES = ["invited", "active", "declined", "removed"] as const;
export const ParticipantStatus = e(PARTICIPANT_STATUSES).schema;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "waiting", "complete", "waived"] as const;
export const TaskStatus = e(TASK_STATUSES).schema;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TaskPriority = e(TASK_PRIORITIES).schema;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const DOCUMENT_CATEGORIES = [
  "purchase_agreement",
  "disclosure",
  "identity",
  "mortgage",
  "title",
  "inspection",
  "appraisal",
  "insurance",
  "escrow",
  "tax",
  "closing_statement",
  "deed",
  "power_of_attorney",
  "notary",
  "recording",
  "other",
  "letter_of_intent",
  "due_diligence_report",
  "definitive_agreement",
  "disclosure_schedules",
  "lien_search",
  "transfer_instrument",
  "funds_flow_memo",
  "closing_certificate",
] as const;
export const DocumentCategory = e(DOCUMENT_CATEGORIES).schema;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_STATUSES = [
  "processing",
  "pending_review",
  "needs_attention",
  "approved",
  "rejected",
  "superseded",
] as const;
export const DocumentStatus = e(DOCUMENT_STATUSES).schema;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const SIGNATURE_STATUSES = [
  "not_required",
  "draft",
  "sent",
  "viewed",
  "signed",
  "declined",
  "expired",
  "completed",
] as const;
export const SignatureStatus = e(SIGNATURE_STATUSES).schema;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

export const ACCESS_LEVELS = ["all_participants", "principals_and_professionals", "professionals_only", "restricted"] as const;
export const AccessLevel = e(ACCESS_LEVELS).schema;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const BANK_CONNECTION_STATUSES = [
  "not_connected",
  "connecting",
  "consent_required",
  "connected",
  "reauthentication_required",
  "expired",
  "revoked",
  "error",
] as const;
export const BankConnectionStatus = e(BANK_CONNECTION_STATUSES).schema;
export type BankConnectionStatus = (typeof BANK_CONNECTION_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "created",
  "authorization_required",
  "authorized",
  "initiated",
  "processing",
  "received",
  "settled",
  "failed",
  "returned",
  "cancelled",
] as const;
export const PaymentStatus = e(PAYMENT_STATUSES).schema;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_TYPES = [
  "earnest_money",
  "deposit",
  "closing_funds",
  "fee",
  "tax",
  "insurance",
  "escrow_disbursement",
  "refund",
] as const;
export const PaymentType = e(PAYMENT_TYPES).schema;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_RAILS = ["ach", "wire", "fednow", "rtp", "sepa", "sepa_instant", "open_banking", "card", "manual"] as const;
export const PaymentRail = e(PAYMENT_RAILS).schema;
export type PaymentRail = (typeof PAYMENT_RAILS)[number];

export const ESCROW_STATUSES = ["not_opened", "open", "awaiting_deposit", "funded", "conditions_pending", "releasing", "disbursed", "closed"] as const;
export const EscrowStatus = e(ESCROW_STATUSES).schema;
export type EscrowStatus = (typeof ESCROW_STATUSES)[number];

export const MORTGAGE_STATUSES = [
  "not_started",
  "application",
  "document_collection",
  "underwriting",
  "conditional_approval",
  "clear_to_close",
  "funded",
] as const;
export const MortgageStatus = e(MORTGAGE_STATUSES).schema;
export type MortgageStatus = (typeof MORTGAGE_STATUSES)[number];

export const TITLE_STATUSES = ["not_started", "searching", "issues_found", "curing", "clear", "insured"] as const;
export const TitleStatus = e(TITLE_STATUSES).schema;
export type TitleStatus = (typeof TITLE_STATUSES)[number];

export const IDENTITY_STATUSES = ["not_started", "pending", "processing", "verified", "failed", "review_required", "expired"] as const;
export const IdentityStatus = e(IDENTITY_STATUSES).schema;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export const COMPLIANCE_CATEGORIES = [
  "kyc",
  "kyb",
  "aml",
  "sanctions",
  "pep",
  "source_of_funds",
  "source_of_wealth",
  "fraud",
  "identity_mismatch",
] as const;
export const ComplianceCategory = e(COMPLIANCE_CATEGORIES).schema;
export type ComplianceCategory = (typeof COMPLIANCE_CATEGORIES)[number];

export const COMPLIANCE_STATUSES = ["pending", "review_required", "approved", "rejected", "escalated"] as const;
export const ComplianceStatus = e(COMPLIANCE_STATUSES).schema;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export const RECORDING_STATUSES = [
  "not_ready",
  "ready_for_recording",
  "submitted_for_recording",
  "recorded",
  "rejected",
] as const;
export const RecordingStatus = e(RECORDING_STATUSES).schema;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

export const SOURCE_OF_FUNDS_TYPES = [
  "salary_savings",
  "property_sale",
  "investment_liquidation",
  "inheritance",
  "business_distribution",
  "mortgage_financing",
  "gift",
] as const;
export const SourceOfFundsType = e(SOURCE_OF_FUNDS_TYPES).schema;
export type SourceOfFundsType = (typeof SOURCE_OF_FUNDS_TYPES)[number];

export const CURRENCIES = ["USD", "EUR", "SEK", "PLN", "GBP", "CHF"] as const;
export const Currency = e(CURRENCIES).schema;
export type Currency = (typeof CURRENCIES)[number];

export const LOCALES = ["en", "sv", "pl", "de"] as const;
export const Locale = e(LOCALES).schema;
export type Locale = (typeof LOCALES)[number];

export const MILESTONE_KEYS = [
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
] as const;
export const MilestoneKey = e(MILESTONE_KEYS).schema;
export type MilestoneKey = (typeof MILESTONE_KEYS)[number];

export const STAGE_HEALTH = ["normal", "needs_attention", "blocked", "complete"] as const;
export const StageHealth = e(STAGE_HEALTH).schema;
export type StageHealth = (typeof STAGE_HEALTH)[number];

export const ACTOR_TYPES = ["user", "system", "provider", "service", "agent"] as const;
export const ActorType = e(ACTOR_TYPES).schema;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const WEBHOOK_EVENT_STATUSES = ["received", "processing", "processed", "failed", "ignored", "dead_letter"] as const;
export const WebhookEventStatus = e(WEBHOOK_EVENT_STATUSES).schema;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

export const MESSAGE_KINDS = ["user", "system"] as const;
export const MessageKind = e(MESSAGE_KINDS).schema;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const THREAD_KINDS = ["transaction_room", "direct", "system"] as const;
export const ThreadKind = e(THREAD_KINDS).schema;
export type ThreadKind = (typeof THREAD_KINDS)[number];

export const NOTIFICATION_CHANNELS = ["in_app", "email", "sms", "push"] as const;
export const NotificationChannel = e(NOTIFICATION_CHANNELS).schema;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const CALENDAR_EVENT_KINDS = [
  "inspection",
  "appraisal",
  "mortgage_deadline",
  "document_deadline",
  "closing",
  "notary",
  "recording",
  "other",
] as const;
export const CalendarEventKind = e(CALENDAR_EVENT_KINDS).schema;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];

export const INSTRUCTION_STATUSES = ["pending_verification", "verified", "locked", "superseded", "rejected"] as const;
export const InstructionStatus = e(INSTRUCTION_STATUSES).schema;
export type InstructionStatus = (typeof INSTRUCTION_STATUSES)[number];

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export const RiskLevel = e(RISK_LEVELS).schema;
export type RiskLevel = (typeof RISK_LEVELS)[number];
