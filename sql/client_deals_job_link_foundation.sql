set search_path = public;

alter table public.client_deals
  add column if not exists job_id bigint references public.jobs(id) on delete set null;

create index if not exists idx_client_deals_company_job
  on public.client_deals(company_id, job_id);

