-- App/DB alignment repair migration
-- Safe to run multiple times.
-- Applies compatibility fixes between Flutter app expectations and live Supabase schema.

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1) HR profile compatibility
-- ---------------------------------------------------------------------------

alter table public.hr_users
  add column if not exists display_name text;

-- Normalize any legacy role values before enforcing/refreshing role constraint.
update public.hr_users
set role = 'admin'
where role is null
   or role = ''
   or role = 'hr_admin'
   or role = 'hr';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'hr_users_role_chk'
      and conrelid = 'public.hr_users'::regclass
  ) then
    alter table public.hr_users
      drop constraint hr_users_role_chk;
  end if;

  alter table public.hr_users
    add constraint hr_users_role_chk
    check (role in ('owner', 'admin', 'manager', 'payroll', 'viewer'));
exception
  when duplicate_object then
    null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Self-registration RPC expected by app
-- ---------------------------------------------------------------------------

create sequence if not exists public.company_code_seq;

do $$
declare
  v_start bigint;
begin
  select coalesce(max(company_code::int), 0) + 1
    into v_start
  from public.companies
  where company_code ~ '^[0-9]+$';

  if v_start < 1 then
    v_start := 1;
  end if;

  perform setval('public.company_code_seq', v_start, false);
exception
  when others then
    null;
end;
$$;

drop function if exists public.self_register_company(text);
create or replace function public.self_register_company(
  p_company_name text
)
returns table (
  company_id bigint,
  company_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_code text;
  v_company_id bigint;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'You must be signed in to register a company.';
  end if;

  if p_company_name is null or btrim(p_company_name) = '' then
    raise exception 'Company name is required.';
  end if;

  if exists (
    select 1
    from public.hr_users h
    where h.auth_user_id = v_uid
      and h.is_active = true
  ) then
    raise exception 'This HR account is already mapped to a company.';
  end if;

  loop
    v_code := lpad(nextval('public.company_code_seq')::text, 2, '0');
    begin
      insert into public.companies (name, company_code, plan_code, trial_started_at)
      values (btrim(p_company_name), v_code, 'free_trial', now())
      returning id into v_company_id;
      exit;
    exception
      when unique_violation then
        continue;
    end;
  end loop;

  insert into public.hr_users (
    auth_user_id,
    company_id,
    role,
    is_active
  ) values (
    v_uid,
    v_company_id,
    'admin',
    true
  );

  return query select v_company_id, v_code;
end;
$$;

grant execute on function public.self_register_company(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Employee RPC compatibility fixes
-- ---------------------------------------------------------------------------

-- Missing function used by app.
drop function if exists public.employee_update_punch_notes(bigint, bigint, date, text);
create or replace function public.employee_update_punch_notes(
  p_company_id bigint,
  p_employee_id bigint,
  p_date date,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.punches p
  set "Notes" = p_notes
  where p.company_id = p_company_id
    and p.employees_id = p_employee_id
    and p."Date" = p_date;

  if not found then
    raise exception 'No punch session found for employee/date in company';
  end if;
end;
$$;

grant execute on function public.employee_update_punch_notes(bigint, bigint, date, text) to anon, authenticated;

-- App sends p_job_id and p_site_id.
drop function if exists public.employee_insert_incident(bigint, bigint, text, text, text, timestamptz, text[]);
drop function if exists public.employee_insert_incident(bigint, bigint, text, bigint, bigint, text, text, timestamptz, text[]);
create or replace function public.employee_insert_incident(
  p_company_id bigint,
  p_employee_id bigint,
  p_employee_code text default null,
  p_job_id bigint default null,
  p_site_id bigint default null,
  p_description text default null,
  p_severity text default null,
  p_created_at timestamptz default now(),
  p_photo_urls text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id bigint;
begin
  select e.id into v_employee_id
  from public.employees e
  where e.company_id = p_company_id
    and (
      (p_employee_id is not null and e.id = p_employee_id) or
      (p_employee_id is null and p_employee_code is not null and e.employee_code = p_employee_code)
    )
  limit 1;

  if v_employee_id is null then
    raise exception 'Employee not found for this company';
  end if;

  insert into public.incidents (
    company_id,
    employee_id,
    job_id,
    site_id,
    description,
    severity,
    created_at,
    photo_urls
  )
  values (
    p_company_id,
    v_employee_id,
    p_job_id,
    p_site_id,
    coalesce(p_description, ''),
    p_severity,
    coalesce(p_created_at, now()),
    coalesce(p_photo_urls, '{}')
  );
end;
$$;

grant execute on function public.employee_insert_incident(bigint, bigint, text, bigint, bigint, text, text, timestamptz, text[]) to anon, authenticated;

-- App uses 'scheduled' in addition to in_progress/completed/cancelled.
drop function if exists public.employee_update_job_status(bigint, bigint, bigint, text);
create or replace function public.employee_update_job_status(
  p_company_id bigint,
  p_employee_id bigint,
  p_job_id bigint,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('pending', 'scheduled', 'in_progress', 'completed', 'cancelled') then
    raise exception 'Invalid job status';
  end if;

  update public.jobs j
  set status = p_status
  where j.id = p_job_id
    and j.company_id = p_company_id
    and j.assigned_employee_ids @> array[p_employee_id];

  if not found then
    raise exception 'Not allowed to update this job';
  end if;
end;
$$;

grant execute on function public.employee_update_job_status(bigint, bigint, bigint, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) RLS policy completion for app-used tables missing policies
-- ---------------------------------------------------------------------------

alter table public.form_templates enable row level security;
alter table public.form_submissions enable row level security;
alter table public.form_approvals enable row level security;
alter table public.document_files enable row level security;
alter table public.compliance_requirements enable row level security;
alter table public.employee_compliance_records enable row level security;
alter table public.handover_packs enable row level security;
alter table public.scheduled_exports enable row level security;
alter table public.integration_endpoints enable row level security;
alter table public.automation_rules enable row level security;
alter table public.notification_events enable row level security;
alter table public.shift_templates enable row level security;
alter table public.shift_events enable row level security;
alter table public.notification_queue enable row level security;
alter table public.employee_job_requests enable row level security;

drop policy if exists p_form_templates_hr_company_all on public.form_templates;
create policy p_form_templates_hr_company_all on public.form_templates
for all to authenticated
using (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = form_templates.company_id
  )
)
with check (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = form_templates.company_id
  )
);

drop policy if exists p_form_submissions_hr_company_all on public.form_submissions;
create policy p_form_submissions_hr_company_all on public.form_submissions
for all to authenticated
using (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = form_submissions.company_id
  )
)
with check (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = form_submissions.company_id
  )
);

drop policy if exists p_form_approvals_hr_company_all on public.form_approvals;
create policy p_form_approvals_hr_company_all on public.form_approvals
for all to authenticated
using (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = form_approvals.company_id
  )
)
with check (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = form_approvals.company_id
  )
);

drop policy if exists p_document_files_hr_company_all on public.document_files;
create policy p_document_files_hr_company_all on public.document_files
for all to authenticated
using (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = document_files.company_id
  )
)
with check (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = document_files.company_id
  )
);

drop policy if exists p_compliance_requirements_hr_company_all on public.compliance_requirements;
create policy p_compliance_requirements_hr_company_all on public.compliance_requirements
for all to authenticated
using (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = compliance_requirements.company_id
  )
)
with check (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = compliance_requirements.company_id
  )
);

drop policy if exists p_employee_compliance_records_hr_company_all on public.employee_compliance_records;
create policy p_employee_compliance_records_hr_company_all on public.employee_compliance_records
for all to authenticated
using (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = employee_compliance_records.company_id
  )
)
with check (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = employee_compliance_records.company_id
  )
);

drop policy if exists p_handover_packs_hr_company_all on public.handover_packs;
create policy p_handover_packs_hr_company_all on public.handover_packs
for all to authenticated
using (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = handover_packs.company_id
  )
)
with check (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = handover_packs.company_id
  )
);

drop policy if exists p_scheduled_exports_hr_company_all on public.scheduled_exports;
create policy p_scheduled_exports_hr_company_all on public.scheduled_exports
for all to authenticated
using (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = scheduled_exports.company_id
  )
)
with check (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = scheduled_exports.company_id
  )
);

drop policy if exists p_integration_endpoints_hr_company_all on public.integration_endpoints;
create policy p_integration_endpoints_hr_company_all on public.integration_endpoints
for all to authenticated
using (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = integration_endpoints.company_id
  )
)
with check (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = integration_endpoints.company_id
  )
);

drop policy if exists p_automation_rules_hr_company_all on public.automation_rules;
create policy p_automation_rules_hr_company_all on public.automation_rules
for all to authenticated
using (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = automation_rules.company_id
  )
)
with check (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = automation_rules.company_id
  )
);

drop policy if exists p_notification_events_hr_company_all on public.notification_events;
create policy p_notification_events_hr_company_all on public.notification_events
for all to authenticated
using (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = notification_events.company_id
  )
)
with check (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = notification_events.company_id
  )
);

drop policy if exists p_shift_templates_hr_company_all on public.shift_templates;
create policy p_shift_templates_hr_company_all on public.shift_templates
for all to authenticated
using (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = shift_templates.company_id
  )
)
with check (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = shift_templates.company_id
  )
);

drop policy if exists p_shift_events_hr_company_all on public.shift_events;
create policy p_shift_events_hr_company_all on public.shift_events
for all to authenticated
using (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = shift_events.company_id
  )
)
with check (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = shift_events.company_id
  )
);

drop policy if exists p_notification_queue_hr_company_all on public.notification_queue;
create policy p_notification_queue_hr_company_all on public.notification_queue
for all to authenticated
using (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = notification_queue.company_id
  )
)
with check (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = notification_queue.company_id
  )
);

drop policy if exists p_employee_job_requests_hr_company_all on public.employee_job_requests;
create policy p_employee_job_requests_hr_company_all on public.employee_job_requests
for all to authenticated
using (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = employee_job_requests.company_id
  )
)
with check (
  exists (
    select 1 from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = employee_job_requests.company_id
  )
);

grant select, insert, update, delete on public.form_templates to authenticated;
grant select, insert, update, delete on public.form_submissions to authenticated;
grant select, insert, update, delete on public.form_approvals to authenticated;
grant select, insert, update, delete on public.document_files to authenticated;
grant select, insert, update, delete on public.compliance_requirements to authenticated;
grant select, insert, update, delete on public.employee_compliance_records to authenticated;
grant select, insert, update, delete on public.handover_packs to authenticated;
grant select, insert, update, delete on public.scheduled_exports to authenticated;
grant select, insert, update, delete on public.integration_endpoints to authenticated;
grant select, insert, update, delete on public.automation_rules to authenticated;
grant select, insert, update, delete on public.notification_events to authenticated;
grant select, insert, update, delete on public.shift_templates to authenticated;
grant select, insert, update, delete on public.shift_events to authenticated;
grant select, insert, update, delete on public.notification_queue to authenticated;
grant select, insert, update, delete on public.employee_job_requests to authenticated;
