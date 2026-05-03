set search_path = public;

alter table public.client_notes
  add column if not exists deal_id bigint references public.client_deals(id) on delete set null;

alter table public.client_files
  add column if not exists deal_id bigint references public.client_deals(id) on delete set null;

create index if not exists idx_client_notes_company_client_deal
  on public.client_notes(company_id, client_id, deal_id);

create index if not exists idx_client_files_company_client_deal
  on public.client_files(company_id, client_id, deal_id);

