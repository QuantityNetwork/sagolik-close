-- Business acquisitions (beta): the company being bought. Its premises stay in
-- public.properties (every business operates from an address); the entity,
-- deal structure and seller-reported figures live here.

create table public.companies (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid references public.organizations (id),
  legal_name         text not null check (length(legal_name) between 2 and 200),
  trade_name         text check (length(trade_name) <= 200),
  entity_type        text not null check (entity_type in ('llc', 'c_corporation', 's_corporation', 'partnership', 'sole_proprietorship')),
  state_of_formation char(2) not null check (state_of_formation ~ '^[A-Z]{2}$'),
  industry           text not null check (length(industry) between 2 and 120),
  description        text check (length(description) <= 2000),
  employee_count     integer check (employee_count >= 0),
  -- Figures as reported by the seller; verified (or not) during due diligence.
  annual_revenue     bigint check (annual_revenue >= 0),
  deal_structure     text not null check (deal_structure in ('asset_purchase', 'stock_purchase', 'membership_interest_purchase')),
  website            text check (website ~ '^https://'),
  currency           public.currency_code not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger set_updated_at before update on public.companies for each row execute function public.set_updated_at();

alter table public.transactions add column company_id uuid references public.companies (id);
alter table public.transactions add constraint transactions_business_has_company
  check ((type = 'business_acquisition') = (company_id is not null));
create index transactions_company on public.transactions (company_id) where company_id is not null;

alter table public.companies enable row level security;
alter table public.companies force row level security;
revoke insert, update, delete, truncate on public.companies from anon, authenticated;
revoke all on public.companies from anon;
grant select on public.companies to authenticated;
create policy "companies: via transaction" on public.companies for select to authenticated
  using (exists (select 1 from public.transactions t where t.company_id = companies.id and public.has_tx_permission(t.id, 'transaction.view')));
