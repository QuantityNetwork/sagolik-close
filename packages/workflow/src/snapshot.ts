import type {
  BankInstruction,
  Company,
  ComplianceCase,
  Document,
  DocumentSignature,
  EscrowAccount,
  EscrowCondition,
  IdentityVerification,
  Mortgage,
  MortgageCondition,
  Payment,
  Property,
  Recording,
  SourceOfFundsDeclaration,
  Task,
  TaskDependency,
  TitleCase,
  TitleIssue,
  Transaction,
  TransactionMilestone,
  TransactionParticipant,
} from "@sagolik/types";

/**
 * Everything the workflow engine needs to reason about one transaction.
 * Pure data — the engine never performs I/O.
 */
export interface TransactionSnapshot {
  transaction: Transaction;
  /** Real estate: the property. Business acquisitions: the business premises. */
  property: Property;
  /** Business acquisitions: the company being bought. */
  company: Company | null;
  participants: TransactionParticipant[];
  milestones: TransactionMilestone[];
  tasks: Task[];
  taskDependencies: TaskDependency[];
  documents: Document[];
  signatures: DocumentSignature[];
  identityVerifications: IdentityVerification[];
  complianceCases: ComplianceCase[];
  sourceOfFunds: SourceOfFundsDeclaration[];
  payments: Payment[];
  bankInstructions: BankInstruction[];
  escrow: EscrowAccount | null;
  escrowConditions: EscrowCondition[];
  mortgage: Mortgage | null;
  mortgageConditions: MortgageCondition[];
  titleCase: TitleCase | null;
  titleIssues: TitleIssue[];
  recording: Recording | null;
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  llc: "LLC",
  c_corporation: "C corporation",
  s_corporation: "S corporation",
  partnership: "Partnership",
  sole_proprietorship: "Sole proprietorship",
};

export const DEAL_STRUCTURE_LABELS: Record<string, string> = {
  asset_purchase: "Asset purchase",
  stock_purchase: "Stock purchase",
  membership_interest_purchase: "Membership-interest purchase",
};

/** What the deal is about, for headings and lists: a property, or a company. */
export interface DealSubject {
  kind: "property" | "company";
  title: string;
  subtitle: string;
  imageUrl: string | null;
}

export function dealSubject(s: Pick<TransactionSnapshot, "property" | "company">): DealSubject {
  const place = [s.property.city, s.property.region].filter(Boolean).join(", ");
  if (s.company) {
    return {
      kind: "company",
      title: s.company.tradeName ?? s.company.legalName,
      subtitle: [ENTITY_TYPE_LABELS[s.company.entityType] ?? s.company.entityType, s.company.industry, place].filter(Boolean).join(" · "),
      imageUrl: s.property.imageUrls[0] ?? null,
    };
  }
  return {
    kind: "property",
    title: s.property.addressLine1,
    subtitle: [s.property.city, s.property.region, s.property.postalCode].filter(Boolean).join(", "),
    imageUrl: s.property.imageUrls[0] ?? null,
  };
}
