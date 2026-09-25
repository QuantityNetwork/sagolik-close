-- Payment instructions (where the buyer sends money: the escrow/title trust
-- account). Versions are immutable; status is derived from append-only events:
--   latest version of a purpose + a 'verified' event (+ cooling-off passed) = usable.
create table instructions (
  id                    uuid primary key,
  transaction_id        uuid not null,
  purpose               text not null check (purpose in ('earnest_money_to_escrow', 'closing_funds_to_escrow', 'seller_proceeds', 'loan_payoff')),
  version               int not null check (version >= 1),
  previous_id           uuid references instructions (id),
  beneficiary_name      text not null check (length(beneficiary_name) between 2 and 140),
  bank_name             text not null check (length(bank_name) between 2 and 140),
  routing_number        text not null check (routing_number ~ '^[0-9]{9}$'),
  account_mask          text not null check (account_mask ~ '^[0-9]{4}$'),
  account_number_sealed text not null check (account_number_sealed like 'sce1.%'),
  currency              char(3) not null check (currency ~ '^[A-Z]{3}$'),
  risk_level            text not null check (risk_level in ('low', 'medium', 'high', 'critical')),
  effective_after       timestamptz,
  created_by            uuid not null,
  created_at            timestamptz not null default now(),
  unique (transaction_id, purpose, version),
  check ((version = 1) = (previous_id is null))
);
create index instructions_tx on instructions (transaction_id, purpose, version desc);

create table instruction_events (
  id             bigint generated always as identity primary key,
  instruction_id uuid not null references instructions (id),
  kind           text not null check (kind in ('verified', 'rejected', 'revealed')),
  actor          uuid not null,
  method         text check (method in ('out_of_band_call', 'in_person', 'provider_attested')),
  reference      text check (length(reference) <= 200),
  occurred_at    timestamptz not null default now(),
  check ((kind = 'verified') = (method is not null))
);
-- A version is verified or rejected at most once.
create unique index instruction_events_decided on instruction_events (instruction_id) where kind in ('verified', 'rejected');

create trigger instructions_append_only before update or delete on instructions
  for each row execute function forbid_change();
create trigger instruction_events_append_only before update or delete on instruction_events
  for each row execute function forbid_change();
create trigger instructions_no_truncate before truncate on instructions
  for each statement execute function forbid_change();
create trigger instruction_events_no_truncate before truncate on instruction_events
  for each statement execute function forbid_change();

revoke all on instructions, instruction_events from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'money_app') then
    grant select, insert on instructions, instruction_events to money_app;
  end if;
end $$;
