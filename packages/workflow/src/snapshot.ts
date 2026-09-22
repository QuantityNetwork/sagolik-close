import type {
  BankInstruction,
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
  property: Property;
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
