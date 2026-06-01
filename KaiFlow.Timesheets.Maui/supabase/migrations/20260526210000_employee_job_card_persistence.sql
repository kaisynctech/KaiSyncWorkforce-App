-- Employee job card + checklist persistence (anon/code login) — uuid schema.

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_cards_company_job
  ON public.job_cards (company_id, job_id);

DROP FUNCTION IF EXISTS public.employee_get_job_card_for_employee(bigint, bigint, bigint);
DROP FUNCTION IF EXISTS public.employee_get_job_card_for_employee(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.employee_get_job_card_for_employee(
  p_company_id uuid,
  p_job_id uuid,
  p_employee_id uuid
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT row_to_json(jc)
  FROM public.job_cards jc
  JOIN public.jobs j ON j.id = jc.job_id AND j.company_id = jc.company_id
  WHERE jc.company_id = p_company_id
    AND jc.job_id = p_job_id
    AND public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id);
$$;

DROP FUNCTION IF EXISTS public.employee_upsert_job_card(bigint, bigint, bigint, timestamptz, timestamptz, text, text, text, text[], text);
DROP FUNCTION IF EXISTS public.employee_upsert_job_card(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text[], boolean, text);

CREATE OR REPLACE FUNCTION public.employee_upsert_job_card(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_start_time timestamptz DEFAULT NULL,
  p_end_time timestamptz DEFAULT NULL,
  p_work_performed text DEFAULT NULL,
  p_materials_used text DEFAULT NULL,
  p_photo_urls text[] DEFAULT '{}',
  p_is_completed boolean DEFAULT false,
  p_client_signature_url text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_row public.job_cards%ROWTYPE;
BEGIN
  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB';
  END IF;

  INSERT INTO public.job_cards (
    company_id, job_id, employee_id,
    start_time, end_time, work_performed, materials_used,
    photo_urls, is_completed, client_signature_url, updated_at
  )
  VALUES (
    p_company_id, p_job_id, p_employee_id,
    p_start_time, p_end_time, p_work_performed, p_materials_used,
    COALESCE(p_photo_urls, '{}'), COALESCE(p_is_completed, false),
    p_client_signature_url, now()
  )
  ON CONFLICT (company_id, job_id)
  DO UPDATE SET
    employee_id = EXCLUDED.employee_id,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    work_performed = EXCLUDED.work_performed,
    materials_used = EXCLUDED.materials_used,
    photo_urls = EXCLUDED.photo_urls,
    is_completed = EXCLUDED.is_completed,
    client_signature_url = COALESCE(EXCLUDED.client_signature_url, job_cards.client_signature_url),
    updated_at = now()
  RETURNING * INTO v_row;

  IF COALESCE(p_is_completed, false) THEN
    UPDATE public.jobs
    SET status = 'completed',
        closed_at = COALESCE(closed_at, now()),
        updated_at = now()
    WHERE id = p_job_id
      AND company_id = p_company_id
      AND status NOT IN ('completed', 'cancelled');
  END IF;

  RETURN row_to_json(v_row);
END;
$$;

DROP FUNCTION IF EXISTS public.employee_get_checklist_for_job(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.employee_get_checklist_for_job(
  p_company_id uuid,
  p_job_id uuid,
  p_employee_id uuid
)
RETURNS SETOF public.job_checklist_items
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT c.*
  FROM public.job_checklist_items c
  WHERE c.company_id = p_company_id
    AND c.job_id = p_job_id
    AND public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id)
  ORDER BY c.sort_order, c.description;
$$;

DROP FUNCTION IF EXISTS public.employee_update_checklist_item(uuid, uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION public.employee_update_checklist_item(
  p_company_id uuid,
  p_employee_id uuid,
  p_item_id uuid,
  p_is_checked boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_job_id uuid;
BEGIN
  SELECT c.job_id INTO v_job_id
  FROM public.job_checklist_items c
  WHERE c.id = p_item_id AND c.company_id = p_company_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'CHECKLIST_ITEM_NOT_FOUND';
  END IF;

  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, v_job_id) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB';
  END IF;

  UPDATE public.job_checklist_items
  SET is_checked = p_is_checked
  WHERE id = p_item_id AND company_id = p_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.employee_get_job_card_for_employee(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_job_card_for_employee(uuid, uuid, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.employee_upsert_job_card(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text[], boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_upsert_job_card(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text[], boolean, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.employee_get_checklist_for_job(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_checklist_for_job(uuid, uuid, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.employee_update_checklist_item(uuid, uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_update_checklist_item(uuid, uuid, uuid, boolean) TO anon, authenticated;
