/**
 * Row schemas. One schema per PostgreSQL table, camelCase in TypeScript,
 * snake_case in SQL. `TABLE_SCHEMAS` at the bottom is the registry used by the
 * data layer and by the schema-parity test.
 *
 * Money is always stored as integer minor units (cents / öre / grosz) plus an
 * ISO currency code. Never floats.
 */
import { z } from "zod";
import {
  AccessLevel,
  ActorType,
  BankConnectionStatus,
  CalendarEventKind,
  ComplianceCategory,
  ComplianceStatus,
  Currency,
  DocumentCategory,
  DocumentStatus,
  EscrowStatus,
  IdentityStatus,
  InstructionStatus,
  Locale,
  MessageKind,
  MilestoneKey,
  MortgageStatus,
  NotificationChannel,
  OrganizationRole,
  OrganizationType,
  ParticipantRole,
  ParticipantStatus,
  PaymentRail,
  PaymentStatus,
  PaymentType,
  RecordingStatus,
  RiskLevel,
  SignatureStatus,
  SourceOfFundsType,
  TaskPriority,
  TaskStatus,
  ThreadKind,
  TitleStatus,
  TransactionState,
  TransactionType,
  WebhookEventStatus,
} from "./enums";

export const Uuid = z.string().uuid();
export const Timestamp = z.string(); // ISO-8601, validated at the edges
export const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const MinorUnits = z.number().int();
export const Json = z.record(z.string(), z.unknown());

const base = { id: Uuid, createdAt: Timestamp, updatedAt: Timestamp };
const nullable = <T extends z.ZodTypeAny>(s: T) => s.nullable();

// ---------------------------------------------------------------- identity & orgs

export const Profile = z.object({
  ...base,
  email: z.string().email(),
  fullName: z.string(),
  phone: nullable(z.string()),
  locale: Locale,
  avatarUrl: nullable(z.string()),
  isPlatformAdmin: z.boolean(),
});
export type Profile = z.infer<typeof Profile>;

export const Organization = z.object({
  ...base,
  name: z.string(),
  slug: z.string(),
  type: OrganizationType,
  jurisdiction: z.string(),
});
export type Organization = z.infer<typeof Organization>;

export const OrganizationMember = z.object({
  ...base,
  organizationId: Uuid,
  userId: Uuid,
  role: OrganizationRole,
});
export type OrganizationMember = z.infer<typeof OrganizationMember>;

export const OrganizationSettings = z.object({
  ...base,
  organizationId: Uuid,
  defaultJurisdiction: z.string(),
  defaultCurrency: Currency,
  requireDualApproval: z.boolean(),
  coolingOffHours: z.number().int().min(0),
});
export type OrganizationSettings = z.infer<typeof OrganizationSettings>;

export const OrganizationBranding = z.object({
  ...base,
  organizationId: Uuid,
  logoPath: nullable(z.string()),
  primaryColor: nullable(z.string()),
});
export type OrganizationBranding = z.infer<typeof OrganizationBranding>;

// ---------------------------------------------------------------- property & transaction

export const Property = z.object({
  ...base,
  organizationId: nullable(Uuid),
  addressLine1: z.string(),
  addressLine2: nullable(z.string()),
  city: z.string(),
  region: nullable(z.string()),
  postalCode: nullable(z.string()),
  country: z.string().length(2),
  latitude: nullable(z.number()),
  longitude: nullable(z.number()),
  parcelId: nullable(z.string()),
  propertyType: z.string(),
  yearBuilt: nullable(z.number().int()),
  livingArea: nullable(z.number()),
  areaUnit: z.enum(["sqft", "sqm"]),
  bedrooms: nullable(z.number().int()),
  bathrooms: nullable(z.number()),
  lotSize: nullable(z.number()),
  imageUrls: z.array(z.string()),
  propertyTaxAnnual: nullable(MinorUnits),
  hoaMonthly: nullable(MinorUnits),
  energyRating: nullable(z.string()),
  legalDescription: nullable(z.string()),
  currency: Currency,
});
export type Property = z.infer<typeof Property>;

export const Transaction = z.object({
  ...base,
  organizationId: Uuid,
  propertyId: Uuid,
  reference: z.string(),
  type: TransactionType,
  state: TransactionState,
  jurisdiction: z.string(),
  currency: Currency,
  salePrice: MinorUnits,
  expectedClosingDate: nullable(DateOnly),
  coordinatorId: nullable(Uuid),
  createdBy: Uuid,
  stateChangedAt: Timestamp,
  closedAt: nullable(Timestamp),
  version: z.number().int(),
});
export type Transaction = z.infer<typeof Transaction>;

export const TransactionParticipant = z.object({
  ...base,
  transactionId: Uuid,
  userId: nullable(Uuid),
  organizationId: nullable(Uuid),
  role: ParticipantRole,
  displayName: z.string(),
  email: z.string().email(),
  status: ParticipantStatus,
  invitedBy: nullable(Uuid),
  joinedAt: nullable(Timestamp),
});
export type TransactionParticipant = z.infer<typeof TransactionParticipant>;

export const TransactionEvent = z.object({
  id: Uuid,
  transactionId: Uuid,
  eventType: z.string(),
  fromState: nullable(TransactionState),
  toState: nullable(TransactionState),
  actorId: nullable(Uuid),
  actorType: ActorType,
  reason: nullable(z.string()),
  source: z.string(),
  relatedEntityType: nullable(z.string()),
  relatedEntityId: nullable(Uuid),
  ipAddress: nullable(z.string()),
  correlationId: z.string(),
  payload: Json,
  occurredAt: Timestamp,
});
export type TransactionEvent = z.infer<typeof TransactionEvent>;

export const TransactionRequirement = z.object({
  ...base,
  transactionId: Uuid,
  key: z.string(),
  label: z.string(),
  satisfied: z.boolean(),
  satisfiedAt: nullable(Timestamp),
  evidenceEntityType: nullable(z.string()),
  evidenceEntityId: nullable(Uuid),
});
export type TransactionRequirement = z.infer<typeof TransactionRequirement>;

export const TransactionMilestone = z.object({
  ...base,
  transactionId: Uuid,
  key: MilestoneKey,
  ownerRole: nullable(ParticipantRole),
  dueDate: nullable(DateOnly),
  completedAt: nullable(Timestamp),
});
export type TransactionMilestone = z.infer<typeof TransactionMilestone>;

// ---------------------------------------------------------------- tasks

export const TASK_ACTION_KINDS = [
  "generic",
  "verify_identity",
  "connect_bank",
  "upload_document",
  "review_document",
  "sign_document",
  "approve_statement",
  "transfer_funds",
  "declare_source_of_funds",
  "book_inspection",
] as const;
export const TaskActionKind = z.enum(TASK_ACTION_KINDS);
export type TaskActionKind = z.infer<typeof TaskActionKind>;

export const Task = z.object({
  ...base,
  transactionId: Uuid,
  milestoneKey: nullable(MilestoneKey),
  title: z.string(),
  description: nullable(z.string()),
  assigneeParticipantId: nullable(Uuid),
  status: TaskStatus,
  priority: TaskPriority,
  dueDate: nullable(DateOnly),
  requiredEvidence: nullable(z.string()),
  actionKind: TaskActionKind,
  relatedEntityType: nullable(z.string()),
  relatedEntityId: nullable(Uuid),
  estimatedMinutes: nullable(z.number().int()),
  completedAt: nullable(Timestamp),
  completedBy: nullable(Uuid),
  createdBy: nullable(Uuid),
});
export type Task = z.infer<typeof Task>;

export const TaskDependency = z.object({
  id: Uuid,
  taskId: Uuid,
  dependsOnTaskId: Uuid,
  createdAt: Timestamp,
});
export type TaskDependency = z.infer<typeof TaskDependency>;

// ---------------------------------------------------------------- documents

export const Document = z.object({
  ...base,
  transactionId: Uuid,
  name: z.string(),
  category: DocumentCategory,
  currentVersion: z.number().int(),
  status: DocumentStatus,
  signatureStatus: SignatureStatus,
  accessLevel: AccessLevel,
  retentionPolicy: z.string(),
  uploadedBy: nullable(Uuid),
  expiresAt: nullable(Timestamp),
});
export type Document = z.infer<typeof Document>;

export const ExtractedField = z.object({
  key: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1),
  verified: z.boolean(),
});
export type ExtractedField = z.infer<typeof ExtractedField>;

export const DocumentVersion = z.object({
  id: Uuid,
  documentId: Uuid,
  transactionId: Uuid,
  version: z.number().int(),
  storagePath: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string().length(64),
  uploadedBy: nullable(Uuid),
  scanStatus: z.enum(["pending", "clean", "infected"]),
  extractedFields: z.array(ExtractedField),
  isSigned: z.boolean(),
  createdAt: Timestamp,
});
export type DocumentVersion = z.infer<typeof DocumentVersion>;

export const SignatureRecipient = z.object({
  participantId: Uuid,
  name: z.string(),
  email: z.string().email(),
  status: SignatureStatus,
  signedAt: nullable(Timestamp),
});
export type SignatureRecipient = z.infer<typeof SignatureRecipient>;

export const DocumentSignature = z.object({
  ...base,
  documentId: Uuid,
  transactionId: Uuid,
  documentVersion: z.number().int(),
  provider: z.string(),
  externalEnvelopeId: z.string(),
  status: SignatureStatus,
  requestedBy: Uuid,
  recipients: z.array(SignatureRecipient),
  sentAt: nullable(Timestamp),
  completedAt: nullable(Timestamp),
  certificatePath: nullable(z.string()),
});
export type DocumentSignature = z.infer<typeof DocumentSignature>;

// ---------------------------------------------------------------- identity & compliance

export const IdentityChecks = z.object({
  document: IdentityStatus,
  liveness: IdentityStatus,
  address: IdentityStatus,
  sanctions: IdentityStatus,
  pep: IdentityStatus,
});
export type IdentityChecks = z.infer<typeof IdentityChecks>;

export const IdentityVerification = z.object({
  ...base,
  transactionId: nullable(Uuid),
  participantId: nullable(Uuid),
  userId: nullable(Uuid),
  provider: z.string(),
  externalId: z.string(),
  status: IdentityStatus,
  checks: IdentityChecks,
  verifiedAt: nullable(Timestamp),
  expiresAt: nullable(Timestamp),
  failureReason: nullable(z.string()),
});
export type IdentityVerification = z.infer<typeof IdentityVerification>;

export const ComplianceCase = z.object({
  ...base,
  transactionId: nullable(Uuid),
  organizationId: nullable(Uuid),
  participantId: nullable(Uuid),
  category: ComplianceCategory,
  reason: z.string(),
  provider: nullable(z.string()),
  status: ComplianceStatus,
  riskFlags: z.array(z.string()),
  reviewerId: nullable(Uuid),
  notes: nullable(z.string()),
  decision: nullable(z.string()),
  decidedAt: nullable(Timestamp),
});
export type ComplianceCase = z.infer<typeof ComplianceCase>;

export const SourceOfFundsDeclaration = z.object({
  ...base,
  transactionId: Uuid,
  participantId: Uuid,
  sourceType: SourceOfFundsType,
  amount: MinorUnits,
  currency: Currency,
  description: nullable(z.string()),
  evidenceDocumentId: nullable(Uuid),
  status: ComplianceStatus,
  complianceCaseId: nullable(Uuid),
});
export type SourceOfFundsDeclaration = z.infer<typeof SourceOfFundsDeclaration>;

// ---------------------------------------------------------------- banking

export const BankConnection = z.object({
  ...base,
  userId: Uuid,
  transactionId: nullable(Uuid),
  provider: z.string(),
  institutionId: z.string(),
  institutionName: z.string(),
  externalConnectionId: nullable(z.string()),
  status: BankConnectionStatus,
  consentCreatedAt: nullable(Timestamp),
  consentExpiresAt: nullable(Timestamp),
  lastSyncedAt: nullable(Timestamp),
  lastError: nullable(z.string()),
});
export type BankConnection = z.infer<typeof BankConnection>;

/** Server-only secret material for a bank connection. Never selected into browser code. */
export const BankConnectionSecret = z.object({
  id: Uuid,
  connectionId: Uuid,
  encryptedAccessToken: z.string(),
  keyVersion: z.number().int(),
  createdAt: Timestamp,
});
export type BankConnectionSecret = z.infer<typeof BankConnectionSecret>;

export const BankAccount = z.object({
  ...base,
  connectionId: Uuid,
  userId: Uuid,
  externalAccountId: z.string(),
  name: z.string(),
  mask: z.string().max(4),
  currency: Currency,
  availableBalance: nullable(MinorUnits),
  currentBalance: nullable(MinorUnits),
  balanceAsOf: nullable(Timestamp),
  ownerNames: z.array(z.string()),
  ownershipVerified: z.boolean(),
  ownershipVerifiedAt: nullable(Timestamp),
});
export type BankAccount = z.infer<typeof BankAccount>;

export const BankInstruction = z.object({
  id: Uuid,
  transactionId: Uuid,
  purpose: z.enum(["closing_funds_to_escrow", "earnest_money_to_escrow", "seller_proceeds", "loan_payoff"]),
  beneficiaryName: z.string(),
  bankName: z.string(),
  accountMask: z.string().max(4),
  routingIdentifier: z.string(),
  encryptedAccountNumber: z.string(),
  currency: Currency,
  status: InstructionStatus,
  version: z.number().int(),
  previousVersionId: nullable(Uuid),
  verifiedBy: nullable(Uuid),
  verifiedAt: nullable(Timestamp),
  verificationMethod: nullable(z.string()),
  effectiveAfter: nullable(Timestamp),
  createdBy: Uuid,
  createdAt: Timestamp,
});
export type BankInstruction = z.infer<typeof BankInstruction>;

// ---------------------------------------------------------------- payments & escrow

export const Payment = z.object({
  ...base,
  transactionId: Uuid,
  type: PaymentType,
  rail: PaymentRail,
  status: PaymentStatus,
  amount: MinorUnits,
  currency: Currency,
  fromAccountId: nullable(Uuid),
  bankInstructionId: nullable(Uuid),
  provider: z.string(),
  externalPaymentId: nullable(z.string()),
  idempotencyKey: z.string(),
  initiatedBy: Uuid,
  approvedBy: nullable(Uuid),
  requiresDualApproval: z.boolean(),
  settledAt: nullable(Timestamp),
  failureReason: nullable(z.string()),
});
export type Payment = z.infer<typeof Payment>;

export const PaymentEvent = z.object({
  id: Uuid,
  paymentId: Uuid,
  transactionId: Uuid,
  status: PaymentStatus,
  source: z.enum(["provider_webhook", "user", "system"]),
  webhookEventId: nullable(Uuid),
  occurredAt: Timestamp,
});
export type PaymentEvent = z.infer<typeof PaymentEvent>;

export const EscrowAccount = z.object({
  ...base,
  transactionId: Uuid,
  provider: z.string(),
  providerName: z.string(),
  externalReference: z.string(),
  status: EscrowStatus,
  requiredAmount: MinorUnits,
  receivedAmount: MinorUnits,
  currency: Currency,
  expectedReleaseDate: nullable(DateOnly),
});
export type EscrowAccount = z.infer<typeof EscrowAccount>;

export const EscrowTransaction = z.object({
  id: Uuid,
  escrowAccountId: Uuid,
  transactionId: Uuid,
  direction: z.enum(["deposit", "disbursement"]),
  amount: MinorUnits,
  currency: Currency,
  status: PaymentStatus,
  paymentId: nullable(Uuid),
  description: z.string(),
  externalReference: nullable(z.string()),
  occurredAt: Timestamp,
  createdAt: Timestamp,
});
export type EscrowTransaction = z.infer<typeof EscrowTransaction>;

export const EscrowCondition = z.object({
  ...base,
  escrowAccountId: Uuid,
  transactionId: Uuid,
  description: z.string(),
  satisfied: z.boolean(),
  satisfiedAt: nullable(Timestamp),
  satisfiedBy: nullable(Uuid),
});
export type EscrowCondition = z.infer<typeof EscrowCondition>;

export const Approval = z.object({
  ...base,
  transactionId: Uuid,
  subjectType: z.enum(["payment", "bank_instruction"]),
  subjectId: Uuid,
  requestedBy: Uuid,
  approvedBy: nullable(Uuid),
  status: z.enum(["pending", "approved", "rejected"]),
  decidedAt: nullable(Timestamp),
});
export type Approval = z.infer<typeof Approval>;

// ---------------------------------------------------------------- mortgage & title

export const Mortgage = z.object({
  ...base,
  transactionId: Uuid,
  lenderName: z.string(),
  loanOfficerParticipantId: nullable(Uuid),
  loanAmount: MinorUnits,
  currency: Currency,
  interestRateBps: nullable(z.number().int()),
  termMonths: nullable(z.number().int()),
  loanType: z.string(),
  ltvBps: nullable(z.number().int()),
  status: MortgageStatus,
  appraisalStatus: z.enum(["not_ordered", "ordered", "scheduled", "completed", "issue"]),
  underwritingStatus: z.enum(["not_started", "in_review", "conditions", "approved", "denied"]),
  clearToCloseAt: nullable(Timestamp),
  fundedAt: nullable(Timestamp),
  provider: z.string(),
  externalReference: nullable(z.string()),
});
export type Mortgage = z.infer<typeof Mortgage>;

export const MortgageCondition = z.object({
  ...base,
  mortgageId: Uuid,
  transactionId: Uuid,
  description: z.string(),
  satisfied: z.boolean(),
  satisfiedAt: nullable(Timestamp),
});
export type MortgageCondition = z.infer<typeof MortgageCondition>;

export const TitleCase = z.object({
  ...base,
  transactionId: Uuid,
  titleCompany: z.string(),
  status: TitleStatus,
  currentOwner: nullable(z.string()),
  searchCompletedAt: nullable(Timestamp),
  clearedAt: nullable(Timestamp),
  insurancePolicyNumber: nullable(z.string()),
  provider: z.string(),
  externalReference: nullable(z.string()),
});
export type TitleCase = z.infer<typeof TitleCase>;

export const TitleIssue = z.object({
  ...base,
  titleCaseId: Uuid,
  transactionId: Uuid,
  kind: z.enum(["lien", "mortgage", "judgment", "easement", "encumbrance", "tax", "other"]),
  description: z.string(),
  amount: nullable(MinorUnits),
  resolved: z.boolean(),
  resolvedAt: nullable(Timestamp),
});
export type TitleIssue = z.infer<typeof TitleIssue>;

// ---------------------------------------------------------------- recording & ownership

export const Recording = z.object({
  ...base,
  transactionId: Uuid,
  status: RecordingStatus,
  registry: z.string(),
  recordingReference: nullable(z.string()),
  submittedAt: nullable(Timestamp),
  submittedBy: nullable(Uuid),
  recordedAt: nullable(Timestamp),
  confirmationSource: nullable(z.enum(["registry_api", "authorized_professional"])),
  confirmedBy: nullable(Uuid),
  documentId: nullable(Uuid),
});
export type Recording = z.infer<typeof Recording>;

export const OwnershipRecord = z.object({
  ...base,
  transactionId: Uuid,
  propertyId: Uuid,
  ownerUserIds: z.array(Uuid),
  ownerNames: z.array(z.string()),
  purchaseDate: DateOnly,
  purchaseAmount: MinorUnits,
  currency: Currency,
  recordingId: Uuid,
});
export type OwnershipRecord = z.infer<typeof OwnershipRecord>;

export const OwnershipRecordItem = z.object({
  id: Uuid,
  ownershipRecordId: Uuid,
  kind: z.enum(["signed_document", "mortgage", "insurance", "warranty", "renovation", "receipt", "maintenance", "tax"]),
  title: z.string(),
  amount: nullable(MinorUnits),
  occurredOn: nullable(DateOnly),
  documentId: nullable(Uuid),
  createdBy: nullable(Uuid),
  createdAt: Timestamp,
});
export type OwnershipRecordItem = z.infer<typeof OwnershipRecordItem>;

// ---------------------------------------------------------------- messaging & notifications

export const MessageThread = z.object({
  ...base,
  transactionId: Uuid,
  kind: ThreadKind,
  title: z.string(),
  memberUserIds: z.array(Uuid),
});
export type MessageThread = z.infer<typeof MessageThread>;

export const Message = z.object({
  id: Uuid,
  threadId: Uuid,
  transactionId: Uuid,
  authorId: nullable(Uuid),
  kind: MessageKind,
  body: z.string().max(10_000),
  mentions: z.array(Uuid),
  attachmentDocumentIds: z.array(Uuid),
  relatedEntityType: nullable(z.string()),
  relatedEntityId: nullable(Uuid),
  createdAt: Timestamp,
});
export type Message = z.infer<typeof Message>;

export const MessageRead = z.object({
  id: Uuid,
  messageId: Uuid,
  userId: Uuid,
  readAt: Timestamp,
});
export type MessageRead = z.infer<typeof MessageRead>;

export const Notification = z.object({
  id: Uuid,
  userId: Uuid,
  transactionId: nullable(Uuid),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  linkPath: nullable(z.string()),
  channel: NotificationChannel,
  readAt: nullable(Timestamp),
  sentAt: nullable(Timestamp),
  createdAt: Timestamp,
});
export type Notification = z.infer<typeof Notification>;

export const NotificationPreference = z.object({
  ...base,
  userId: Uuid,
  kind: z.string(),
  inApp: z.boolean(),
  email: z.boolean(),
  sms: z.boolean(),
});
export type NotificationPreference = z.infer<typeof NotificationPreference>;

export const CalendarEvent = z.object({
  ...base,
  transactionId: Uuid,
  kind: CalendarEventKind,
  title: z.string(),
  startsAt: Timestamp,
  endsAt: nullable(Timestamp),
  location: nullable(z.string()),
  createdBy: nullable(Uuid),
});
export type CalendarEvent = z.infer<typeof CalendarEvent>;

// ---------------------------------------------------------------- platform

export const Integration = z.object({
  ...base,
  organizationId: nullable(Uuid),
  category: z.enum(["banking", "identity", "signature", "payment", "escrow", "property", "mortgage", "title", "insurance", "notification"]),
  provider: z.string(),
  mode: z.enum(["mock", "sandbox", "production"]),
  enabled: z.boolean(),
  status: z.enum(["healthy", "degraded", "down", "unknown"]),
  lastHealthAt: nullable(Timestamp),
  lastError: nullable(z.string()),
});
export type Integration = z.infer<typeof Integration>;

export const WebhookEvent = z.object({
  id: Uuid,
  provider: z.string(),
  externalEventId: z.string(),
  eventType: z.string(),
  payloadHash: z.string().length(64),
  payload: Json,
  status: WebhookEventStatus,
  attempts: z.number().int(),
  error: nullable(z.string()),
  receivedAt: Timestamp,
  processedAt: nullable(Timestamp),
});
export type WebhookEvent = z.infer<typeof WebhookEvent>;

export const DomainEventRow = z.object({
  id: Uuid,
  eventType: z.string(),
  aggregateType: z.string(),
  aggregateId: Uuid,
  transactionId: nullable(Uuid),
  payload: Json,
  correlationId: z.string(),
  idempotencyKey: z.string(),
  status: z.enum(["pending", "processing", "processed", "failed", "dead_letter"]),
  attempts: z.number().int(),
  availableAt: Timestamp,
  lastError: nullable(z.string()),
  createdAt: Timestamp,
  processedAt: nullable(Timestamp),
});
export type DomainEventRow = z.infer<typeof DomainEventRow>;

export const AuditEvent = z.object({
  id: Uuid,
  organizationId: nullable(Uuid),
  transactionId: nullable(Uuid),
  actorId: nullable(Uuid),
  actorType: ActorType,
  action: z.string(),
  resourceType: z.string(),
  resourceId: nullable(z.string()),
  occurredAt: Timestamp,
  ipAddress: nullable(z.string()),
  userAgent: nullable(z.string()),
  metadata: Json,
  correlationId: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const SecuritySignal = z.object({
  id: Uuid,
  userId: nullable(Uuid),
  transactionId: nullable(Uuid),
  kind: z.string(),
  riskLevel: RiskLevel,
  controls: z.array(z.string()),
  details: Json,
  resolved: z.boolean(),
  createdAt: Timestamp,
});
export type SecuritySignal = z.infer<typeof SecuritySignal>;

export const FeatureFlag = z.object({
  ...base,
  key: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  rolloutPercent: z.number().int().min(0).max(100),
  organizationIds: z.array(Uuid),
});
export type FeatureFlag = z.infer<typeof FeatureFlag>;

export const Plan = z.object({
  ...base,
  key: z.string(),
  name: z.string(),
  audience: z.enum(["consumer", "professional", "team", "enterprise"]),
  priceMonthly: nullable(MinorUnits),
  currency: Currency,
  features: z.array(z.string()),
  active: z.boolean(),
  sortOrder: z.number().int(),
});
export type Plan = z.infer<typeof Plan>;

export const BillingAccount = z.object({
  ...base,
  organizationId: nullable(Uuid),
  userId: nullable(Uuid),
  stripeCustomerId: nullable(z.string()),
});
export type BillingAccount = z.infer<typeof BillingAccount>;

export const Subscription = z.object({
  ...base,
  billingAccountId: Uuid,
  planId: Uuid,
  status: z.enum(["trialing", "active", "past_due", "canceled", "incomplete"]),
  stripeSubscriptionId: nullable(z.string()),
  currentPeriodEnd: nullable(Timestamp),
  trialEndsAt: nullable(Timestamp),
});
export type Subscription = z.infer<typeof Subscription>;

/** Single-use MFA recovery codes (hashes only). Service-role access only. */
export const MfaRecoveryCode = z.object({
  id: Uuid,
  userId: Uuid,
  codeHash: z.string().length(64),
  usedAt: nullable(Timestamp),
  createdAt: Timestamp,
});
export type MfaRecoveryCode = z.infer<typeof MfaRecoveryCode>;

export const ConsentRecord = z.object({
  id: Uuid,
  userId: Uuid,
  purpose: z.string(),
  granted: z.boolean(),
  policyVersion: z.string(),
  createdAt: Timestamp,
});
export type ConsentRecord = z.infer<typeof ConsentRecord>;

export const IdempotencyKey = z.object({
  id: Uuid,
  key: z.string(),
  userId: nullable(Uuid),
  route: z.string(),
  requestHash: z.string(),
  responseStatus: z.number().int(),
  responseBody: Json,
  createdAt: Timestamp,
});
export type IdempotencyKey = z.infer<typeof IdempotencyKey>;

/**
 * Registry: SQL table name → row schema. The data layer is generic over this
 * map and the parity test compares each schema's keys with the migration.
 */
export const TABLE_SCHEMAS = {
  profiles: Profile,
  organizations: Organization,
  organization_members: OrganizationMember,
  organization_settings: OrganizationSettings,
  organization_branding: OrganizationBranding,
  properties: Property,
  transactions: Transaction,
  transaction_participants: TransactionParticipant,
  transaction_events: TransactionEvent,
  transaction_requirements: TransactionRequirement,
  transaction_milestones: TransactionMilestone,
  tasks: Task,
  task_dependencies: TaskDependency,
  documents: Document,
  document_versions: DocumentVersion,
  document_signatures: DocumentSignature,
  identity_verifications: IdentityVerification,
  compliance_cases: ComplianceCase,
  source_of_funds_declarations: SourceOfFundsDeclaration,
  bank_connections: BankConnection,
  bank_connection_secrets: BankConnectionSecret,
  bank_accounts: BankAccount,
  bank_instructions: BankInstruction,
  payments: Payment,
  payment_events: PaymentEvent,
  escrow_accounts: EscrowAccount,
  escrow_transactions: EscrowTransaction,
  escrow_conditions: EscrowCondition,
  approvals: Approval,
  mortgages: Mortgage,
  mortgage_conditions: MortgageCondition,
  title_cases: TitleCase,
  title_issues: TitleIssue,
  recordings: Recording,
  ownership_records: OwnershipRecord,
  ownership_record_items: OwnershipRecordItem,
  message_threads: MessageThread,
  messages: Message,
  message_reads: MessageRead,
  notifications: Notification,
  notification_preferences: NotificationPreference,
  calendar_events: CalendarEvent,
  integrations: Integration,
  webhook_events: WebhookEvent,
  domain_events: DomainEventRow,
  audit_events: AuditEvent,
  security_signals: SecuritySignal,
  feature_flags: FeatureFlag,
  plans: Plan,
  billing_accounts: BillingAccount,
  subscriptions: Subscription,
  consent_records: ConsentRecord,
  idempotency_keys: IdempotencyKey,
  mfa_recovery_codes: MfaRecoveryCode,
} as const;

export type TableName = keyof typeof TABLE_SCHEMAS;
export type Row<T extends TableName> = z.infer<(typeof TABLE_SCHEMAS)[T]>;

/** Tables that may only ever be inserted into. Enforced by DB triggers too. */
export const APPEND_ONLY_TABLES = [
  "audit_events",
  "transaction_events",
  "document_versions",
  "payment_events",
  "consent_records",
] as const satisfies readonly TableName[];

/**
 * Tables whose rows are immutable except for a narrow, trigger-enforced
 * verification transition (e.g. a bank instruction moving from
 * pending_verification → verified). Content changes always create a new row.
 */
export const VERSIONED_TABLES = ["bank_instructions"] as const satisfies readonly TableName[];
