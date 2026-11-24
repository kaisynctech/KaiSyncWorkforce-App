-- 20261124130000_fix_removed_table_references
-- Several functions and 22 security policies still pointed at tables that were removed long ago
-- (hr_users, inventory_allocations, visibility_grants, work_team_members, contractor_members, ...).
-- Anything that reached them failed with "relation ... does not exist".
--
--  1. Reports -> Inventory: "On Jobs" counted rows in inventory_allocations (gone), so the whole
--     inventory report failed. It now counts stock issued to jobs from inventory_usage.
--  2. resume_same_day_shift and hr_reset_employee_pin: drop the dead hr_users check (it could never
--     match); everything else is unchanged.
--  3. current_hr_company_id(): read hr_users, used by 22 policies on old tables. It now returns NULL,
--     which is what it effectively meant (no hr_users rows exist), so those policies deny cleanly
--     instead of erroring. No access is added or removed.
--  4. Old bigint-era functions that nothing calls: EXECUTE is removed for anon / authenticated /
--     PUBLIC (kept for service_role). They are NOT deleted.
--  5. 13 older tables: the anonymous role loses table rights it never needed (row security already
--     blocked it). app_release_config keeps anonymous SELECT (it has a read policy for anon).
--
-- Every changed function is backed up in public._fn_backup first (name starts 'before 20261124130000').
-- Undo: supabase/maintenance/20261124130000_fix_removed_table_references.undo.sql

-- 0. Backups ----------------------------------------------------------------
INSERT INTO public._fn_backup (name, def, saved_at)
SELECT 'before 20261124130000: ' || p.oid::regprocedure::text, pg_get_functiondef(p.oid), now()
FROM pg_proc p
WHERE p.oid IN (
  'public.hr_get_inventory_snapshot(uuid,date,date)'::regprocedure,
  'public.resume_same_day_shift(uuid,uuid,text)'::regprocedure,
  'public.hr_reset_employee_pin(uuid)'::regprocedure,
  'public.current_hr_company_id()'::regprocedure
);

INSERT INTO public._fn_backup (name, def, saved_at)
SELECT 'before 20261124130000 grants: ' || p.oid::regprocedure::text,
       string_agg(format('GRANT EXECUTE ON FUNCTION %s TO %s;', p.oid::regprocedure,
                         CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END), E'\n'),
       now()
FROM pg_proc p
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
LEFT JOIN pg_roles r ON r.oid = a.grantee
WHERE a.privilege_type = 'EXECUTE'
  AND p.oid IN (
    'public.auth_active_hr_company_ids()'::regprocedure,
    'public.has_hr_role_permission(bigint,text)'::regprocedure,
    'public.employee_get_work_teams(bigint,bigint)'::regprocedure,
    'public.employee_has_contractor_job_scope(bigint,bigint,bigint)'::regprocedure,
    'public.employee_submit_leave_request(bigint,bigint,text,date,date,boolean,boolean,integer,text)'::regprocedure,
    'public.has_employee_mandatory_compliance(bigint,bigint)'::regprocedure,
    'public.shift_assignment_score(bigint,bigint,bigint)'::regprocedure,
    'public.invite_worker_actor_authorized(bigint,uuid,text)'::regprocedure,
    'public.is_visible_to_me(text,bigint,bigint)'::regprocedure,
    'public.is_visible_to_me(text,uuid,uuid)'::regprocedure,
    'public.job_checklist_insert_item(bigint,bigint,text,text,text,bigint)'::regprocedure,
    'public.job_checklist_list(bigint,bigint)'::regprocedure,
    'public.job_checklist_set_completed(bigint,bigint,boolean,bigint,text)'::regprocedure,
    'public.transfer_company_owner_employee(bigint,bigint)'::regprocedure,
    'public.transfer_hr_company_owner(bigint,uuid)'::regprocedure,
    'public.sync_job_labor_cost_from_entries()'::regprocedure)
GROUP BY p.oid;

INSERT INTO public._fn_backup (name, def, saved_at)
SELECT 'before 20261124130000 table grants: ' || g.table_name,
       string_agg(format('GRANT %s ON public.%I TO anon;', g.privilege_type, g.table_name), E'\n'),
       now()
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'public' AND g.grantee = 'anon'
  AND g.table_name IN ('app_release_config','client_portal_events','client_portal_tokens','form_approvals',
    'handover_packs','integration_endpoints','notification_queue','operational_escalation_events',
    'operational_escalation_rules','scheduled_exports','shift_assignments','submission_recipients','xero_oauth_states')
GROUP BY g.table_name;

-- 1. Reports -> Inventory ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_get_inventory_snapshot(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._reports_office(p_company_id);
  RETURN jsonb_build_object(
    'total_items', (SELECT COUNT(*) FROM inventory_items WHERE company_id = p_company_id),
    'low_stock', (
      SELECT COUNT(*) FROM inventory_items
      WHERE company_id = p_company_id
        AND COALESCE(quantity_on_hand, 0) <= COALESCE(reorder_level, 0)
    ),
    'stock_value', (
      SELECT COALESCE(SUM(COALESCE(quantity_on_hand, 0) * COALESCE(unit_cost, 0)), 0)
      FROM inventory_items WHERE company_id = p_company_id
    ),
    -- Stock issued to jobs (inventory_usage replaced the old inventory_allocations table).
    'on_jobs', (
      SELECT COUNT(*) FROM inventory_usage WHERE company_id = p_company_id
    ),
    'top_items', COALESCE((
      SELECT jsonb_agg(row_obj)
      FROM (
        SELECT jsonb_build_object(
          'name', name,
          'qty', COALESCE(quantity_on_hand, 0),
          'value', COALESCE(quantity_on_hand, 0) * COALESCE(unit_cost, 0)
        ) AS row_obj
        FROM inventory_items
        WHERE company_id = p_company_id
        ORDER BY COALESCE(quantity_on_hand, 0) * COALESCE(unit_cost, 0) DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb)
  );
END;
$function$;

-- 2a. Continue-shift: remove the dead hr_users check -------------------------
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.resume_same_day_shift(uuid,uuid,text)'::regprocedure);
  v_new := regexp_replace(v_def,
    E'\\s*ELSIF auth\\.uid\\(\\) IS NOT NULL AND EXISTS \\(\\s*SELECT 1 FROM public\\.hr_users h\\s*WHERE h\\.user_id = auth\\.uid\\(\\) AND h\\.company_id = p_company_id\\s*\\) THEN\\s*v_allowed := true;',
    '');
  IF v_new = v_def OR position('hr_users' in v_new) > 0 THEN
    RAISE EXCEPTION 'resume_same_day_shift: hr_users check not found as expected - nothing changed';
  END IF;
  EXECUTE v_new;
END $patch$;

-- 2b. Reset PIN: remove the dead hr_users check ------------------------------
CREATE OR REPLACE FUNCTION public.hr_reset_employee_pin(p_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp employees%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found' USING ERRCODE = '42501';
  END IF;

  -- Caller must be in the same company with elevated access
  IF NOT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.user_id    = auth.uid()
      AND e.company_id = v_emp.company_id
      AND e.access_level IN ('owner', 'hr_admin', 'admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'Not authorized to reset employee PINs'
      USING ERRCODE = '42501';
  END IF;

  -- Clear PIN state
  UPDATE public.employees
  SET pin_hash            = NULL,
      pin_set_at          = NULL,
      pin_reset_required  = true,
      pin_failed_attempts = 0,
      pin_locked_until    = NULL
  WHERE id = p_employee_id;

  -- Revoke all active sessions so the employee must re-authenticate
  UPDATE public.employee_code_sessions
  SET revoked_at = now()
  WHERE employee_id = p_employee_id
    AND revoked_at IS NULL;
END;
$function$;

-- 3. current_hr_company_id(): hr_users no longer exists -> no HR company ----
CREATE OR REPLACE FUNCTION public.current_hr_company_id()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- hr_users was removed; no caller can be an hr_users member, so there is no HR company.
  SELECT NULL::bigint
$function$;

-- 4. Old bigint-era functions nothing calls: no API access ------------------
REVOKE EXECUTE ON FUNCTION public.auth_active_hr_company_ids() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_hr_role_permission(bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.employee_get_work_teams(bigint,bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.employee_has_contractor_job_scope(bigint,bigint,bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.employee_submit_leave_request(bigint,bigint,text,date,date,boolean,boolean,integer,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_employee_mandatory_compliance(bigint,bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shift_assignment_score(bigint,bigint,bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invite_worker_actor_authorized(bigint,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_visible_to_me(text,bigint,bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_visible_to_me(text,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.job_checklist_insert_item(bigint,bigint,text,text,text,bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.job_checklist_list(bigint,bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.job_checklist_set_completed(bigint,bigint,boolean,bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transfer_company_owner_employee(bigint,bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transfer_hr_company_owner(bigint,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_job_labor_cost_from_entries() FROM PUBLIC, anon, authenticated;

-- 5. Older tables: no anonymous table rights ---------------------------------
REVOKE ALL ON public.client_portal_events, public.client_portal_tokens, public.form_approvals,
  public.handover_packs, public.integration_endpoints, public.notification_queue,
  public.operational_escalation_events, public.operational_escalation_rules, public.scheduled_exports,
  public.shift_assignments, public.submission_recipients, public.xero_oauth_states FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.app_release_config FROM anon;

NOTIFY pgrst, 'reload schema';
