import type { AccessLevel, OrganizationRole, ParticipantRole, Permission } from "@sagolik/types";

const PRINCIPAL: readonly Permission[] = [
  "transaction.view",
  "document.upload",
  "document.view",
  "signature.sign",
  "task.complete_own",
  "financial.view",
  "message.send",
];

const AGENT: readonly Permission[] = [
  "transaction.view",
  "transaction.edit",
  "participant.invite",
  "document.upload",
  "document.view",
  "document.approve",
  "signature.request",
  "task.manage",
  "task.complete_own",
  "message.send",
];

const LENDER: readonly Permission[] = [
  "transaction.view",
  "document.upload",
  "document.view",
  "signature.request",
  "mortgage.update",
  "milestone.approve",
  "financial.view",
  "task.complete_own",
  "message.send",
];

/**
 * Transaction-scoped role → permission matrix.
 *
 * This is the single source of truth. `supabase/migrations/0002_role_permissions.sql`
 * is generated from it (`pnpm --filter @sagolik/auth gen:sql`) and the
 * parity test fails if the two drift.
 */
export const ROLE_PERMISSIONS: Record<ParticipantRole, readonly Permission[]> = {
  buyer: [...PRINCIPAL, "payment.initiate"],
  co_buyer: [...PRINCIPAL, "payment.initiate"],
  seller: PRINCIPAL,
  co_seller: PRINCIPAL,
  agent: AGENT,
  buyer_agent: AGENT,
  seller_agent: AGENT,
  broker: [...AGENT, "audit.view"],
  loan_officer: LENDER,
  mortgage_processor: LENDER.filter((p) => p !== "milestone.approve"),
  title_officer: [
    "transaction.view",
    "transaction.transition",
    "transaction.close",
    "document.upload",
    "document.view",
    "document.view_restricted",
    "document.approve",
    "signature.request",
    "milestone.approve",
    "task.manage",
    "task.complete_own",
    "financial.view",
    "title.update",
    "recording.submit",
    "recording.confirm",
    "beneficiary.verify",
    "identity.view_result",
    "message.send",
    "audit.view",
  ],
  escrow_officer: [
    "transaction.view",
    "transaction.transition",
    "transaction.close",
    "document.upload",
    "document.view",
    "document.view_restricted",
    "document.approve",
    "signature.request",
    "milestone.approve",
    "task.manage",
    "task.complete_own",
    "financial.view",
    "escrow.manage",
    "payment.approve",
    "beneficiary.modify",
    "beneficiary.verify",
    "identity.view_result",
    "compliance.review",
    "message.send",
    "audit.view",
  ],
  attorney: [
    "transaction.view",
    "transaction.transition",
    "transaction.close",
    "document.upload",
    "document.view",
    "document.view_restricted",
    "document.approve",
    "signature.request",
    "milestone.approve",
    "task.complete_own",
    "financial.view",
    "recording.submit",
    "recording.confirm",
    "identity.view_result",
    "compliance.review",
    "message.send",
    "audit.view",
  ],
  notary: ["transaction.view", "document.view", "task.complete_own", "message.send"],
  insurance_agent: ["transaction.view", "document.upload", "document.view", "task.complete_own", "message.send"],
  transaction_coordinator: [
    "transaction.view",
    "transaction.edit",
    "transaction.transition",
    "participant.invite",
    "participant.remove",
    "document.upload",
    "document.view",
    "document.approve",
    "signature.request",
    "milestone.approve",
    "task.manage",
    "task.complete_own",
    "financial.view",
    "message.send",
    "audit.view",
  ],
  auditor: [
    "transaction.view",
    "document.view",
    "document.view_restricted",
    "financial.view",
    "identity.view_result",
    "audit.view",
    "audit.export",
  ],
  // Due-diligence accountant (e.g. quality of earnings): documents and messages, no money access.
  accountant: ["transaction.view", "document.upload", "document.view", "task.complete_own", "message.send"],
};

/** Organization-scoped grants over every transaction owned by that organization. */
export const ORGANIZATION_ROLE_PERMISSIONS: Record<OrganizationRole, readonly Permission[]> = {
  organization_admin: [
    "transaction.view",
    "transaction.edit",
    "transaction.transition",
    "participant.invite",
    "participant.remove",
    "document.view",
    "task.manage",
    "compliance.review",
    "audit.view",
    "audit.export",
  ],
  member: [],
  auditor: ["transaction.view", "document.view", "document.view_restricted", "financial.view", "audit.view", "audit.export"],
};

export const PRINCIPAL_ROLES: readonly ParticipantRole[] = ["buyer", "co_buyer", "seller", "co_seller"];
const PERIPHERAL_ROLES: readonly ParticipantRole[] = ["notary", "insurance_agent"];

export function isPrincipal(role: ParticipantRole): boolean {
  return PRINCIPAL_ROLES.includes(role);
}

/** Which roles may see a document at a given access level (before uploader/restricted overrides). */
export function roleMeetsAccessLevel(role: ParticipantRole, level: AccessLevel): boolean {
  switch (level) {
    case "all_participants":
      return true;
    case "principals_and_professionals":
      return !PERIPHERAL_ROLES.includes(role);
    case "professionals_only":
      return !isPrincipal(role);
    case "restricted":
      return ROLE_PERMISSIONS[role].includes("document.view_restricted");
  }
}
