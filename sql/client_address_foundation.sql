set search_path = public;

alter table public.clients
  add column if not exists address text;

