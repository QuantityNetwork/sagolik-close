/**
 * Keeps the TypeScript row schemas, enums and reference data in lock-step
 * with the SQL migrations. If this fails, update both sides together.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as T from "@sagolik/types";
import { TABLE_SCHEMAS } from "@sagolik/types";
import { describe, expect, it } from "vitest";
import { toSnake } from "./case";
import { generateReferenceSql } from "./reference-sql";

const MIGRATIONS = join(__dirname, "../../../supabase/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const sql = files.map((f) => readFileSync(join(MIGRATIONS, f), "utf8")).join("\n");

function sqlTables(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /create table (?:if not exists )?public\.(\w+) \(([\s\S]*?)\n\);/g;
  for (const m of sql.matchAll(re)) {
    const cols = m[2]!
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("--") && !/^(unique|check|primary key|foreign key|constraint)\b/i.test(l))
      .map((l) => l.split(/\s+/)[0]!.replace(/,$/, ""));
    out.set(m[1]!, cols);
  }
  for (const m of sql.matchAll(/alter table public\.(\w+) add column (\w+)/g)) out.get(m[1]!)?.push(m[2]!);
  return out;
}

function sqlEnum(name: string): string[] {
  const m = sql.match(new RegExp(`create type public\\.${name} as enum \\(([\\s\\S]*?)\\);`));
  if (!m) throw new Error(`enum ${name} not found`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

describe("schema parity", () => {
  const tables = sqlTables();

  for (const [table, schema] of Object.entries(TABLE_SCHEMAS)) {
    it(`${table}: columns match the row schema`, () => {
      const cols = tables.get(table);
      expect(cols, `table ${table} missing from migrations`).toBeDefined();
      const expected = Object.keys(schema.shape).map(toSnake).sort();
      expect([...cols!].sort()).toEqual(expected);
    });
  }

  it.each([
    ["transaction_state", T.TRANSACTION_STATES],
    ["transaction_type", T.TRANSACTION_TYPES],
    ["participant_role", T.PARTICIPANT_ROLES],
    ["organization_role", T.ORGANIZATION_ROLES],
    ["organization_type", T.ORGANIZATION_TYPES],
    ["participant_status", T.PARTICIPANT_STATUSES],
    ["task_status", T.TASK_STATUSES],
    ["task_priority", T.TASK_PRIORITIES],
    ["document_category", T.DOCUMENT_CATEGORIES],
    ["document_status", T.DOCUMENT_STATUSES],
    ["signature_status", T.SIGNATURE_STATUSES],
    ["access_level", T.ACCESS_LEVELS],
    ["bank_connection_status", T.BANK_CONNECTION_STATUSES],
    ["payment_status", T.PAYMENT_STATUSES],
    ["payment_type", T.PAYMENT_TYPES],
    ["payment_rail", T.PAYMENT_RAILS],
    ["escrow_status", T.ESCROW_STATUSES],
    ["mortgage_status", T.MORTGAGE_STATUSES],
    ["title_status", T.TITLE_STATUSES],
    ["identity_status", T.IDENTITY_STATUSES],
    ["compliance_category", T.COMPLIANCE_CATEGORIES],
    ["compliance_status", T.COMPLIANCE_STATUSES],
    ["recording_status", T.RECORDING_STATUSES],
    ["source_of_funds_type", T.SOURCE_OF_FUNDS_TYPES],
    ["currency_code", T.CURRENCIES],
    ["locale_code", T.LOCALES],
    ["milestone_key", T.MILESTONE_KEYS],
    ["actor_type", T.ACTOR_TYPES],
    ["webhook_event_status", T.WEBHOOK_EVENT_STATUSES],
    ["message_kind", T.MESSAGE_KINDS],
    ["thread_kind", T.THREAD_KINDS],
    ["notification_channel", T.NOTIFICATION_CHANNELS],
    ["calendar_event_kind", T.CALENDAR_EVENT_KINDS],
    ["instruction_status", T.INSTRUCTION_STATUSES],
    ["risk_level", T.RISK_LEVELS],
  ] as const)("enum %s matches", (name, values) => {
    expect(sqlEnum(name)).toEqual([...values]);
  });

  it("reference-data migration is up to date with the role matrix and state machine", () => {
    const committed = readFileSync(join(MIGRATIONS, "20260922000002_reference_data.sql"), "utf8");
    expect(committed).toBe(generateReferenceSql());
  });

  it("every public table has RLS enabled (by the blanket migration)", () => {
    expect(sql).toMatch(/alter table public\.%I enable row level security/);
    expect(sql).toMatch(/alter table public\.%I force row level security/);
  });

  it("secret tables have no client policies", () => {
    for (const t of ["bank_connection_secrets", "integration_credentials", "webhook_events", "domain_events", "idempotency_keys", "security_signals", "mfa_recovery_codes"]) {
      expect(sql).not.toMatch(new RegExp(`create policy [^;]* on public\\.${t}\\b`));
    }
  });
});
