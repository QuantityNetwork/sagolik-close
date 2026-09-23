-- Money service foundation: append-only audit chain, double-entry funds
-- tracking ledger, assertion replay guard. Owned by the migration role;
-- the runtime role (money_app) gets only the privileges listed at the end.

create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

-- ---------------------------------------------------------------- audit chain
-- hash = sha256(prev_hash || canonical fields), computed by the service.
-- details is canonical JSON text (sorted keys) so the hash can be recomputed
-- byte for byte; it must parse as JSON.
create table audit_events (
  seq         bigint generated always as identity primary key,
  occurred_at timestamptz not null,
  actor       text not null check (actor <> ''),
  action      text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  subject     text not null,
  request_id  text not null default '',
  details     text not null default '{}' check (details::jsonb is not null),
  prev_hash   bytea not null check (octet_length(prev_hash) = 32),
  hash        bytea not null unique check (octet_length(hash) = 32)
);
create trigger audit_events_append_only before update or delete on audit_events
  for each row execute function forbid_change();
create trigger audit_events_no_truncate before truncate on audit_events
  for each statement execute function forbid_change();

-- ---------------------------------------------------------------- ledger
-- Mirrors what licensed parties report about money we never hold. Each group
-- is one business event made of balanced lines; balances are always derived.
create table ledger_groups (
  id              uuid primary key,
  transaction_id  uuid not null,
  kind            text not null check (kind in ('expectation', 'receipt', 'disbursement')),
  currency        char(3) not null check (currency ~ '^[A-Z]{3}$'),
  source          text not null check (source <> ''),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 200),
  recorded_by     text not null check (recorded_by <> ''),
  recorded_at     timestamptz not null default now()
);
create index ledger_groups_transaction on ledger_groups (transaction_id);

create table ledger_entries (
  id       bigint generated always as identity primary key,
  group_id uuid not null references ledger_groups (id),
  account  text not null check (account in ('expected_source', 'funds_due', 'escrow_received', 'escrow_disbursed')),
  amount   bigint not null check (amount <> 0)
);
create index ledger_entries_group on ledger_entries (group_id);

-- Every group must balance to zero with at least two lines — checked at commit.
create function ledger_group_balanced() returns trigger language plpgsql as $$
declare
  total bigint;
  lines int;
begin
  select coalesce(sum(amount), 0), count(*) into total, lines from ledger_entries where group_id = new.group_id;
  if total <> 0 or lines < 2 then
    raise exception 'ledger group % is unbalanced (sum %, % lines)', new.group_id, total, lines using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger ledger_entries_balanced after insert on ledger_entries
  deferrable initially deferred for each row execute function ledger_group_balanced();

create function ledger_group_has_entries() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from ledger_entries where group_id = new.id) then
    raise exception 'ledger group % has no entries', new.id using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger ledger_groups_not_empty after insert on ledger_groups
  deferrable initially deferred for each row execute function ledger_group_has_entries();

create trigger ledger_groups_append_only before update or delete on ledger_groups
  for each row execute function forbid_change();
create trigger ledger_entries_append_only before update or delete on ledger_entries
  for each row execute function forbid_change();
create trigger ledger_groups_no_truncate before truncate on ledger_groups
  for each statement execute function forbid_change();
create trigger ledger_entries_no_truncate before truncate on ledger_entries
  for each statement execute function forbid_change();

-- ---------------------------------------------------------------- replay guard
create table assertion_replay (
  jti        text primary key,
  expires_at timestamptz not null
);
create index assertion_replay_expiry on assertion_replay (expires_at);

-- ---------------------------------------------------------------- privileges
revoke all on audit_events, ledger_groups, ledger_entries, assertion_replay from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'money_app') then
    grant select, insert on audit_events, ledger_groups, ledger_entries to money_app;
    grant select, insert, delete on assertion_replay to money_app;
  end if;
end $$;
