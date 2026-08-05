set search_path = public;
-- ---------------------------------------------------------------------------
-- Client portal (shareable token), job progress updates, complaints, and
-- professional job-card checklists (service vs inspection line items).
-- ---------------------------------------------------------------------------

-- Shareable portal link (multi-use until expiry). Distinct from one-shot
-- job_feedback.request_token used only for the legacy HTML feedback form.
create table if not exists public.job_portal_tokens (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  job_id bigint not null references public.jobs(id) on delete cascade,
  token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint job_portal_tokens_token_len_chk check (char_length(token) >= 16),
  constraint uq_job_portal_tokens_token unique (token)
);
create index if not exists idx_job_portal_tokens_job
  on public.job_portal_tokens(company_id, job_id);
alter table public.job_portal_tokens enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polname = 'p_job_portal_tokens_hr_company') then
    create policy p_job_portal_tokens_hr_company on public.job_portal_tokens
      for all using (company_id = current_hr_company_id())
      with check (company_id = current_hr_company_id());
  end if;
end $$;
grant select, insert, delete on public.job_portal_tokens to authenticated;
-- Timeline visible to clients (and HR). "internal" rows are HR-only notes.
create table if not exists public.job_client_updates (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  job_id bigint not null references public.jobs(id) on delete cascade,
  body text not null,
  visibility text not null default 'client'
    constraint job_client_updates_visibility_chk check (visibility in ('client', 'internal')),
  source text not null default 'hr'
    constraint job_client_updates_source_chk check (source in ('hr', 'worker', 'system')),
  employee_id bigint references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_job_client_updates_job_time
  on public.job_client_updates(company_id, job_id, created_at desc);
alter table public.job_client_updates enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polname = 'p_job_client_updates_hr_company') then
    create policy p_job_client_updates_hr_company on public.job_client_updates
      for all using (company_id = current_hr_company_id())
      with check (company_id = current_hr_company_id());
  end if;
end $$;
grant select, insert, update, delete on public.job_client_updates to authenticated;
-- Client complaints / issues filed from the portal (HR triage).
create table if not exists public.job_client_complaints (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  job_id bigint not null references public.jobs(id) on delete cascade,
  subject text not null,
  body text not null,
  client_email text,
  status text not null default 'open'
    constraint job_client_complaints_status_chk check (status in ('open', 'acknowledged', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_note text
);
create index if not exists idx_job_client_complaints_job
  on public.job_client_complaints(company_id, job_id, created_at desc);
alter table public.job_client_complaints enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polname = 'p_job_client_complaints_hr_company') then
    create policy p_job_client_complaints_hr_company on public.job_client_complaints
      for all using (company_id = current_hr_company_id())
      with check (company_id = current_hr_company_id());
  end if;
end $$;
grant select, insert, update, delete on public.job_client_complaints to authenticated;
-- Checklist rows on the job card (service vs inspection).
create table if not exists public.job_checklist_items (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  job_id bigint not null references public.jobs(id) on delete cascade,
  kind text not null default 'service'
    constraint job_checklist_items_kind_chk check (kind in ('service', 'inspection')),
  title text not null,
  description text,
  sort_order int not null default 0,
  completed_at timestamptz,
  completed_by_employee_id bigint references public.employees(id) on delete set null,
  worker_comment text,
  created_at timestamptz not null default now()
);
create index if not exists idx_job_checklist_items_job
  on public.job_checklist_items(company_id, job_id, sort_order, id);
alter table public.job_checklist_items enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polname = 'p_job_checklist_items_hr_company') then
    create policy p_job_checklist_items_hr_company on public.job_checklist_items
      for all using (company_id = current_hr_company_id())
      with check (company_id = current_hr_company_id());
  end if;
end $$;
grant select, insert, update, delete on public.job_checklist_items to authenticated;
-- ---------------------------------------------------------------------------
-- RPC: HR or assigned worker inserts a checklist line.
-- ---------------------------------------------------------------------------
create or replace function public.job_checklist_insert_item(
  p_company_id bigint,
  p_job_id bigint,
  p_kind text,
  p_title text,
  p_description text,
  p_employee_id bigint
) returns bigint
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_hr boolean;
  v_ok boolean;
  v_sort int;
  v_new_id bigint;
  v_kind text := lower(trim(coalesce(p_kind, 'service')));
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select exists (
    select 1 from public.hr_users h
    where h.company_id = p_company_id
      and h.auth_user_id = auth.uid()
      and coalesce(h.is_active, true)
  ) into v_hr;

  if not coalesce(v_hr, false) then
    select exists (
      select 1 from public.jobs j
      where j.id = p_job_id
        and j.company_id = p_company_id
        and (
          j.assigned_employee_ids @> array[p_employee_id]
          or j.assignee_employee_id = p_employee_id
          or j.contractor_employee_id = p_employee_id
        )
    ) into v_ok;
    if not coalesce(v_ok, false) then
      raise exception 'Not authorized to edit this job checklist';
    end if;
  end if;

  if v_kind not in ('service', 'inspection') then
    raise exception 'Invalid checklist kind';
  end if;
  if nullif(trim(p_title), '') is null then
    raise exception 'Title is required';
  end if;

  select coalesce(max(sort_order), 0) + 1
    into v_sort
  from public.job_checklist_items
  where company_id = p_company_id and job_id = p_job_id;

  insert into public.job_checklist_items (
    company_id, job_id, kind, title, description, sort_order
  ) values (
    p_company_id,
    p_job_id,
    v_kind,
    trim(p_title),
    nullif(trim(coalesce(p_description, '')), ''),
    coalesce(v_sort, 0)
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;
revoke all on function public.job_checklist_insert_item(bigint, bigint, text, text, text, bigint) from public;
grant execute on function public.job_checklist_insert_item(bigint, bigint, text, text, text, bigint) to authenticated;
-- ---------------------------------------------------------------------------
-- RPC: HR or assigned worker toggles completion + optional worker comment.
-- ---------------------------------------------------------------------------
create or replace function public.job_checklist_set_completed(
  p_company_id bigint,
  p_item_id bigint,
  p_completed boolean,
  p_employee_id bigint,
  p_worker_comment text
) returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_job_id bigint;
  v_hr boolean;
  v_ok boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select c.job_id into v_job_id
  from public.job_checklist_items c
  where c.id = p_item_id and c.company_id = p_company_id;

  if v_job_id is null then
    raise exception 'Checklist item not found';
  end if;

  select exists (
    select 1 from public.hr_users h
    where h.company_id = p_company_id
      and h.auth_user_id = auth.uid()
      and coalesce(h.is_active, true)
  ) into v_hr;

  if not coalesce(v_hr, false) then
    if p_employee_id is null then
      raise exception 'Employee id required';
    end if;
    select exists (
      select 1 from public.jobs j
      where j.id = v_job_id
        and j.company_id = p_company_id
        and (
          j.assigned_employee_ids @> array[p_employee_id]
          or j.assignee_employee_id = p_employee_id
          or j.contractor_employee_id = p_employee_id
        )
    ) into v_ok;
    if not coalesce(v_ok, false) then
      raise exception 'Not authorized';
    end if;
  end if;

  update public.job_checklist_items c
  set
    completed_at = case when p_completed then now() else null end,
    completed_by_employee_id = case
      when not p_completed then null
      when coalesce(v_hr, false) then nullif(p_employee_id, 0::bigint)
      else p_employee_id
    end,
    worker_comment = case
      when p_completed then nullif(trim(coalesce(p_worker_comment, '')), '')
      else c.worker_comment
    end
  where c.id = p_item_id and c.company_id = p_company_id;
end;
$$;
revoke all on function public.job_checklist_set_completed(bigint, bigint, boolean, bigint, text) from public;
grant execute on function public.job_checklist_set_completed(bigint, bigint, boolean, bigint, text) to authenticated;
-- Edge Functions use service_role for portal reads/writes.
grant select, insert, update, delete on public.job_portal_tokens to service_role;
grant select, insert on public.job_client_updates to service_role;
grant select, insert, update on public.job_client_complaints to service_role;
grant select on public.job_checklist_items to service_role;
grant select on public.jobs to service_role;
grant select on public.clients to service_role;
-- ---------------------------------------------------------------------------
-- RPC: list checklist rows for HR or anyone assigned to the job.
-- ---------------------------------------------------------------------------
create or replace function public.job_checklist_list(p_company_id bigint, p_job_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_ok boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select exists(
    select 1 from public.hr_users h
    where h.company_id = p_company_id
      and h.auth_user_id = auth.uid()
      and coalesce(h.is_active, true)
  ) or exists(
    select 1
    from public.employees e
    join public.jobs j
      on j.company_id = p_company_id
     and j.id = p_job_id
    where e.profile_id = auth.uid()
      and e.company_id = p_company_id
      and (
        j.assigned_employee_ids @> array[e.id]
        or j.assignee_employee_id = e.id
        or j.contractor_employee_id = e.id
      )
  )
  into v_ok;

  if not coalesce(v_ok, false) then
    raise exception 'Not authorized to view this checklist';
  end if;

  return coalesce(
    (
      select jsonb_agg(to_jsonb(c) order by c.sort_order, c.id)
      from public.job_checklist_items c
      where c.company_id = p_company_id
        and c.job_id = p_job_id
    ),
    '[]'::jsonb
  );
end;
$$;
revoke all on function public.job_checklist_list(bigint, bigint) from public;
grant execute on function public.job_checklist_list(bigint, bigint) to authenticated;
