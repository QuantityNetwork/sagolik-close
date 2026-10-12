-- Wallet proof of funds and the on-chain deal record (record and verify only).
--
-- Sagolik never holds keys to anyone's wallet and never moves money.
--  * wallet_connections: a wallet a person proved they control by signing a
--    message. Sagolik reads its USDC balance. Only the owner sees it.
--  * funds_checks: proof-of-funds results (bank account or wallet) for the
--    closing's escrow and verifiers: the result, never the balance.
--  * chain_records: entries in the deal record on Base. The chain stores only
--    a keyed deal id and a fingerprint of each receipt; the receipt itself
--    (facts only: no names, contact details or account numbers) stays here.

create table public.wallet_connections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id),
  transaction_id  uuid not null references public.transactions (id),
  network         text not null check (network in ('sandbox', 'base', 'base-sepolia', 'local')),
  chain_id        integer not null check (chain_id > 0),
  address         text not null check (address ~ '^0x[0-9a-fA-F]{40}$'),
  -- The signed challenge's nonce: one signature can only ever create one connection.
  challenge_nonce text not null unique check (length(challenge_nonce) between 16 and 128),
  status          text not null check (status in ('verified', 'removed')),
  verified_at     timestamptz not null,
  -- Whole cents of USDC at the last read.
  usdc_balance    bigint check (usdc_balance >= 0),
  balance_block   text check (balance_block ~ '^[0-9]{1,30}$'),
  balance_as_of   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((usdc_balance is null) = (balance_as_of is null))
);
create unique index wallet_connections_active on public.wallet_connections (transaction_id, user_id, network, address) where status = 'verified';
create index wallet_connections_user on public.wallet_connections (user_id);
create trigger set_updated_at before update on public.wallet_connections for each row execute function public.set_updated_at();

create table public.funds_checks (
  id               uuid primary key default gen_random_uuid(),
  transaction_id   uuid not null references public.transactions (id),
  user_id          uuid not null references public.profiles (id),
  source           text not null check (source in ('bank_account', 'wallet')),
  source_id        uuid not null,
  -- e.g. "Chase •••• 4821" or "USDC wallet on Base •••• 3f9A". Never a full number or address.
  source_label     text not null check (length(source_label) between 3 and 120),
  ownership_proven boolean not null,
  required_amount  bigint not null check (required_amount > 0),
  currency         public.currency_code not null,
  sufficient       boolean not null,
  checked_at       timestamptz not null,
  created_at       timestamptz not null default now()
);
create index funds_checks_tx on public.funds_checks (transaction_id, checked_at desc);
create trigger funds_checks_append_only before update or delete on public.funds_checks for each row execute function public.reject_mutation();

create table public.chain_records (
  id                 uuid primary key default gen_random_uuid(),
  transaction_id     uuid not null references public.transactions (id),
  kind               text not null check (kind in ('deal.opened', 'milestone.completed', 'document.version', 'instruction.verified', 'funds.received', 'ownership.transferred')),
  -- HMAC of the transaction id under a deployment secret: unlinkable without it.
  deal_id            text not null check (deal_id ~ '^0x[0-9a-f]{64}$'),
  receipt            jsonb not null,
  digest             text not null unique check (digest ~ '^0x[0-9a-f]{64}$'),
  dedupe_key         text not null unique check (length(dedupe_key) between 3 and 300),
  network            text not null check (network in ('sandbox', 'base', 'base-sepolia', 'local')),
  chain_id           integer not null check (chain_id > 0),
  registry           text not null check (registry ~ '^0x[0-9a-fA-F]{40}$'),
  status             text not null check (status in ('queued', 'submitted', 'confirmed', 'failed')),
  tx_hash            text check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  tx_nonce           integer check (tx_nonce >= 0),
  -- Earlier submissions this one replaced (same nonce, so at most one of them can land).
  previous_tx_hashes text[] not null default '{}',
  sequence           integer check (sequence > 0),
  head               text check (head ~ '^0x[0-9a-f]{64}$'),
  block_number       text check (block_number ~ '^[0-9]{1,30}$'),
  attempts           integer not null default 0 check (attempts >= 0),
  last_error         text check (length(last_error) <= 300),
  next_attempt_at    timestamptz,
  submitted_at       timestamptz,
  confirmed_at       timestamptz,
  recorded_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((status = 'confirmed') = (sequence is not null and head is not null and confirmed_at is not null)),
  check (status not in ('submitted', 'confirmed') or tx_hash is not null)
);
create index chain_records_tx on public.chain_records (transaction_id, created_at);
create index chain_records_open on public.chain_records (status, next_attempt_at) where status in ('queued', 'submitted');
create unique index chain_records_sequence on public.chain_records (network, registry, deal_id, sequence) where sequence is not null;
create trigger set_updated_at before update on public.chain_records for each row execute function public.set_updated_at();

-- What an entry commits to is fixed when it is created; only its delivery
-- (submission, confirmation) may change, and a confirmed entry is final.
create or replace function public.chain_records_guard() returns trigger
language plpgsql as $$
begin
  if (new.transaction_id, new.kind, new.deal_id, new.receipt, new.digest, new.dedupe_key, new.network, new.chain_id, new.registry, new.created_at)
     is distinct from
     (old.transaction_id, old.kind, old.deal_id, old.receipt, old.digest, old.dedupe_key, old.network, old.chain_id, old.registry, old.created_at) then
    raise exception 'deal record entries are immutable' using errcode = 'insufficient_privilege';
  end if;
  if old.status = 'confirmed' and (new.status, new.tx_hash, new.sequence, new.head, new.block_number)
     is distinct from (old.status, old.tx_hash, old.sequence, old.head, old.block_number) then
    raise exception 'a confirmed deal record entry is final' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger chain_records_guard before update on public.chain_records for each row execute function public.chain_records_guard();
create trigger chain_records_no_delete before delete on public.chain_records for each row execute function public.reject_mutation();

-- ----------------------------------------------------------------------------- access
do $$
declare t text;
begin
  foreach t in array array['wallet_connections', 'funds_checks', 'chain_records'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create policy "wallet_connections: owner" on public.wallet_connections for select to authenticated
  using (user_id = auth.uid());
create policy "funds_checks: owner, escrow and verifiers" on public.funds_checks for select to authenticated
  using (user_id = auth.uid() or public.has_tx_permission(transaction_id, 'escrow.manage') or public.has_tx_permission(transaction_id, 'beneficiary.verify'));
-- Money facts (verified instructions, funds received) only for people with financial access.
create policy "chain_records: participants" on public.chain_records for select to authenticated
  using (public.has_tx_permission(transaction_id, case when kind in ('instruction.verified', 'funds.received') then 'financial.view' else 'transaction.view' end));
