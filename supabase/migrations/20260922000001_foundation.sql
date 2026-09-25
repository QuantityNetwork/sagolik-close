-- =============================================================================
-- Sagolik Close — foundation schema
--
-- Conventions
--   * UUID primary keys, created_at / updated_at on mutable tables.
--   * Money = bigint minor units + currency. Never floating point.
--   * Column names are the snake_case of the TypeScript row schemas in
--     packages/types/src/entities.ts (enforced by the schema-parity test).
--   * Financial, audit and signed-document history is never deleted.
-- =============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------- enums
create type public.transaction_state as enum (
  'draft','invited','identity_pending','documents_pending','financing_pending','conditions_pending',
  'ready_for_signing','signing','escrow_pending','funding_pending','recording_pending',
  'ownership_transfer','closed','cancelled','disputed');
create type public.transaction_type as enum ('purchase','sale','refinance','ownership_transfer','business_acquisition');
create type public.participant_role as enum (
  'buyer','co_buyer','seller','co_seller','agent','buyer_agent','seller_agent','broker','loan_officer',
  'mortgage_processor','title_officer','escrow_officer','attorney','notary','insurance_agent',
  'transaction_coordinator','auditor','accountant');
create type public.organization_role as enum ('organization_admin','member','auditor');
create type public.organization_type as enum (
  'real_estate_agency','title_company','law_firm','mortgage_lender','escrow_provider','bank','developer',
  'property_company','brokerage','ma_advisory','accounting_firm');
create type public.participant_status as enum ('invited','active','declined','removed');
create type public.task_status as enum ('todo','in_progress','blocked','waiting','complete','waived');
create type public.task_priority as enum ('low','normal','high','urgent');
create type public.document_category as enum (
  'purchase_agreement','disclosure','identity','mortgage','title','inspection','appraisal','insurance','escrow',
  'tax','closing_statement','deed','power_of_attorney','notary','recording','other',
  'letter_of_intent','due_diligence_report','definitive_agreement','disclosure_schedules','lien_search',
  'transfer_instrument','funds_flow_memo','closing_certificate');
create type public.document_status as enum ('processing','pending_review','needs_attention','approved','rejected','superseded');
create type public.signature_status as enum ('not_required','draft','sent','viewed','signed','declined','expired','completed');
create type public.access_level as enum ('all_participants','principals_and_professionals','professionals_only','restricted');
create type public.bank_connection_status as enum (
  'not_connected','connecting','consent_required','connected','reauthentication_required','expired','revoked','error');
create type public.payment_status as enum (
  'created','authorization_required','authorized','initiated','processing','received','settled','failed','returned','cancelled');
create type public.payment_type as enum (
  'earnest_money','deposit','closing_funds','fee','tax','insurance','escrow_disbursement','refund');
create type public.payment_rail as enum ('ach','wire','fednow','rtp','sepa','sepa_instant','open_banking','card','manual');
create type public.escrow_status as enum ('not_opened','open','awaiting_deposit','funded','conditions_pending','releasing','disbursed','closed');
create type public.mortgage_status as enum (
  'not_started','application','document_collection','underwriting','conditional_approval','clear_to_close','funded');
create type public.title_status as enum ('not_started','searching','issues_found','curing','clear','insured');
create type public.identity_status as enum ('not_started','pending','processing','verified','failed','review_required','expired');
create type public.compliance_category as enum (
  'kyc','kyb','aml','sanctions','pep','source_of_funds','source_of_wealth','fraud','identity_mismatch');
create type public.compliance_status as enum ('pending','review_required','approved','rejected','escalated');
create type public.recording_status as enum ('not_ready','ready_for_recording','submitted_for_recording','recorded','rejected');
create type public.source_of_funds_type as enum (
  'salary_savings','property_sale','investment_liquidation','inheritance','business_distribution','mortgage_financing','gift');
create type public.currency_code as enum ('USD','EUR','SEK','PLN','GBP','CHF');
create type public.locale_code as enum ('en','sv','pl','de');
create type public.milestone_key as enum (
  'offer_accepted','transaction_opened','identity_verified','documents_received','financing_approved',
  'inspection_completed','title_cleared','signing_complete','funds_received','recording_submitted','ownership_transferred');
create type public.actor_type as enum ('user','system','provider','service','agent');
create type public.webhook_event_status as enum ('received','processing','processed','failed','ignored','dead_letter');
create type public.message_kind as enum ('user','system');
create type public.thread_kind as enum ('transaction_room','direct','system');
create type public.notification_channel as enum ('in_app','email','sms','push');
create type public.calendar_event_kind as enum (
  'inspection','appraisal','mortgage_deadline','document_deadline','closing','notary','recording','other');
create type public.instruction_status as enum ('pending_verification','verified','locked','superseded','rejected');
create type public.risk_level as enum ('low','medium','high','critical');

-- ----------------------------------------------------------------------------- helpers
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% on % is not allowed: table is append-only', tg_op, tg_table_name
    using errcode = 'insufficient_privilege';
end $$;

create or replace function public.reject_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'DELETE on % is not allowed: financial and legal history is retained', tg_table_name
    using errcode = 'insufficient_privilege';
end $$;

-- ----------------------------------------------------------------------------- identity & organizations
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null,
  phone text,
  locale public.locale_code not null default 'en',
  avatar_url text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  type public.organization_type not null,
  jurisdiction text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_roles (
  key public.organization_role primary key,
  description text not null
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.organization_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

create table public.organization_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  default_jurisdiction text not null,
  default_currency public.currency_code not null,
  require_dual_approval boolean not null default true,
  cooling_off_hours integer not null default 24 check (cooling_off_hours >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_branding (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  logo_path text,
  primary_color text check (primary_color is null or primary_color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------- property & transaction
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id),
  address_line1 text not null,
  address_line2 text,
  city text not null,
  region text,
  postal_code text,
  country char(2) not null,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  parcel_id text,
  property_type text not null,
  year_built integer,
  living_area double precision,
  area_unit text not null default 'sqft' check (area_unit in ('sqft','sqm')),
  bedrooms integer,
  bathrooms double precision,
  lot_size double precision,
  image_urls text[] not null default '{}',
  property_tax_annual bigint,
  hoa_monthly bigint,
  energy_rating text,
  legal_description text,
  currency public.currency_code not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transaction_states (
  key public.transaction_state primary key,
  label text not null,
  sort_order integer not null,
  is_terminal boolean not null default false
);

create table public.transaction_transitions (
  from_state public.transaction_state not null references public.transaction_states (key),
  to_state public.transaction_state not null references public.transaction_states (key),
  permission text not null,
  automatic boolean not null default false,
  primary key (from_state, to_state)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  property_id uuid not null references public.properties (id),
  reference text not null unique,
  type public.transaction_type not null,
  state public.transaction_state not null default 'draft',
  jurisdiction text not null check (jurisdiction ~ '^[A-Z]{2}(-[A-Z]{2,12})?$'),
  currency public.currency_code not null,
  sale_price bigint not null check (sale_price > 0),
  expected_closing_date date,
  coordinator_id uuid references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  state_changed_at timestamptz not null default now(),
  closed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_org_state_idx on public.transactions (organization_id, state);
create index transactions_closing_idx on public.transactions (expected_closing_date) where state not in ('closed','cancelled');

create table public.transaction_participants (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id),
  user_id uuid references public.profiles (id),
  organization_id uuid references public.organizations (id),
  role public.participant_role not null,
  display_name text not null,
  email text not null,
  status public.participant_status not null default 'invited',
  invited_by uuid references public.profiles (id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id, email, role)
);
create index transaction_participants_user_idx on public.transaction_participants (user_id, transaction_id) where status in ('invited','active');
create index transaction_participants_tx_idx on public.transaction_participants (transaction_id);

create table public.transaction_events (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id),
  event_type text not null,
  from_state public.transaction_state,
  to_state public.transaction_state,
  actor_id uuid,
  actor_type public.actor_type not null,
  reason text,
  source text not null,
  related_entity_type text,
  related_entity_id uuid,
  ip_address text,
  correlation_id text not null,
  payload jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index transaction_events_tx_idx on public.transaction_events (transaction_id, occurred_at desc);

create table public.transaction_requirements (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id),
  key text not null,
  label text not null,
  satisfied boolean not null default false,
  satisfied_at timestamptz,
  evidence_entity_type text,
  evidence_entity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id, key)
);

create table public.transaction_milestones (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id),
  key public.milestone_key not null,
  owner_role public.participant_role,
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id, key)
);

-- ----------------------------------------------------------------------------- tasks
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id),
  milestone_key public.milestone_key,
  title text not null check (length(title) between 1 and 160),
  description text,
  assignee_participant_id uuid references public.transaction_participants (id),
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'normal',
  due_date date,
  required_evidence text,
  action_kind text not null default 'generic',
  related_entity_type text,
  related_entity_id uuid,
  estimated_minutes integer,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_tx_status_idx on public.tasks (transaction_id, status);
create index tasks_assignee_idx on public.tasks (assignee_participant_id) where status not in ('complete','waived');

create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

-- ----------------------------------------------------------------------------- documents
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id),
  name text not null,
  category public.document_category not null,
  current_version integer not null default 1,
  status public.document_status not null default 'processing',
  signature_status public.signature_status not null default 'not_required',
  access_level public.access_level not null default 'all_participants',
  retention_policy text not null default 'transaction_plus_10y',
  uploaded_by uuid references public.profiles (id),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_tx_idx on public.documents (transaction_id, category);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id),
  transaction_id uuid not null references public.transactions (id),
  version integer not null check (version > 0),
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 char(64) not null,
  uploaded_by uuid references public.profiles (id),
  scan_status text not null default 'pending' check (scan_status in ('pending','clean','infected')),
  extracted_fields jsonb not null default '[]',
  is_signed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

create table public.document_signatures (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id),
  transaction_id uuid not null references public.transactions (id),
  document_version integer not null,
  provider text not null,
  external_envelope_id text not null,
  status public.signature_status not null default 'draft',
  requested_by uuid not null references public.profiles (id),
  recipients jsonb not null default '[]',
  sent_at timestamptz,
  completed_at timestamptz,
  certificate_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_envelope_id)
);

-- ----------------------------------------------------------------------------- identity & compliance
create table public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references public.transactions (id),
  participant_id uuid references public.transaction_participants (id),
  user_id uuid references public.profiles (id),
  provider text not null,
  external_id text not null,
  status public.identity_status not null default 'pending',
  checks jsonb not null,
  verified_at timestamptz,
  expires_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);
create index identity_verifications_participant_idx on public.identity_verifications (participant_id);

create table public.compliance_cases (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references public.transactions (id),
  organization_id uuid references public.organizations (id),
  participant_id uuid references public.transaction_participants (id),
  category public.compliance_category not null,
  reason text not null,
  provider text,
  status public.compliance_status not null default 'pending',
  risk_flags text[] not null default '{}',
  reviewer_id uuid references public.profiles (id),
  notes text,
  decision text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index compliance_cases_open_idx on public.compliance_cases (status) where status <> 'approved';

create table public.source_of_funds_declarations (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id),
  participant_id uuid not null references public.transaction_participants (id),
  source_type public.source_of_funds_type not null,
  amount bigint not null check (amount > 0),
  currency public.currency_code not null,
  description text,
  evidence_document_id uuid references public.documents (id),
  status public.compliance_status not null default 'pending',
  compliance_case_id uuid references public.compliance_cases (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------- banking
create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  transaction_id uuid references public.transactions (id),
  provider text not null,
  institution_id text not null,
  institution_name text not null,
  external_connection_id text,
  status public.bank_connection_status not null default 'connecting',
  consent_created_at timestamptz,
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bank_connections_user_idx on public.bank_connections (user_id);

-- Encrypted provider tokens live in their own table with NO client access at all.
create table public.bank_connection_secrets (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null unique references public.bank_connections (id) on delete cascade,
  encrypted_access_token text not null,
  key_version integer not null,
  created_at timestamptz not null default now()
);

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.bank_connections (id),
  user_id uuid not null references public.profiles (id),
  external_account_id text not null,
  name text not null,
  mask varchar(4) not null,
  currency public.currency_code not null,
  available_balance bigint,
  current_balance bigint,
  balance_as_of timestamptz,
  owner_names text[] not null default '{}',
  ownership_verified boolean not null default false,
  ownership_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_account_id)
);

-- Settlement instructions are versioned objects, never editable text.
create table public.bank_instructions (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id),
  purpose text not null check (purpose in ('closing_funds_to_escrow','earnest_money_to_escrow','seller_proceeds','loan_payoff')),
  beneficiary_name text not null,
  bank_name text not null,
  account_mask varchar(4) not null,
  routing_identifier text not null,
  encrypted_account_number text not null,
  currency public.currency_code not null,
  status public.instruction_status not null default 'pending_verification',
  version integer not null check (version > 0),
  previous_version_id uuid references public.bank_instructions (id),
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  verification_method text,
  effective_after timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (transaction_id, purpose, version)
);

-- ----------------------------------------------------------------------------- payments & escrow
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id),
  type public.payment_type not null,
  rail public.payment_rail not null,
  status public.payment_status not null default 'created',
  amount bigint not null check (amount > 0),
  currency public.currency_code not null,
  from_account_id uuid references public.bank_accounts (id),
  bank_instruction_id uuid references public.bank_instructions (id),
  provider text not null,
  external_payment_id text,
  idempotency_key text not null unique,
  initiated_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  requires_dual_approval boolean not null default true,
  settled_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The initiator can never be their own second approver.
  check (approved_by is null or approved_by <> initiated_by),
  -- A payment is only settled with a settlement timestamp.
  check (status <> 'settled' or settled_at is not null)
);
create index payments_tx_idx on public.payments (transaction_id, status);
create unique index payments_provider_ref_idx on public.payments (provider, external_payment_id) where external_payment_id is not null;

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id),
  transaction_id uuid not null references public.transactions (id),
  status public.payment_status not null,
  source text not null check (source in ('provider_webhook','user','system')),
  webhook_event_id uuid,
  occurred_at timestamptz not null default now()
);

create table public.escrow_accounts (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions (id),
  provider text not null,
  provider_name text not null,
  external_reference text not null,
  status public.escrow_status not null default 'open',
  required_amount bigint not null check (required_amount >= 0),
  received_amount bigint not null default 0 check (received_amount >= 0),
  currency public.currency_code not null,
  expected_release_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.escrow_transactions (
  id uuid primary key default gen_random_uuid(),
  escrow_account_id uuid not null references public.escrow_accounts (id),
  transaction_id uuid not null references public.transactions (id),
  direction text not null check (direction in ('deposit','disbursement')),
  amount bigint not null check (amount > 0),
  currency public.currency_code not null,
  status public.payment_status not null,
  payment_id uuid references public.payments (id),
  description text not null,
  external_reference text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.escrow_conditions (
  id uuid primary key default gen_random_uuid(),
  escrow_account_id uuid not null references public.escrow_accounts (id),
  transaction_id uuid not null references public.transactions (id),
  description text not null,
  satisfied boolean not null default false,
  satisfied_at timestamptz,
  satisfied_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id),
  subject_type text not null check (subject_type in ('payment','bank_instruction')),
  subject_id uuid not null,
  requested_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approved_by is null or approved_by <> requested_by)
);

-- ----------------------------------------------------------------------------- mortgage & title
create table public.mortgages (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions (id),
  lender_name text not null,
  loan_officer_participant_id uuid references public.transaction_participants (id),
  loan_amount bigint not null check (loan_amount > 0),
  currency public.currency_code not null,
  interest_rate_bps integer,
  term_months integer,
  loan_type text not null,
  ltv_bps integer,
  status public.mortgage_status not null default 'not_started',
  appraisal_status text not null default 'not_ordered' check (appraisal_status in ('not_ordered','ordered','scheduled','completed','issue')),
  underwriting_status text not null default 'not_started' check (underwriting_status in ('not_started','in_review','conditions','approved','denied')),
  clear_to_close_at timestamptz,
  funded_at timestamptz,
  provider text not null,
  external_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mortgage_conditions (
  id uuid primary key default gen_random_uuid(),
  mortgage_id uuid not null references public.mortgages (id),
  transaction_id uuid not null references public.transactions (id),
  description text not null,
  satisfied boolean not null default false,
  satisfied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.title_cases (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions (id),
  title_company text not null,
  status public.title_status not null default 'not_started',
  current_owner text,
  search_completed_at timestamptz,
  cleared_at timestamptz,
  insurance_policy_number text,
  provider text not null,
  external_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.title_issues (
  id uuid primary key default gen_random_uuid(),
  title_case_id uuid not null references public.title_cases (id),
  transaction_id uuid not null references public.transactions (id),
  kind text not null check (kind in ('lien','mortgage','judgment','easement','encumbrance','tax','other')),
  description text not null,
  amount bigint,
  resolved boolean not null default false,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------- recording & ownership
create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions (id),
  status public.recording_status not null default 'not_ready',
  registry text not null,
  recording_reference text,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles (id),
  recorded_at timestamptz,
  confirmation_source text check (confirmation_source in ('registry_api','authorized_professional')),
  confirmed_by uuid references public.profiles (id),
  document_id uuid references public.documents (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- "Recorded" requires a registry reference, a timestamp and a confirmation source.
  check (status <> 'recorded' or (recording_reference is not null and recorded_at is not null and confirmation_source is not null))
);

create table public.ownership_records (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions (id),
  property_id uuid not null references public.properties (id),
  owner_user_ids uuid[] not null default '{}',
  owner_names text[] not null default '{}',
  purchase_date date not null,
  purchase_amount bigint not null,
  currency public.currency_code not null,
  recording_id uuid not null references public.recordings (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ownership_record_items (
  id uuid primary key default gen_random_uuid(),
  ownership_record_id uuid not null references public.ownership_records (id),
  kind text not null check (kind in ('signed_document','mortgage','insurance','warranty','renovation','receipt','maintenance','tax')),
  title text not null,
  amount bigint,
  occurred_on date,
  document_id uuid references public.documents (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------- messaging, notifications, calendar
create table public.message_threads (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id),
  kind public.thread_kind not null,
  title text not null,
  member_user_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads (id),
  transaction_id uuid not null references public.transactions (id),
  author_id uuid references public.profiles (id),
  kind public.message_kind not null default 'user',
  body text not null check (length(body) between 1 and 10000),
  mentions uuid[] not null default '{}',
  attachment_document_ids uuid[] not null default '{}',
  related_entity_type text,
  related_entity_id uuid,
  created_at timestamptz not null default now()
);
create index messages_thread_idx on public.messages (thread_id, created_at);

create table public.message_reads (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  read_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  transaction_id uuid references public.transactions (id),
  kind text not null,
  title text not null,
  body text not null,
  link_path text check (link_path is null or link_path like '/%'),
  channel public.notification_channel not null,
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  in_app boolean not null default true,
  email boolean not null default true,
  sms boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind)
);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id),
  kind public.calendar_event_kind not null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index calendar_events_tx_idx on public.calendar_events (transaction_id, starts_at);

-- ----------------------------------------------------------------------------- platform
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id),
  category text not null,
  provider text not null,
  mode text not null check (mode in ('mock','sandbox','production')),
  enabled boolean not null default true,
  status text not null default 'unknown' check (status in ('healthy','degraded','down','unknown')),
  last_health_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations (id) on delete cascade,
  encrypted_secret text not null,
  key_version integer not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_event_id text not null,
  event_type text not null,
  payload_hash char(64) not null,
  payload jsonb not null,
  status public.webhook_event_status not null default 'received',
  attempts integer not null default 0,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  -- Exactly-once: the same provider event can never be recorded twice.
  unique (provider, external_event_id)
);
create index webhook_events_status_idx on public.webhook_events (status, received_at) where status in ('failed','dead_letter');

create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  transaction_id uuid references public.transactions (id),
  payload jsonb not null default '{}',
  correlation_id text not null,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending','processing','processed','failed','dead_letter')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index domain_events_pending_idx on public.domain_events (available_at) where status in ('pending','failed');

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id),
  transaction_id uuid references public.transactions (id),
  actor_id uuid,
  actor_type public.actor_type not null,
  action text not null,
  resource_type text not null,
  resource_id text,
  occurred_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}',
  correlation_id text not null
);
create index audit_events_tx_idx on public.audit_events (transaction_id, occurred_at desc);
create index audit_events_actor_idx on public.audit_events (actor_id, occurred_at desc);
create index audit_events_action_idx on public.audit_events (action, occurred_at desc);

create table public.security_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id),
  transaction_id uuid references public.transactions (id),
  kind text not null,
  risk_level public.risk_level not null,
  controls text[] not null default '{}',
  details jsonb not null default '{}',
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text not null,
  enabled boolean not null default false,
  rollout_percent integer not null default 0 check (rollout_percent between 0 and 100),
  organization_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  audience text not null check (audience in ('consumer','professional','team','enterprise')),
  price_monthly bigint,
  currency public.currency_code not null,
  features text[] not null default '{}',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id),
  user_id uuid references public.profiles (id),
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (organization_id is not null or user_id is not null)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references public.billing_accounts (id),
  plan_id uuid not null references public.plans (id),
  status text not null check (status in ('trialing','active','past_due','canceled','incomplete')),
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  purpose text not null,
  granted boolean not null,
  policy_version text not null,
  created_at timestamptz not null default now()
);

create table public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  code_hash char(64) not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code_hash)
);

create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  user_id uuid,
  route text not null,
  request_hash text not null,
  response_status integer not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  unique (key, user_id, route)
);

-- ----------------------------------------------------------------------------- triggers: updated_at
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'updated_at'
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------- triggers: immutability
create trigger audit_events_append_only before update or delete on public.audit_events for each row execute function public.reject_mutation();
create trigger transaction_events_append_only before update or delete on public.transaction_events for each row execute function public.reject_mutation();
create trigger document_versions_append_only before update or delete on public.document_versions for each row execute function public.reject_mutation();
create trigger payment_events_append_only before update or delete on public.payment_events for each row execute function public.reject_mutation();
create trigger consent_records_append_only before update or delete on public.consent_records for each row execute function public.reject_mutation();

create trigger transactions_no_delete before delete on public.transactions for each row execute function public.reject_delete();
create trigger payments_no_delete before delete on public.payments for each row execute function public.reject_delete();
create trigger escrow_accounts_no_delete before delete on public.escrow_accounts for each row execute function public.reject_delete();
create trigger escrow_transactions_no_delete before delete on public.escrow_transactions for each row execute function public.reject_delete();
create trigger bank_instructions_no_delete before delete on public.bank_instructions for each row execute function public.reject_delete();
create trigger documents_no_delete before delete on public.documents for each row execute function public.reject_delete();
create trigger recordings_no_delete before delete on public.recordings for each row execute function public.reject_delete();

-- Bank instructions: content is immutable. Only the verification lifecycle may change.
create or replace function public.bank_instructions_guard() returns trigger
language plpgsql as $$
begin
  if (new.transaction_id, new.purpose, new.beneficiary_name, new.bank_name, new.account_mask,
      new.routing_identifier, new.encrypted_account_number, new.currency, new.version,
      new.previous_version_id, new.created_by, new.created_at)
     is distinct from
     (old.transaction_id, old.purpose, old.beneficiary_name, old.bank_name, old.account_mask,
      old.routing_identifier, old.encrypted_account_number, old.currency, old.version,
      old.previous_version_id, old.created_by, old.created_at) then
    raise exception 'bank instruction content is immutable; create a new version' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'pending_verification' and new.status in ('verified','rejected','superseded')) or
       (old.status = 'verified' and new.status in ('locked','superseded')) or
       (old.status = 'locked' and new.status = 'superseded')) then
    raise exception 'invalid bank instruction status change % -> %', old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger bank_instructions_guard before update on public.bank_instructions for each row execute function public.bank_instructions_guard();

-- Escrow ledger rows: only status may change (processing → settled etc.).
create or replace function public.escrow_transactions_guard() returns trigger
language plpgsql as $$
begin
  if (new.escrow_account_id, new.transaction_id, new.direction, new.amount, new.currency, new.payment_id, new.created_at)
     is distinct from
     (old.escrow_account_id, old.transaction_id, old.direction, old.amount, old.currency, old.payment_id, old.created_at) then
    raise exception 'escrow ledger entries are immutable except status' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger escrow_transactions_guard before update on public.escrow_transactions for each row execute function public.escrow_transactions_guard();

-- Signed document versions cannot be replaced: a document whose current version is signed
-- may only gain a NEW version, never have its version pointer moved backwards.
create or replace function public.documents_version_guard() returns trigger
language plpgsql as $$
begin
  if new.current_version < old.current_version then
    raise exception 'document versions only move forward' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger documents_version_guard before update on public.documents for each row execute function public.documents_version_guard();

-- Transaction state machine at the database layer.
create or replace function public.transactions_state_guard() returns trigger
language plpgsql as $$
begin
  if new.state is distinct from old.state then
    if not exists (select 1 from public.transaction_transitions t where t.from_state = old.state and t.to_state = new.state) then
      raise exception 'invalid transaction state transition % -> %', old.state, new.state using errcode = 'check_violation';
    end if;
    -- Ownership can never be marked transferred without a confirmed recording.
    if new.state in ('ownership_transfer','closed') and not exists (
      select 1 from public.recordings r
      where r.transaction_id = new.id and r.status = 'recorded'
        and r.recording_reference is not null and r.confirmation_source is not null) then
      raise exception 'ownership transfer requires a confirmed recording' using errcode = 'check_violation';
    end if;
    new.state_changed_at := now();
    if new.state = 'closed' then new.closed_at := now(); end if;
  end if;
  if new.version is not distinct from old.version then
    new.version := old.version + 1;
  end if;
  return new;
end $$;
create trigger transactions_state_guard before update on public.transactions for each row execute function public.transactions_state_guard();

-- Payments: settled / terminal states are final.
create or replace function public.payments_status_guard() returns trigger
language plpgsql as $$
begin
  if old.status in ('settled','failed','returned','cancelled') and new.status is distinct from old.status
     and not (old.status = 'settled' and new.status = 'returned') then
    raise exception 'payment in terminal state % cannot move to %', old.status, new.status using errcode = 'check_violation';
  end if;
  if (new.amount, new.currency, new.transaction_id, new.bank_instruction_id, new.idempotency_key, new.initiated_by)
     is distinct from (old.amount, old.currency, old.transaction_id, old.bank_instruction_id, old.idempotency_key, old.initiated_by) then
    raise exception 'payment amount, destination and initiator are immutable' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger payments_status_guard before update on public.payments for each row execute function public.payments_status_guard();
