-- Bank connections through Plaid Hosted Link: account ownership and proof of
-- funds. No credentials, no full account or routing numbers (Auth isn't
-- requested). Access tokens are sealed with envelope encryption and are the
-- only value that can change: disconnecting destroys it. Everything else is
-- append-only; status comes from events.

-- A started Hosted Link session, bound to one person and one transaction.
create table bank_links (
  id                uuid primary key,
  transaction_id    uuid not null,
  user_id           uuid not null,
  link_token_sealed text not null check (link_token_sealed like 'sce1.%'),
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now()
);
create index bank_links_user on bank_links (user_id, created_at desc);

create table bank_connections (
  id                  uuid primary key,
  link_id             uuid not null unique references bank_links (id), -- a link completes once
  transaction_id      uuid not null,
  user_id             uuid not null,
  provider            text not null check (provider = 'plaid'),
  item_id             text not null unique check (length(item_id) between 1 and 200),
  institution_id      text check (length(institution_id) <= 100),
  institution_name    text not null check (length(institution_name) between 1 and 200),
  consent_expires_at  timestamptz,
  access_token_sealed text check (access_token_sealed like 'sce1.%'),
  created_at          timestamptz not null default now()
);
create index bank_connections_tx_user on bank_connections (transaction_id, user_id);

-- The access token may only be destroyed (set to null); nothing else changes.
create function bank_connections_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or new.access_token_sealed is not null
     or (to_jsonb(new) - 'access_token_sealed') is distinct from (to_jsonb(old) - 'access_token_sealed') then
    raise exception 'bank_connections: only destroying the access token is allowed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger bank_connections_guard before update or delete on bank_connections
  for each row execute function bank_connections_guard();

-- Status history. The latest event is the connection's status.
create table bank_connection_events (
  id            bigint generated always as identity primary key,
  connection_id uuid not null references bank_connections (id),
  status        text not null check (status in ('connected', 'reauthentication_required', 'expired', 'revoked', 'error')),
  source        text not null check (source in ('user', 'plaid_api', 'plaid_webhook')),
  detail        text check (length(detail) <= 200),
  occurred_at   timestamptz not null default now()
);
create index bank_connection_events_conn on bank_connection_events (connection_id, id desc);

-- Accounts on a connection: display data and the last four digits only.
create table bank_accounts (
  id               uuid primary key,
  connection_id    uuid not null references bank_connections (id),
  plaid_account_id text not null check (length(plaid_account_id) between 1 and 200),
  name             text not null check (length(name) between 1 and 200),
  mask             text not null check (mask ~ '^[0-9A-Za-z]{0,4}$'),
  type             text not null check (length(type) <= 40),
  subtype          text not null check (length(subtype) <= 40),
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  created_at       timestamptz not null default now(),
  unique (connection_id, plaid_account_id)
);

-- Ownership: does a name on the account match the person? Names aren't stored.
create table ownership_checks (
  id          bigint generated always as identity primary key,
  account_id  uuid not null references bank_accounts (id),
  matched     boolean not null,
  owner_count int not null check (owner_count >= 0),
  checked_at  timestamptz not null default now()
);
create index ownership_checks_account on ownership_checks (account_id, id desc);

-- Proof of funds: a real-time balance compared with the amount required.
create table funds_checks (
  id              uuid primary key,
  account_id      uuid not null references bank_accounts (id),
  transaction_id  uuid not null,
  checked_by      uuid not null,
  required_amount bigint not null check (required_amount > 0),
  currency        char(3) not null check (currency ~ '^[A-Z]{3}$'),
  available       bigint,
  current         bigint,
  sufficient      boolean not null,
  checked_at      timestamptz not null default now()
);
create index funds_checks_tx on funds_checks (transaction_id, checked_at desc);

-- Verified Plaid webhooks, stored once (Plaid sends no event id, so the body hash is the key).
create table plaid_webhooks (
  id            bigint generated always as identity primary key,
  body_sha256   bytea not null unique check (octet_length(body_sha256) = 32),
  webhook_type  text not null check (length(webhook_type) <= 60),
  webhook_code  text not null check (length(webhook_code) <= 60),
  item_id       text check (length(item_id) <= 200),
  received_at   timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['bank_links', 'bank_connection_events', 'bank_accounts', 'ownership_checks', 'funds_checks', 'plaid_webhooks'] loop
    execute format('create trigger %I before update or delete on %I for each row execute function forbid_change()', t || '_append_only', t);
    execute format('create trigger %I before truncate on %I for each statement execute function forbid_change()', t || '_no_truncate', t);
  end loop;
end $$;
create trigger bank_connections_no_truncate before truncate on bank_connections
  for each statement execute function forbid_change();

revoke all on bank_links, bank_connections, bank_connection_events, bank_accounts, ownership_checks, funds_checks, plaid_webhooks from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'money_app') then
    grant select, insert on bank_links, bank_connections, bank_connection_events, bank_accounts, ownership_checks, funds_checks, plaid_webhooks to money_app;
    grant update (access_token_sealed) on bank_connections to money_app;
  end if;
end $$;
