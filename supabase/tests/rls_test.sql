-- =============================================================================
-- RLS, tenant isolation, IDOR and immutability tests.
-- Runs against migrations + seed (see run.sh). Every check raises on failure.
-- =============================================================================
\set ON_ERROR_STOP 1

create or replace function pg_temp.eq(actual bigint, expected bigint, label text) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % — expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok: %', label;
end $$;

create or replace function pg_temp.login(p_email text) returns void
language plpgsql as $$
declare uid uuid;
begin
  select id into uid from public.profiles where email = p_email;
  if uid is null then raise exception 'no user %', p_email; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

grant execute on function pg_temp.eq(bigint, bigint, text) to anon, authenticated;

select id as maple from public.transactions where reference = 'SC-DEMO-MAPLE' \gset
select id as barton from public.transactions where reference = 'SC-DEMO-BARTON' \gset
select id as hillside from public.transactions where reference = 'SC-DEMO-HILLSIDE' \gset
select id as olivia from public.profiles where email = 'olivia.carter@demo.sagolik.test' \gset
select id as daniel from public.profiles where email = 'daniel.brooks@demo.sagolik.test' \gset
select id as room from public.message_threads where transaction_id = :'maple' and kind = 'transaction_room' \gset
select id as daniel_id_doc from public.documents where name = 'Daniel Brooks — ID verification record' \gset

-- ----------------------------------------------------------------------------- buyer (Olivia)
begin;
select pg_temp.login('olivia.carter@demo.sagolik.test');
set local role authenticated;
select pg_temp.eq((select count(*) from public.transactions), 1, 'buyer sees only her own transaction');
select pg_temp.eq((select count(*) from public.transactions where id = :'barton'), 0, 'IDOR: buyer cannot read another transaction by id');
select pg_temp.eq((select count(*) from public.documents where transaction_id = :'maple'), 15, 'buyer sees 15 of 16 documents (classification applied)');
select pg_temp.eq((select count(*) from public.documents where id = :'daniel_id_doc'), 0, 'buyer cannot see the seller''s restricted ID record');
select pg_temp.eq((select count(*) from public.document_versions where document_id = :'daniel_id_doc'), 0, 'versions inherit document classification');
select pg_temp.eq((select count(*) from public.bank_connection_secrets), 0, 'encrypted bank tokens are never readable by clients');
select pg_temp.eq((select count(*) from public.bank_accounts where user_id <> :'olivia'), 0, 'buyer sees only her own bank accounts');
select pg_temp.eq((select count(*) from public.payments where transaction_id = :'maple'), 1, 'buyer sees payments on her transaction');
select pg_temp.eq((select count(*) from public.compliance_cases), 0, 'buyer cannot see compliance cases');
select pg_temp.eq((select count(*) from public.webhook_events), 0, 'no client access to webhook events');
select pg_temp.eq((select count(*) from public.audit_events), 0, 'buyer has no audit.view');
select pg_temp.eq((select count(*) from public.profiles where id = :'daniel'), 1, 'co-participants can see each other''s names');
do $$ begin
  begin
    perform encrypted_account_number from public.bank_instructions limit 1;
    raise exception 'FAIL: encrypted_account_number was selectable';
  exception when insufficient_privilege then raise notice 'ok: account numbers are column-protected';
  end;
end $$;
do $$ begin
  begin
    update public.transactions set state = 'closed';
    raise exception 'FAIL: client could update transactions';
  exception when insufficient_privilege then raise notice 'ok: clients cannot update transactions';
  end;
end $$;
do $$ begin
  begin
    insert into public.payments (transaction_id, type, rail, amount, currency, provider, idempotency_key, initiated_by)
    values ((select id from public.transactions limit 1), 'fee', 'wire', 1, 'USD', 'x', 'x', auth.uid());
    raise exception 'FAIL: client could insert a payment';
  exception when insufficient_privilege then raise notice 'ok: clients cannot create payments directly';
  end;
end $$;
do $$ begin
  begin
    update public.profiles set is_platform_admin = true where id = auth.uid();
    raise exception 'FAIL: privilege escalation via profile update';
  exception when insufficient_privilege then raise notice 'ok: cannot self-promote to platform admin';
  end;
end $$;
update public.profiles set full_name = 'Olivia Carter' where id = :'olivia';
insert into public.messages (thread_id, transaction_id, author_id, kind, body) values (:'room', :'maple', :'olivia', 'user', 'Test message');
select pg_temp.eq((select count(*) from public.messages where body = 'Test message'), 1, 'participant can post in her transaction room');
do $$ begin
  begin
    insert into public.messages (thread_id, transaction_id, author_id, kind, body)
    select id, transaction_id, (select id from public.profiles where email = 'daniel.brooks@demo.sagolik.test'), 'user', 'spoof'
    from public.message_threads where kind = 'transaction_room' limit 1;
    raise exception 'FAIL: could post as another user';
  exception when insufficient_privilege or check_violation then raise notice 'ok: cannot impersonate another author';
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------- buyer's agent (org member, no financial access)
begin;
select pg_temp.login('jessica.morgan@demo.sagolik.test');
set local role authenticated;
select pg_temp.eq((select count(*) from public.transactions), 4, 'agent sees her four files');
select pg_temp.eq((select count(*) from public.payments), 0, 'agent has no financial.view');
select pg_temp.eq((select count(*) from public.bank_instructions), 0, 'agent cannot see payment instructions');
select pg_temp.eq((select count(*) from public.documents where access_level = 'restricted' and uploaded_by <> auth.uid()), 0, 'agent cannot see restricted ID records');
rollback;

-- ----------------------------------------------------------------------------- loan officer (participation only)
begin;
select pg_temp.login('michael.reed@demo.sagolik.test');
set local role authenticated;
select pg_temp.eq((select count(*) from public.transactions), 4, 'loan officer sees only files he is on');
select pg_temp.eq((select count(*) from public.transactions where id = :'hillside'), 0, 'lender org admin gets no access to another org''s file');
select pg_temp.eq((select count(*) from public.compliance_cases), 0, 'lender cannot review compliance');
rollback;

-- ----------------------------------------------------------------------------- escrow officer (compliance reviewer)
begin;
select pg_temp.login('marcus.lee@demo.sagolik.test');
set local role authenticated;
select pg_temp.eq((select count(*) from public.compliance_cases where transaction_id = :'maple'), 1, 'escrow officer reviews compliance on his file');
select pg_temp.eq((select count(*) from public.documents where transaction_id = :'maple'), 16, 'escrow officer sees restricted documents');
rollback;

-- ----------------------------------------------------------------------------- organization admin (tenant-wide grants)
begin;
select pg_temp.login('sofia.alvarez@demo.sagolik.test');
set local role authenticated;
select pg_temp.eq((select count(*) from public.transactions), 4, 'org admin sees all of her organization''s transactions');
select pg_temp.eq((select (count(*) > 0)::int from public.audit_events where transaction_id = :'maple'), 1, 'org admin can read the audit trail');
rollback;

-- ----------------------------------------------------------------------------- homeowner after closing
begin;
select pg_temp.login('mia.rodriguez@demo.sagolik.test');
set local role authenticated;
select pg_temp.eq((select count(*) from public.transactions), 1, 'homeowner sees her closed transaction');
select pg_temp.eq((select count(*) from public.ownership_records), 1, 'homeowner sees her Home Record');
select pg_temp.eq((select count(*) from public.ownership_record_items), 6, 'Home Record items visible to owner');
rollback;

-- ----------------------------------------------------------------------------- business acquisition (beta)
select id as blueharbor from public.transactions where reference = 'SC-DEMO-BLUEHARBOR' \gset
begin;
select pg_temp.login('amara.okafor@demo.sagolik.test');
set local role authenticated;
select pg_temp.eq((select count(*) from public.transactions), 1, 'business buyer sees only her deal');
select pg_temp.eq((select count(*) from public.companies), 1, 'business buyer sees the target company');
select pg_temp.eq((select count(*) from public.transactions where id = :'maple'), 0, 'IDOR: business buyer cannot read a real-estate file');
select pg_temp.eq((select count(*) from public.mortgages where transaction_id = :'blueharbor'), 1, 'buyer sees acquisition financing');
do $$ begin
  begin
    insert into public.companies (legal_name, entity_type, state_of_formation, industry, deal_structure, currency) values ('X LLC', 'llc', 'TX', 'x', 'asset_purchase', 'USD');
    raise exception 'FAIL: client inserted a company';
  exception when insufficient_privilege then raise notice 'ok: clients cannot create companies';
  end;
end $$;
rollback;

begin;
select pg_temp.login('grace.liu@demo.sagolik.test');
set local role authenticated;
select pg_temp.eq((select count(*) from public.transactions where id = :'blueharbor'), 1, 'accountant sees the deal');
select pg_temp.eq(public.has_tx_permission(:'blueharbor', 'financial.view')::int, 0, 'accountant has no money permission');
select pg_temp.eq(public.has_tx_permission(:'blueharbor', 'document.view')::int, 1, 'accountant can work on diligence documents');
rollback;

begin;
select pg_temp.login('olivia.carter@demo.sagolik.test');
set local role authenticated;
select pg_temp.eq((select count(*) from public.companies), 0, 'home buyer cannot see companies in other deals');
rollback;

-- ----------------------------------------------------------------------------- Property Autopilot (owner portfolios)
begin;
select pg_temp.login('alex.morgan@demo.sagolik.test');
set local role authenticated;
select pg_temp.eq((select count(*) from public.property_passports), 5, 'the owner sees the five properties in their portfolio');
select pg_temp.eq((select count(*) from public.bills where status = 'received'), 2, 'the owner sees their open bills (escrowed tax is not payable)');
select pg_temp.eq((select count(*) from public.review_policies), 10, 'the owner sees their review rules');
select pg_temp.eq((select count(*) from public.transactions), 0, 'owner without a closing sees no transactions');
do $$ begin
  begin
    update public.bills set status = 'paid_verified', verified_at = now();
    raise exception 'FAIL: a client marked a bill as verified';
  exception when insufficient_privilege then raise notice 'ok: clients cannot mark bills paid or verified';
  end;
end $$;
do $$ begin
  begin
    insert into public.autopilot_decisions (organization_id, passport_id, outcome, severity, summary, evaluated_on, dedupe_key)
      select organization_id, id, 'routine', 'info', 'forged', current_date, 'forged' from public.property_passports limit 1;
    raise exception 'FAIL: a client wrote to the decision log';
  exception when insufficient_privilege then raise notice 'ok: clients cannot write decisions';
  end;
end $$;
rollback;

begin;
select pg_temp.login('olivia.carter@demo.sagolik.test');
set local role authenticated;
select pg_temp.eq((select count(*) from public.property_passports), 0, 'IDOR: another person cannot see the portfolio');
select pg_temp.eq((select count(*) from public.obligations), 0, 'IDOR: or its costs');
select pg_temp.eq((select count(*) from public.bills), 0, 'IDOR: or its bills');
select pg_temp.eq((select count(*) from public.autopilot_decisions), 0, 'IDOR: or its decision log');
select pg_temp.eq((select count(*) from public.funding_rules), 0, 'IDOR: or its funding rules');
rollback;

-- The decision log is append-only, even for the service role.
begin;
set local role service_role;
do $$ begin
  begin
    update public.autopilot_decisions set summary = 'rewritten';
    raise exception 'FAIL: a decision was rewritten';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'ok: decisions are append-only';
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------- platform admin: no implicit data access
begin;
select pg_temp.login('admin@demo.sagolik.test');
set local role authenticated;
select pg_temp.eq((select count(*) from public.transactions), 0, 'platform admin has no implicit transaction access');
select pg_temp.eq((select count(*) from public.documents), 0, 'platform admin has no implicit document access');
rollback;

-- ----------------------------------------------------------------------------- anonymous
begin;
select set_config('request.jwt.claims', '{}', true);
set local role anon;
select pg_temp.eq((select count(*) from public.plans), 4, 'anon can read the public plan catalogue');
do $$ begin
  begin
    perform 1 from public.transactions;
    raise exception 'FAIL: anon could query transactions';
  exception when insufficient_privilege then raise notice 'ok: anon has no table access';
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------- service role
begin;
set local role service_role;
select pg_temp.eq((select count(*) from public.transactions), 5, 'service role (server only) bypasses RLS');
rollback;
