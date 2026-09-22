-- =============================================================================
-- Row Level Security
--
-- Model
--   * READS: people see transactions they participate in, or that belong to an
--     organization where their org role grants access. Documents additionally
--     apply their own access classification.
--   * WRITES: go through the server-side service layer (service role) after
--     explicit authorization + audit. Browsers holding the public anon key can
--     therefore NOT write domain data directly; the few exceptions (messages,
--     read receipts, own preferences, own profile basics) are listed below.
--   * Platform admins get NO implicit data access here. Support access uses
--     explicit, audited privileged operations with the service role.
--   * Secrets tables (bank_connection_secrets, integration_credentials) have no
--     policies at all → no client access.
-- =============================================================================

-- ----------------------------------------------------------------------------- helper functions
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false)
$$;

create or replace function public.has_tx_permission(p_tx uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
      select 1
      from public.transaction_participants tp
      join public.role_permissions rp on rp.role = tp.role and rp.permission = p_perm
      where tp.transaction_id = p_tx and tp.user_id = auth.uid() and tp.status in ('invited', 'active')
    )
    or exists (
      select 1
      from public.transactions t
      join public.organization_members om on om.organization_id = t.organization_id and om.user_id = auth.uid()
      join public.organization_role_permissions orp on orp.role = om.role and orp.permission = p_perm
      where t.id = p_tx
    )
$$;

create or replace function public.role_meets_access_level(p_role public.participant_role, p_level public.access_level) returns boolean
language sql immutable set search_path = '' as $$
  select case p_level
    when 'all_participants' then true
    when 'principals_and_professionals' then p_role not in ('notary', 'insurance_agent')
    when 'professionals_only' then p_role not in ('buyer', 'co_buyer', 'seller', 'co_seller')
    when 'restricted' then false -- handled via document.view_restricted
  end
$$;

create or replace function public.can_view_document(p_doc uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_doc
      and public.has_tx_permission(d.transaction_id, 'document.view')
      and (
        d.uploaded_by = auth.uid()
        or (d.access_level = 'restricted' and public.has_tx_permission(d.transaction_id, 'document.view_restricted'))
        or (d.access_level <> 'restricted' and (
          exists (
            select 1 from public.transactions t
            join public.organization_members om on om.organization_id = t.organization_id and om.user_id = auth.uid()
            join public.organization_role_permissions orp on orp.role = om.role and orp.permission = 'document.view'
            where t.id = d.transaction_id
          )
          or exists (
            select 1 from public.transaction_participants tp
            where tp.transaction_id = d.transaction_id and tp.user_id = auth.uid()
              and tp.status in ('invited', 'active')
              and public.role_meets_access_level(tp.role, d.access_level)
          )
        ))
      )
  )
$$;

create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organization_members om where om.organization_id = p_org and om.user_id = auth.uid())
$$;

create or replace function public.shares_transaction_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.transaction_participants a
    join public.transaction_participants b on a.transaction_id = b.transaction_id
    where a.user_id = auth.uid() and b.user_id = p_user
      and a.status in ('invited', 'active') and b.status in ('invited', 'active')
  )
$$;

revoke all on function public.has_tx_permission(uuid, text) from public;
grant execute on function public.has_tx_permission(uuid, text) to authenticated, service_role;
revoke all on function public.can_view_document(uuid) from public;
grant execute on function public.can_view_document(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------- enable RLS everywhere
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Browsers never write through PostgREST except where a policy + column grant below allows it.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;

-- ----------------------------------------------------------------------------- reference data (read-only)
grant select on public.transaction_states, public.transaction_transitions, public.role_permissions,
  public.organization_roles, public.organization_role_permissions to authenticated;
create policy "reference: read" on public.transaction_states for select to authenticated using (true);
create policy "reference: read" on public.transaction_transitions for select to authenticated using (true);
create policy "reference: read" on public.role_permissions for select to authenticated using (true);
create policy "reference: read" on public.organization_roles for select to authenticated using (true);
create policy "reference: read" on public.organization_role_permissions for select to authenticated using (true);

-- ----------------------------------------------------------------------------- profiles
create policy "profiles: read self, co-participants, org colleagues" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.shares_transaction_with(id)
    or exists (
      select 1 from public.organization_members a
      join public.organization_members b on a.organization_id = b.organization_id
      where a.user_id = auth.uid() and b.user_id = profiles.id
    )
  );
grant update (full_name, phone, locale, avatar_url) on public.profiles to authenticated;
create policy "profiles: update own basics" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ----------------------------------------------------------------------------- organizations
create policy "organizations: members and participants" on public.organizations for select to authenticated
  using (
    public.is_org_member(id)
    or exists (select 1 from public.transactions t where t.organization_id = organizations.id and public.has_tx_permission(t.id, 'transaction.view'))
  );
create policy "organization_members: same org" on public.organization_members for select to authenticated
  using (public.is_org_member(organization_id));
create policy "organization_settings: same org" on public.organization_settings for select to authenticated
  using (public.is_org_member(organization_id));
create policy "organization_branding: members and participants" on public.organization_branding for select to authenticated
  using (
    public.is_org_member(organization_id)
    or exists (select 1 from public.transactions t where t.organization_id = organization_branding.organization_id and public.has_tx_permission(t.id, 'transaction.view'))
  );

-- ----------------------------------------------------------------------------- transaction core
create policy "properties: via transaction" on public.properties for select to authenticated
  using (exists (select 1 from public.transactions t where t.property_id = properties.id and public.has_tx_permission(t.id, 'transaction.view')));
create policy "transactions: view permission" on public.transactions for select to authenticated
  using (public.has_tx_permission(id, 'transaction.view'));
create policy "participants: view permission" on public.transaction_participants for select to authenticated
  using (public.has_tx_permission(transaction_id, 'transaction.view'));
create policy "transaction_events: view permission" on public.transaction_events for select to authenticated
  using (public.has_tx_permission(transaction_id, 'transaction.view'));
create policy "requirements: view permission" on public.transaction_requirements for select to authenticated
  using (public.has_tx_permission(transaction_id, 'transaction.view'));
create policy "milestones: view permission" on public.transaction_milestones for select to authenticated
  using (public.has_tx_permission(transaction_id, 'transaction.view'));
create policy "tasks: view permission" on public.tasks for select to authenticated
  using (public.has_tx_permission(transaction_id, 'transaction.view'));
create policy "task_dependencies: via task" on public.task_dependencies for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_dependencies.task_id and public.has_tx_permission(t.transaction_id, 'transaction.view')));
create policy "calendar: view permission" on public.calendar_events for select to authenticated
  using (public.has_tx_permission(transaction_id, 'transaction.view'));

-- ----------------------------------------------------------------------------- documents (transaction permission + access classification)
create policy "documents: classification" on public.documents for select to authenticated
  using (public.can_view_document(id));
create policy "document_versions: via document" on public.document_versions for select to authenticated
  using (public.can_view_document(document_id));
create policy "document_signatures: via document" on public.document_signatures for select to authenticated
  using (public.can_view_document(document_id));

-- ----------------------------------------------------------------------------- identity & compliance (minimised)
create policy "identity: own or authorized reviewer" on public.identity_verifications for select to authenticated
  using (user_id = auth.uid() or (transaction_id is not null and public.has_tx_permission(transaction_id, 'identity.view_result')));
create policy "compliance: reviewers only" on public.compliance_cases for select to authenticated
  using (transaction_id is not null and public.has_tx_permission(transaction_id, 'compliance.review'));
create policy "source_of_funds: declarant or reviewer" on public.source_of_funds_declarations for select to authenticated
  using (
    exists (select 1 from public.transaction_participants tp where tp.id = participant_id and tp.user_id = auth.uid())
    or public.has_tx_permission(transaction_id, 'compliance.review')
  );

-- ----------------------------------------------------------------------------- banking (owner only; secrets never)
create policy "bank_connections: owner" on public.bank_connections for select to authenticated using (user_id = auth.uid());
create policy "bank_accounts: owner" on public.bank_accounts for select to authenticated using (user_id = auth.uid());
-- bank_connection_secrets: RLS enabled, no policy → no client access.

-- Instructions are visible to people with financial access, but the encrypted
-- account number column is never selectable by clients.
revoke select on public.bank_instructions from authenticated;
grant select (id, transaction_id, purpose, beneficiary_name, bank_name, account_mask, routing_identifier, currency,
  status, version, previous_version_id, verified_by, verified_at, verification_method, effective_after, created_by, created_at)
  on public.bank_instructions to authenticated;
create policy "bank_instructions: financial view" on public.bank_instructions for select to authenticated
  using (public.has_tx_permission(transaction_id, 'financial.view'));

-- ----------------------------------------------------------------------------- money
create policy "payments: financial view" on public.payments for select to authenticated
  using (public.has_tx_permission(transaction_id, 'financial.view'));
create policy "payment_events: financial view" on public.payment_events for select to authenticated
  using (public.has_tx_permission(transaction_id, 'financial.view'));
create policy "escrow_accounts: financial view" on public.escrow_accounts for select to authenticated
  using (public.has_tx_permission(transaction_id, 'financial.view'));
create policy "escrow_transactions: financial view" on public.escrow_transactions for select to authenticated
  using (public.has_tx_permission(transaction_id, 'financial.view'));
create policy "escrow_conditions: view permission" on public.escrow_conditions for select to authenticated
  using (public.has_tx_permission(transaction_id, 'transaction.view'));
create policy "approvals: financial view" on public.approvals for select to authenticated
  using (public.has_tx_permission(transaction_id, 'financial.view'));

-- ----------------------------------------------------------------------------- mortgage, title, recording, ownership
create policy "mortgages: view permission" on public.mortgages for select to authenticated
  using (public.has_tx_permission(transaction_id, 'transaction.view'));
create policy "mortgage_conditions: view permission" on public.mortgage_conditions for select to authenticated
  using (public.has_tx_permission(transaction_id, 'transaction.view'));
create policy "title_cases: view permission" on public.title_cases for select to authenticated
  using (public.has_tx_permission(transaction_id, 'transaction.view'));
create policy "title_issues: view permission" on public.title_issues for select to authenticated
  using (public.has_tx_permission(transaction_id, 'transaction.view'));
create policy "recordings: view permission" on public.recordings for select to authenticated
  using (public.has_tx_permission(transaction_id, 'transaction.view'));
create policy "ownership_records: owners and participants" on public.ownership_records for select to authenticated
  using (auth.uid() = any (owner_user_ids) or public.has_tx_permission(transaction_id, 'transaction.view'));
create policy "ownership_record_items: via record" on public.ownership_record_items for select to authenticated
  using (exists (
    select 1 from public.ownership_records r where r.id = ownership_record_id
      and (auth.uid() = any (r.owner_user_ids) or public.has_tx_permission(r.transaction_id, 'transaction.view'))
  ));

-- ----------------------------------------------------------------------------- messaging
create policy "threads: room members or direct members" on public.message_threads for select to authenticated
  using (
    public.has_tx_permission(transaction_id, 'transaction.view')
    and (kind <> 'direct' or auth.uid() = any (member_user_ids))
  );
create policy "messages: via thread" on public.messages for select to authenticated
  using (exists (
    select 1 from public.message_threads th where th.id = thread_id
      and public.has_tx_permission(th.transaction_id, 'transaction.view')
      and (th.kind <> 'direct' or auth.uid() = any (th.member_user_ids))
  ));
grant insert (thread_id, transaction_id, author_id, kind, body, mentions, attachment_document_ids) on public.messages to authenticated;
create policy "messages: participants post as themselves" on public.messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and kind = 'user'
    and public.has_tx_permission(transaction_id, 'message.send')
    and exists (
      select 1 from public.message_threads th where th.id = thread_id and th.transaction_id = messages.transaction_id
        and th.kind <> 'system' and (th.kind <> 'direct' or auth.uid() = any (th.member_user_ids))
    )
  );
grant select, insert (message_id, user_id) on public.message_reads to authenticated;
create policy "message_reads: own" on public.message_reads for select to authenticated using (user_id = auth.uid());
create policy "message_reads: mark own" on public.message_reads for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id));

-- ----------------------------------------------------------------------------- notifications & preferences
create policy "notifications: own" on public.notifications for select to authenticated using (user_id = auth.uid());
grant update (read_at) on public.notifications to authenticated;
create policy "notifications: mark own read" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant insert (user_id, kind, in_app, email, sms), update (in_app, email, sms) on public.notification_preferences to authenticated;
create policy "notification_preferences: own read" on public.notification_preferences for select to authenticated using (user_id = auth.uid());
create policy "notification_preferences: own insert" on public.notification_preferences for insert to authenticated with check (user_id = auth.uid());
create policy "notification_preferences: own update" on public.notification_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------- audit & platform
create policy "audit: authorized viewers" on public.audit_events for select to authenticated
  using (
    (transaction_id is not null and public.has_tx_permission(transaction_id, 'audit.view'))
    or (transaction_id is null and actor_id = auth.uid())
  );
create policy "feature_flags: read" on public.feature_flags for select to authenticated using (true);
grant select on public.plans to anon;
create policy "plans: public catalogue" on public.plans for select to anon, authenticated using (active);
create policy "billing_accounts: own or org admin" on public.billing_accounts for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.organization_members om where om.organization_id = billing_accounts.organization_id
               and om.user_id = auth.uid() and om.role = 'organization_admin')
  );
create policy "subscriptions: via billing account" on public.subscriptions for select to authenticated
  using (exists (
    select 1 from public.billing_accounts b where b.id = billing_account_id and (
      b.user_id = auth.uid()
      or exists (select 1 from public.organization_members om where om.organization_id = b.organization_id
                 and om.user_id = auth.uid() and om.role = 'organization_admin'))
  ));
grant insert (user_id, purpose, granted, policy_version) on public.consent_records to authenticated;
create policy "consent: own read" on public.consent_records for select to authenticated using (user_id = auth.uid());
create policy "consent: own insert" on public.consent_records for insert to authenticated with check (user_id = auth.uid());

-- No policies (service role only): integrations, integration_credentials, bank_connection_secrets,
-- webhook_events, domain_events, idempotency_keys, security_signals, mfa_recovery_codes.
