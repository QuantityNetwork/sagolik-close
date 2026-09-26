-- Property Autopilot (phase 1: monitor and verify).
--
-- After closing, Sagolik keeps each property's operating record: what must be
-- paid, by when, from which account, and whether it was paid. Sagolik never
-- holds or moves money: the owner's bank, autopay and mortgage servicer make
-- every payment. Sagolik watches, forecasts, flags and verifies.
--
-- Ownership scope: an organization of an owner type (personal_portfolio,
-- holding_entity, family_office, property_manager). Everything below carries
-- its organization_id; reads are for that organization's members only, and
-- writes go through the service layer.

create table public.property_passports (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id),
  property_id         uuid not null unique references public.properties (id),
  ownership_record_id uuid unique references public.ownership_records (id),
  origin              text not null check (origin in ('sagolik_closing', 'imported')),
  label               text not null check (length(label) between 2 and 120),
  status              text not null check (status in ('preparing', 'live', 'sale_pending', 'sold')),
  monitoring          text not null check (monitoring in ('off', 'monitor')),
  acquired_on         date,
  activated_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- A property bought through Sagolik links to its Home Record; an imported one doesn't.
  check ((origin = 'sagolik_closing') = (ownership_record_id is not null))
);
create index property_passports_org on public.property_passports (organization_id);
create trigger set_updated_at before update on public.property_passports for each row execute function public.set_updated_at();

-- Who gets paid. No payment destinations are stored: Sagolik doesn't pay.
create table public.vendors (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name            text not null check (length(name) between 2 and 120),
  category        text not null check (category in ('lender', 'tax_authority', 'insurer', 'hoa', 'utility', 'telecom', 'security', 'property_manager', 'maintenance', 'other')),
  phone           text check (length(phone) <= 40),
  website         text check (website ~ '^https://'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);
create trigger set_updated_at before update on public.vendors for each row execute function public.set_updated_at();

-- A recurring or expected cost of keeping the property running.
create table public.obligations (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id),
  passport_id        uuid not null references public.property_passports (id),
  vendor_id          uuid references public.vendors (id),
  kind               text not null check (kind in ('mortgage', 'property_tax', 'insurance', 'hoa', 'electricity', 'water', 'gas', 'internet', 'security', 'property_management', 'maintenance', 'other')),
  label              text not null check (length(label) between 2 and 120),
  priority           text not null check (priority in ('critical', 'important', 'optional')),
  amount_type        text not null check (amount_type in ('fixed', 'variable', 'periodic', 'event', 'manual')),
  expected_amount    bigint check (expected_amount >= 0),
  expected_min       bigint check (expected_min >= 0),
  expected_max       bigint check (expected_max >= 0),
  currency           public.currency_code not null,
  frequency          text not null check (frequency in ('monthly', 'quarterly', 'semiannual', 'annual', 'once', 'irregular')),
  next_due_on        date,
  grace_days         integer not null default 0 check (grace_days between 0 and 90),
  -- How the owner pays it. Sagolik never pays.
  pay_method         text not null check (pay_method in ('autopay', 'bank_bill_pay', 'escrow', 'manual', 'unknown')),
  escrow_status      text not null check (escrow_status in ('confirmed_escrowed', 'confirmed_not_escrowed', 'possibly_escrowed', 'unknown', 'not_applicable')),
  funding_account_id uuid references public.bank_accounts (id),
  reference_last4    text check (reference_last4 ~ '^[0-9A-Za-z]{2,4}$'),
  -- Text that identifies this payee on a bank statement (for verifying payment).
  payee_match        text check (length(payee_match) between 2 and 80),
  source             text not null check (source in ('closing', 'document', 'bank_history', 'manual', 'demo')),
  confidence         integer not null check (confidence between 0 and 100),
  status             text not null check (status in ('suggested', 'active', 'paused', 'ended')),
  ended_on           date,
  created_by         uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (expected_min is null or expected_max is null or expected_min <= expected_max)
);
create index obligations_passport on public.obligations (passport_id);
create index obligations_org on public.obligations (organization_id);
create trigger set_updated_at before update on public.obligations for each row execute function public.set_updated_at();

-- An actual bill or statement for an obligation.
create table public.bills (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id),
  passport_id       uuid not null references public.property_passports (id),
  obligation_id     uuid not null references public.obligations (id),
  amount            bigint not null check (amount >= 0),
  currency          public.currency_code not null,
  due_on            date not null,
  period_label      text check (length(period_label) <= 60),
  -- paid_reported: the owner says it's paid; paid_verified: a bank transaction or statement confirms it.
  status            text not null check (status in ('received', 'paid_reported', 'paid_verified', 'covered_by_escrow', 'disputed', 'cancelled')),
  source            text not null check (source in ('manual', 'document', 'bank_history', 'demo')),
  file_key          text check (length(file_key) <= 300),
  file_name         text check (length(file_name) <= 200),
  paid_on           date,
  payment_reference text check (length(payment_reference) <= 120),
  verified_at       timestamptz,
  -- A person looked at a flagged bill (unusual amount, review rule) and found it in order.
  -- Two-person review needs a second, different person.
  reviewed_by        uuid references public.profiles (id),
  reviewed_at        timestamptz,
  second_reviewed_by uuid references public.profiles (id),
  second_reviewed_at timestamptz,
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check ((status = 'paid_verified') = (verified_at is not null)),
  check ((reviewed_by is null) = (reviewed_at is null)),
  check ((second_reviewed_by is null) = (second_reviewed_at is null)),
  check (second_reviewed_by is null or (reviewed_by is not null and second_reviewed_by <> reviewed_by))
);
create index bills_obligation on public.bills (obligation_id, due_on desc);
create index bills_passport_due on public.bills (passport_id, due_on);
create trigger set_updated_at before update on public.bills for each row execute function public.set_updated_at();

-- What Sagolik concluded and why. Append-only: history is never rewritten.
create table public.autopilot_decisions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  passport_id     uuid not null references public.property_passports (id),
  obligation_id   uuid references public.obligations (id),
  bill_id         uuid references public.bills (id),
  outcome         text not null check (outcome in ('routine', 'paid_verified', 'paid_reported', 'awaiting_bill', 'review_required', 'two_person_review', 'flagged', 'covered_by_escrow', 'verify_escrow', 'anomaly', 'duplicate_risk', 'overdue', 'funding_shortfall', 'missing_information')),
  severity        text not null check (severity in ('info', 'action_required', 'urgent', 'critical')),
  summary         text not null check (length(summary) between 3 and 300),
  reasons         text[] not null default '{}',
  rule            text check (length(rule) <= 120),
  amount          bigint,
  currency        public.currency_code,
  evaluated_on    date not null,
  dedupe_key      text not null unique check (length(dedupe_key) <= 300),
  created_at      timestamptz not null default now()
);
create index autopilot_decisions_passport on public.autopilot_decisions (passport_id, created_at desc);
create trigger autopilot_decisions_append_only before update or delete on public.autopilot_decisions for each row execute function public.reject_mutation();

-- When should a bill be routine, and when does it need a person? Evaluated in
-- order; the first enabled match wins. passport_id null = the whole portfolio.
create table public.review_policies (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  passport_id     uuid references public.property_passports (id),
  name            text not null check (length(name) between 3 and 120),
  obligation_kind text check (obligation_kind in ('mortgage', 'property_tax', 'insurance', 'hoa', 'electricity', 'water', 'gas', 'internet', 'security', 'property_management', 'maintenance', 'other')),
  min_amount      bigint not null default 0 check (min_amount >= 0),
  max_amount      bigint check (max_amount >= 0),
  action          text not null check (action in ('routine', 'owner_review', 'two_person_review', 'flag')),
  position        integer not null check (position >= 0),
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index review_policies_org on public.review_policies (organization_id, position);
create trigger set_updated_at before update on public.review_policies for each row execute function public.set_updated_at();

-- Which account pays this property's bills, and how much should stay in it.
-- Sagolik only recommends transfers; it never makes them.
create table public.funding_rules (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id),
  passport_id              uuid not null unique references public.property_passports (id),
  operating_account_id     uuid references public.bank_accounts (id),
  reserve_account_id       uuid references public.bank_accounts (id),
  min_operating_balance    bigint not null default 0 check (min_operating_balance >= 0),
  target_operating_balance bigint not null default 0 check (target_operating_balance >= 0),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (operating_account_id is null or reserve_account_id is null or operating_account_id <> reserve_account_id)
);
create trigger set_updated_at before update on public.funding_rules for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------- access
do $$
declare t text;
begin
  foreach t in array array['property_passports', 'vendors', 'obligations', 'bills', 'autopilot_decisions', 'review_policies', 'funding_rules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))', t || ': organization members', t);
  end loop;
end $$;
