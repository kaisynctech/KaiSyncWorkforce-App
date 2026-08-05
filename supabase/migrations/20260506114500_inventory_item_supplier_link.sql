alter table public.inventory_items
  add column if not exists supplier_contractor_id bigint references public.contractors(id) on delete set null;
alter table public.inventory_items
  add column if not exists supplier_name text;
create index if not exists idx_inventory_items_supplier_contractor
  on public.inventory_items(supplier_contractor_id);
