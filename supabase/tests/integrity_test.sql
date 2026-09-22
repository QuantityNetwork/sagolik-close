-- =============================================================================
-- Database-level integrity: append-only history, immutable instructions and
-- ledger rows, state-machine guard, ownership guard, payment finality.
-- These hold even for code running with the service role.
-- =============================================================================
\set ON_ERROR_STOP 1

select id as maple from public.transactions where reference = 'SC-DEMO-MAPLE' \gset

create or replace function pg_temp.expect_error(p_sql text, p_label text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok: % (%)', p_label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — statement succeeded: %', p_label, p_sql;
end $$;

begin;
set local role service_role;

select pg_temp.expect_error('update public.audit_events set action = ''tampered''', 'audit events are append-only');
select pg_temp.expect_error('delete from public.audit_events', 'audit events cannot be deleted');
select pg_temp.expect_error('update public.transaction_events set reason = ''x''', 'state history is append-only');
select pg_temp.expect_error('update public.document_versions set sha256 = repeat(''0'', 64)', 'document versions are immutable');
select pg_temp.expect_error('delete from public.payments', 'payments are never deleted');
select pg_temp.expect_error('delete from public.transactions', 'transactions are never deleted');
select pg_temp.expect_error('update public.bank_instructions set bank_name = ''Evil Bank''', 'instruction content is immutable');
select pg_temp.expect_error('update public.bank_instructions set status = ''pending_verification''', 'instruction status cannot move backwards');
select pg_temp.expect_error('update public.escrow_transactions set amount = 1', 'escrow ledger amounts are immutable');
select pg_temp.expect_error('update public.payments set status = ''processing'' where status = ''settled''', 'settled payments are final');
select pg_temp.expect_error('update public.payments set amount = amount + 1', 'payment amount is immutable');
select pg_temp.expect_error(format('update public.transactions set state = ''closed'' where id = %L', :'maple'), 'state machine rejects undefined transitions');
select pg_temp.expect_error(format('update public.transactions set state = ''disputed'' where id = %L; update public.transactions set state = ''recording_pending'' where id = %L; update public.transactions set state = ''ownership_transfer'' where id = %L', :'maple', :'maple', :'maple'), 'ownership requires a confirmed recording');
select pg_temp.expect_error(format('update public.recordings set status = ''recorded'' where transaction_id = %L', :'maple'), 'a recording cannot be marked recorded without reference + confirmation');
select pg_temp.expect_error('update public.documents set current_version = 0', 'document versions only move forward');
select pg_temp.expect_error(format('insert into public.webhook_events (provider, external_event_id, event_type, payload_hash, payload) values (''p'', ''e1'', ''t'', repeat(''a'',64), ''{}''), (''p'', ''e1'', ''t'', repeat(''a'',64), ''{}'')'), 'the same provider event cannot be recorded twice');

-- Allowed: the documented verification lifecycle and valid transitions.
update public.transactions set state = 'disputed' where id = :'maple';
update public.transactions set state = 'signing' where id = :'maple';
rollback;
