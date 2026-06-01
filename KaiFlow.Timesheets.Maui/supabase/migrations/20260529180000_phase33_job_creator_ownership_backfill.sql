-- Phase 3.3: backfill created_by_employee_id for employee-created jobs missing creator audit.

set search_path = public;

-- Jobs created via employee_create_job always include creator in assigned_employee_ids.
-- Legacy rows may have null created_by_employee_id while assignee is the creator.
update public.jobs j
set created_by_employee_id = j.assignee_employee_id
where j.created_by_employee_id is null
  and j.assignee_employee_id is not null
  and j.assigned_employee_ids @> array[j.assignee_employee_id]
  and array_length(j.assigned_employee_ids, 1) = 1;

-- When creator is first in team array and assignee matches, infer creator for small teams.
update public.jobs j
set created_by_employee_id = j.assigned_employee_ids[1]
where j.created_by_employee_id is null
  and array_length(j.assigned_employee_ids, 1) >= 1
  and j.assignee_employee_id = j.assigned_employee_ids[1]
  and not exists (
    select 1 from public.jobs j2
    where j2.id = j.id and j2.created_by_employee_id is not null
  );
