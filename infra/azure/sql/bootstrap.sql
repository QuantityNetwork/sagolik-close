-- =============================================================================
-- Platform objects the migrations expect, for PostgreSQL without Supabase
-- (Azure Database for PostgreSQL 16+). Idempotent: safe to run before every
-- migration batch. Run by the migration identity (a member of azure_pg_admin).
--
--  * Roles the row-level security policies are written for:
--      anon           no access (kept so the migrations' grants and revokes apply)
--      authenticated  a person's reads: policies decide every row
--      service_role   the service layer's writes, after it has authorized them (BYPASSRLS)
--    None of them can log in. Workload identities log in and are granted
--    membership (see the migrate command's --grant option).
--  * auth.uid() / auth.jwt(): read the claims the app sets per transaction
--    (request.jwt.claims), exactly like Supabase.
--  * auth.users: one row per person, keyed by their identity provider's
--    object id. profiles.id references it.
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table if not exists auth.users (
  id         uuid primary key,
  email      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Only the service layer reads or writes identities.
revoke all on auth.users from anon, authenticated;
grant select, insert, update on auth.users to service_role;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;

-- Tables the migrations create get the same API-role grants Supabase gives by
-- default; row-level security (forced on every table) then decides.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Bookkeeping for the migration runner, outside the API's reach.
create schema if not exists migrations;
revoke all on schema migrations from public;
create table if not exists migrations.applied (
  name       text primary key,
  sha256     text not null,
  applied_at timestamptz not null default now()
);
