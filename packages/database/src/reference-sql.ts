/**
 * Generates `supabase/migrations/*_reference_data.sql` from the TypeScript
 * sources of truth (role matrix, state machine). The parity test fails if the
 * committed migration differs from this output.
 *
 *   pnpm gen:sql
 */
import { ORGANIZATION_ROLE_PERMISSIONS, ROLE_PERMISSIONS } from "@sagolik/auth";
import { ORGANIZATION_ROLES, PARTICIPANT_ROLES, TRANSACTION_STATES } from "@sagolik/types";
import { FORWARD_PATH, TERMINAL_STATES, TRANSITIONS } from "@sagolik/workflow";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

const STATE_LABELS: Record<string, string> = {
  draft: "Draft",
  invited: "Parties invited",
  identity_pending: "Verifying identities",
  documents_pending: "Collecting documents",
  financing_pending: "Financing",
  conditions_pending: "Clearing conditions",
  ready_for_signing: "Ready for signing",
  signing: "Signing",
  escrow_pending: "Funding escrow",
  funding_pending: "Lender funding",
  recording_pending: "Recording",
  ownership_transfer: "Ownership transferred",
  closed: "Closed",
  cancelled: "Cancelled",
  disputed: "Disputed",
};

const ORG_ROLE_DESCRIPTIONS: Record<string, string> = {
  organization_admin: "Manages the organization, its members and its transactions",
  member: "Works on transactions they are invited to",
  auditor: "Read-only access to the organization's transactions and audit trail",
};

export function generateReferenceSql(): string {
  const lines: string[] = [
    "-- =============================================================================",
    "-- GENERATED FILE — do not edit by hand.",
    "-- Source: packages/auth (role matrix) and packages/workflow (state machine).",
    "-- Regenerate with `pnpm gen:sql`; the schema-parity test enforces it.",
    "-- =============================================================================",
    "",
    "create table if not exists public.role_permissions (",
    "  role public.participant_role not null,",
    "  permission text not null,",
    "  primary key (role, permission)",
    ");",
    "",
    "create table if not exists public.organization_role_permissions (",
    "  role public.organization_role not null references public.organization_roles (key),",
    "  permission text not null,",
    "  primary key (role, permission)",
    ");",
    "",
    "insert into public.organization_roles (key, description) values",
    ORGANIZATION_ROLES.map((r) => `  (${q(r)}, ${q(ORG_ROLE_DESCRIPTIONS[r] ?? r)})`).join(",\n") + ";",
    "",
    "insert into public.role_permissions (role, permission) values",
    PARTICIPANT_ROLES.flatMap((r) => [...new Set(ROLE_PERMISSIONS[r])].sort().map((p) => `  (${q(r)}, ${q(p)})`)).join(",\n") + ";",
    "",
  ];
  const orgRows = ORGANIZATION_ROLES.flatMap((r) => [...new Set(ORGANIZATION_ROLE_PERMISSIONS[r])].sort().map((p) => `  (${q(r)}, ${q(p)})`));
  if (orgRows.length) {
    lines.push("insert into public.organization_role_permissions (role, permission) values", orgRows.join(",\n") + ";", "");
  }
  lines.push(
    "insert into public.transaction_states (key, label, sort_order, is_terminal) values",
    TRANSACTION_STATES.map((s) => {
      const idx = FORWARD_PATH.indexOf(s);
      const order = idx === -1 ? 100 + TRANSACTION_STATES.indexOf(s) : idx;
      return `  (${q(s)}, ${q(STATE_LABELS[s] ?? s)}, ${order}, ${TERMINAL_STATES.includes(s)})`;
    }).join(",\n") + ";",
    "",
    "insert into public.transaction_transitions (from_state, to_state, permission, automatic) values",
    TRANSITIONS.map((t) => `  (${q(t.from)}, ${q(t.to)}, ${q(t.permission)}, ${t.automatic})`).join(",\n") + ";",
    "",
  );
  return lines.join("\n");
}
