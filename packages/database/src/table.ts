/**
 * Minimal, typed table gateway shared by the in-memory store (demo/local)
 * and the Supabase/PostgreSQL store. Domain services are written once
 * against this interface.
 */
import type { Row, TableName } from "@sagolik/types";

export type Where<T> = { [K in keyof T]?: T[K] | ReadonlyArray<T[K]> };

export interface FindOptions<T> {
  orderBy?: keyof T & string;
  ascending?: boolean;
  limit?: number;
}

export interface Table<T extends { id: string }> {
  get(id: string): Promise<T | null>;
  find(where?: Where<T>, opts?: FindOptions<T>): Promise<T[]>;
  findOne(where: Where<T>): Promise<T | null>;
  count(where?: Where<T>): Promise<number>;
  insert(row: T): Promise<T>;
  insertMany(rows: T[]): Promise<void>;
  /** Unconditional update by id. Throws NotFoundError if missing. */
  update(id: string, patch: Partial<T>): Promise<T>;
  /**
   * Compare-and-set: update only if the row currently matches `expected`.
   * Returns null when it doesn't (lost the race) — used for optimistic
   * concurrency on transactions and for exactly-once webhook processing.
   */
  updateIf(id: string, expected: Partial<T>, patch: Partial<T>): Promise<T | null>;
}

export type Db = { readonly [K in TableName]: Table<Row<K>> };

export class NotFoundError extends Error {
  readonly code = "not_found" as const;
  constructor(table: string, id: string) {
    super(`${table} ${id} not found`);
  }
}

export class UniqueViolationError extends Error {
  readonly code = "conflict" as const;
  constructor(
    readonly table: string,
    readonly constraint: string,
  ) {
    super(`Unique constraint ${constraint} violated on ${table}`);
  }
}

export class AppendOnlyViolationError extends Error {
  constructor(table: string) {
    super(`${table} is append-only`);
  }
}

/** Unique constraints mirrored from the SQL schema (for the in-memory store). */
export const UNIQUE_KEYS: Partial<Record<TableName, string[][]>> = {
  profiles: [["email"]],
  organizations: [["slug"]],
  organization_members: [["organizationId", "userId"]],
  organization_settings: [["organizationId"]],
  organization_branding: [["organizationId"]],
  transactions: [["reference"]],
  transaction_participants: [["transactionId", "email", "role"]],
  transaction_requirements: [["transactionId", "key"]],
  transaction_milestones: [["transactionId", "key"]],
  task_dependencies: [["taskId", "dependsOnTaskId"]],
  document_versions: [["documentId", "version"]],
  bank_connection_secrets: [["connectionId"]],
  bank_accounts: [["connectionId", "externalAccountId"]],
  bank_instructions: [["transactionId", "purpose", "version"]],
  payments: [["idempotencyKey"]],
  escrow_accounts: [["transactionId"]],
  mortgages: [["transactionId"]],
  title_cases: [["transactionId"]],
  recordings: [["transactionId"]],
  ownership_records: [["transactionId"]],
  property_passports: [["propertyId"], ["ownershipRecordId"]],
  vendors: [["organizationId", "name"]],
  autopilot_decisions: [["dedupeKey"]],
  funding_rules: [["passportId"]],
  message_reads: [["messageId", "userId"]],
  notification_preferences: [["userId", "kind"]],
  webhook_events: [["provider", "externalEventId"]],
  domain_events: [["idempotencyKey"]],
  feature_flags: [["key"]],
  plans: [["key"]],
  idempotency_keys: [["key", "userId", "route"]],
  mfa_recovery_codes: [["userId", "codeHash"]],
};
