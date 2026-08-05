-- Expose company feed thread for code-login field workers (anon cannot read message_threads via RLS).

set search_path = public;
create or replace function public.employee_get_company_feed_thread(
  p_company_id uuid,
  p_employee_id uuid
)
returns setof public.message_threads
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_id uuid;
begin
  if not public._employee_valid(p_company_id, p_employee_id) then
    return;
  end if;

  v_id := public._company_feed_thread_id(p_company_id);

  return query
  select t.*
  from public.message_threads t
  where t.id = v_id;
end;
$$;
grant execute on function public.employee_get_company_feed_thread(uuid, uuid)
  to anon, authenticated;
