alter table public.contractors
  add column if not exists partner_kind text not null default 'contractor';
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'contractors_partner_kind_chk'
      and conrelid = 'public.contractors'::regclass
  ) then
    alter table public.contractors
      add constraint contractors_partner_kind_chk
      check (partner_kind in ('contractor', 'supplier', 'both'));
  end if;
end
$$;
update public.contractors
set partner_kind = 'contractor'
where partner_kind is null
   or trim(partner_kind) = '';
