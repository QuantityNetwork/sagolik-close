/**
 * Request / response contracts for `/api/v1`. Every mutation body is parsed
 * with one of these schemas on the server before it reaches a service.
 */
import { z } from "zod";
import {
  CalendarEventKind,
  Currency,
  DocumentCategory,
  AccessLevel,
  ParticipantRole,
  PaymentRail,
  PaymentType,
  SourceOfFundsType,
  TaskPriority,
  TransactionState,
  TransactionType,
} from "./enums";
import { DateOnly, Uuid } from "./entities";

export const ERROR_CODES = [
  "bad_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "invalid_transition",
  "step_up_required",
  "rate_limited",
  "idempotency_conflict",
  "provider_error",
  "internal",
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Consistent error envelope. `message` is always safe to show a person. */
export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    requestId: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const Money = z.object({
  amount: z.number().int().nonnegative(),
  currency: Currency,
});

export const PropertyInput = z.object({
  addressLine1: z.string().trim().min(3).max(200),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().length(2).toUpperCase(),
  propertyType: z.string().trim().min(2).max(60).default("single_family"),
});

export const CreateTransactionInput = z.object({
  organizationId: Uuid,
  type: TransactionType,
  jurisdiction: z.string().regex(/^[A-Z]{2}(-[A-Z]{2})?$/),
  currency: Currency,
  salePrice: z.number().int().positive(),
  expectedClosingDate: DateOnly.optional(),
  /** The creator's own role on this file. */
  creatorRole: ParticipantRole.default("transaction_coordinator"),
  property: PropertyInput,
});
export type CreateTransactionInput = z.infer<typeof CreateTransactionInput>;

export const UpdateTransactionInput = z
  .object({
    expectedClosingDate: DateOnly.nullable().optional(),
    salePrice: z.number().int().positive().optional(),
    coordinatorId: Uuid.nullable().optional(),
    expectedVersion: z.number().int(),
  })
  .strict();
export type UpdateTransactionInput = z.infer<typeof UpdateTransactionInput>;

export const TransitionInput = z.object({
  to: TransactionState,
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int(),
});
export type TransitionInput = z.infer<typeof TransitionInput>;

export const InviteParticipantInput = z.object({
  role: ParticipantRole,
  displayName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
});
export type InviteParticipantInput = z.infer<typeof InviteParticipantInput>;

export const UpdateTaskStatusInput = z.object({
  status: z.enum(["todo", "in_progress", "blocked", "waiting", "complete", "waived"]),
  note: z.string().trim().max(500).optional(),
});
export type UpdateTaskStatusInput = z.infer<typeof UpdateTaskStatusInput>;

export const CreateTaskInput = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional(),
  assigneeParticipantId: Uuid.optional(),
  priority: TaskPriority.default("normal"),
  dueDate: DateOnly.optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

export const RegisterDocumentInput = z.object({
  transactionId: Uuid,
  documentId: Uuid.optional(), // present → new version of an existing document
  name: z.string().trim().min(1).max(200),
  category: DocumentCategory,
  accessLevel: AccessLevel.default("all_participants"),
});
export type RegisterDocumentInput = z.infer<typeof RegisterDocumentInput>;

export const SignatureRequestInput = z.object({
  signerParticipantIds: z.array(Uuid).min(1).max(20),
  message: z.string().trim().max(1000).optional(),
});
export type SignatureRequestInput = z.infer<typeof SignatureRequestInput>;

export const CreateBankConnectionInput = z.object({
  transactionId: Uuid.optional(),
  institutionId: z.string().min(1).max(100),
  country: z.string().length(2),
});
export type CreateBankConnectionInput = z.infer<typeof CreateBankConnectionInput>;

export const CompleteBankConnectionInput = z.object({
  authorizationCode: z.string().min(1).max(500),
});

export const CreatePaymentInput = z.object({
  transactionId: Uuid,
  type: PaymentType,
  rail: PaymentRail,
  amount: z.number().int().positive(),
  currency: Currency,
  fromAccountId: Uuid,
  bankInstructionId: Uuid,
});
export type CreatePaymentInput = z.infer<typeof CreatePaymentInput>;

export const BankInstructionInput = z.object({
  purpose: z.enum(["closing_funds_to_escrow", "earnest_money_to_escrow", "seller_proceeds", "loan_payoff"]),
  beneficiaryName: z.string().trim().min(2).max(200),
  bankName: z.string().trim().min(2).max(200),
  accountNumber: z.string().trim().regex(/^[A-Z0-9 ]{4,34}$/i),
  routingIdentifier: z.string().trim().min(4).max(34),
  currency: Currency,
});
export type BankInstructionInput = z.infer<typeof BankInstructionInput>;

export const SourceOfFundsInput = z.object({
  sourceType: SourceOfFundsType,
  amount: z.number().int().positive(),
  currency: Currency,
  description: z.string().trim().max(1000).optional(),
  evidenceDocumentId: Uuid.optional(),
});
export type SourceOfFundsInput = z.infer<typeof SourceOfFundsInput>;

export const ComplianceDecisionInput = z.object({
  decision: z.enum(["approved", "rejected", "escalated"]),
  notes: z.string().trim().min(3).max(2000),
});
export type ComplianceDecisionInput = z.infer<typeof ComplianceDecisionInput>;

export const SendMessageInput = z.object({
  threadId: Uuid,
  body: z.string().trim().min(1).max(10_000),
  attachmentDocumentIds: z.array(Uuid).max(10).default([]),
});
export type SendMessageInput = z.infer<typeof SendMessageInput>;

export const CalendarEventInput = z.object({
  kind: CalendarEventKind,
  title: z.string().trim().min(2).max(160),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).optional(),
  location: z.string().trim().max(200).optional(),
});
export type CalendarEventInput = z.infer<typeof CalendarEventInput>;

export const RecordingConfirmationInput = z.object({
  recordingReference: z.string().trim().min(3).max(120),
  registry: z.string().trim().min(2).max(200),
  recordedAt: z.string().datetime({ offset: true }),
  attestation: z.literal(true, {
    message: "You must attest that the registry has confirmed the recording.",
  }),
});
export type RecordingConfirmationInput = z.infer<typeof RecordingConfirmationInput>;
