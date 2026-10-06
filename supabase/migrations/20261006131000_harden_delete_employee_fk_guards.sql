-- Harden delete_employee against remaining employee FK blockers.
-- After stock_adjustments SET NULL works, other NO ACTION FKs can still block.
-- Policy: clear optional "actor/assignee" refs; refuse delete when historical
-- operational rows still require the employee (leave, payroll, labor, etc.).

CREATE OR REPLACE FUNCTION public.delete_employee(
  p_company_id  uuid,
  p_employee_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_blockers text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: owner or hr required to delete employees'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT to_jsonb(e) INTO v_before
  FROM employees e
  WHERE e.id = p_employee_id AND e.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found in this company' USING ERRCODE = 'P0002';
  END IF;

  -- Soft-clear optional assignee / actor refs (safe; rows remain).
  UPDATE public.work_teams
  SET leader_employee_id = NULL
  WHERE company_id = p_company_id AND leader_employee_id = p_employee_id;

  UPDATE public.jobs
  SET assignee_employee_id = NULL
  WHERE company_id = p_company_id AND assignee_employee_id = p_employee_id;

  UPDATE public.pa_tasks
  SET assigned_employee_id = NULL
  WHERE company_id = p_company_id AND assigned_employee_id = p_employee_id;

  UPDATE public.pa_tasks
  SET delegated_by_employee_id = NULL
  WHERE company_id = p_company_id AND delegated_by_employee_id = p_employee_id;

  -- Hard blockers: historical rows that must keep the employee identity.
  IF EXISTS (
    SELECT 1 FROM public.ownership_transfer_requests
    WHERE company_id = p_company_id AND target_employee_id = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'ownership transfer requests');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.leave_requests
    WHERE company_id = p_company_id AND employee_id = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'leave requests');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_approvals
    WHERE company_id = p_company_id AND employee_id = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'payroll / payment approvals');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.labor_entries
    WHERE company_id = p_company_id AND employee_id = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'labor entries');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.incident_reports
    WHERE company_id = p_company_id AND employee_id = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'incident reports');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory_usage
    WHERE company_id = p_company_id AND employee_id = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'inventory usage');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.job_cards
    WHERE company_id = p_company_id AND employee_id = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'job cards');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payroll_period_locks
    WHERE company_id = p_company_id AND locked_by = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'payroll period locks');
  END IF;

  IF cardinality(v_blockers) > 0 THEN
    RAISE EXCEPTION
      'Cannot permanently delete this employee while related records still exist (%). Use Archive instead, or remove those records first.',
      array_to_string(v_blockers, ', ')
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.time_punches
  WHERE company_id = p_company_id AND employee_id = p_employee_id;

  DELETE FROM public.employees
  WHERE company_id = p_company_id AND id = p_employee_id;

  BEGIN
    PERFORM write_audit_event(
      p_company_id,
      'employee.deleted',
      'employee',
      p_employee_id::text,
      v_before,
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_employee(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_employee(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_employee(uuid, uuid) IS
  'Hard-delete employee after clearing optional assignee refs. Refuses when leave/payroll/labor/incident history remains — prefer Archive.';
