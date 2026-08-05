-- Expand employee RPC permissions so contractor-linked members can
-- view/manage jobs under their contractor entity in the same company.

DROP FUNCTION IF EXISTS public.employee_get_jobs_for_employee(bigint, bigint);
CREATE OR REPLACE FUNCTION public.employee_get_jobs_for_employee(
  p_company_id bigint,
  p_employee_id bigint
)
RETURNS SETOF public.jobs
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.*
  FROM public.jobs j
  WHERE j.company_id = p_company_id
    AND (
      j.assigned_employee_ids @> ARRAY[p_employee_id]
      OR j.assignee_employee_id = p_employee_id
      OR j.contractor_employee_id = p_employee_id
      OR EXISTS (
        SELECT 1
        FROM public.contractor_members cm
        WHERE cm.company_id = p_company_id
          AND cm.employee_id = p_employee_id
          AND j.contractor_id IS NOT NULL
          AND cm.contractor_id = j.contractor_id
      )
    );
$$;
DROP FUNCTION IF EXISTS public.employee_get_job_card_for_job(bigint, bigint, bigint);
CREATE OR REPLACE FUNCTION public.employee_get_job_card_for_job(
  p_company_id bigint,
  p_job_id bigint,
  p_employee_id bigint default null
)
RETURNS public.job_cards
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jc.*
  FROM public.job_cards jc
  JOIN public.jobs j ON j.id = jc.job_id AND j.company_id = jc.company_id
  WHERE jc.company_id = p_company_id
    AND jc.job_id = p_job_id
    AND (
      p_employee_id IS NULL
      OR j.assigned_employee_ids @> ARRAY[p_employee_id]
      OR j.assignee_employee_id = p_employee_id
      OR j.contractor_employee_id = p_employee_id
      OR EXISTS (
        SELECT 1
        FROM public.contractor_members cm
        WHERE cm.company_id = p_company_id
          AND cm.employee_id = p_employee_id
          AND j.contractor_id IS NOT NULL
          AND cm.contractor_id = j.contractor_id
      )
    )
  LIMIT 1;
$$;
DROP FUNCTION IF EXISTS public.employee_upsert_job_card(bigint, bigint, bigint, timestamptz, timestamptz, text, text, text, text[], text);
CREATE OR REPLACE FUNCTION public.employee_upsert_job_card(
  p_company_id bigint,
  p_employee_id bigint,
  p_job_id bigint,
  p_actual_start timestamptz default null,
  p_actual_end timestamptz default null,
  p_work_performed text default null,
  p_materials_used text default null,
  p_notes text default null,
  p_photo_urls text[] default '{}',
  p_customer_signature_url text default null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.id = p_job_id
      AND j.company_id = p_company_id
      AND (
        j.assigned_employee_ids @> ARRAY[p_employee_id]
        OR j.assignee_employee_id = p_employee_id
        OR j.contractor_employee_id = p_employee_id
        OR EXISTS (
          SELECT 1
          FROM public.contractor_members cm
          WHERE cm.company_id = p_company_id
            AND cm.employee_id = p_employee_id
            AND j.contractor_id IS NOT NULL
            AND cm.contractor_id = j.contractor_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Not allowed to edit this job card';
  END IF;

  INSERT INTO public.job_cards (
    company_id,
    job_id,
    actual_start,
    actual_end,
    work_performed,
    materials_used,
    notes,
    photo_urls,
    customer_signature_url
  )
  VALUES (
    p_company_id,
    p_job_id,
    p_actual_start,
    p_actual_end,
    p_work_performed,
    p_materials_used,
    p_notes,
    COALESCE(p_photo_urls, '{}'),
    p_customer_signature_url
  )
  ON CONFLICT (company_id, job_id)
  DO UPDATE SET
    actual_start = EXCLUDED.actual_start,
    actual_end = EXCLUDED.actual_end,
    work_performed = EXCLUDED.work_performed,
    materials_used = EXCLUDED.materials_used,
    notes = EXCLUDED.notes,
    photo_urls = EXCLUDED.photo_urls,
    customer_signature_url = EXCLUDED.customer_signature_url;
END;
$$;
DROP FUNCTION IF EXISTS public.employee_update_job_status(bigint, bigint, bigint, text);
CREATE OR REPLACE FUNCTION public.employee_update_job_status(
  p_company_id bigint,
  p_employee_id bigint,
  p_job_id bigint,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('pending', 'in_progress', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid job status';
  END IF;

  UPDATE public.jobs j
  SET status = p_status
  WHERE j.id = p_job_id
    AND j.company_id = p_company_id
    AND (
      j.assigned_employee_ids @> ARRAY[p_employee_id]
      OR j.assignee_employee_id = p_employee_id
      OR j.contractor_employee_id = p_employee_id
      OR EXISTS (
        SELECT 1
        FROM public.contractor_members cm
        WHERE cm.company_id = p_company_id
          AND cm.employee_id = p_employee_id
          AND j.contractor_id IS NOT NULL
          AND cm.contractor_id = j.contractor_id
      )
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not allowed to update this job';
  END IF;
END;
$$;
DROP FUNCTION IF EXISTS public.employee_set_inventory_usage_for_job(bigint, bigint, bigint, jsonb);
CREATE OR REPLACE FUNCTION public.employee_set_inventory_usage_for_job(
  p_company_id bigint,
  p_employee_id bigint,
  p_job_id bigint,
  p_usages jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.id = p_job_id
      AND j.company_id = p_company_id
      AND (
        j.assigned_employee_ids @> ARRAY[p_employee_id]
        OR j.assignee_employee_id = p_employee_id
        OR j.contractor_employee_id = p_employee_id
        OR EXISTS (
          SELECT 1
          FROM public.contractor_members cm
          WHERE cm.company_id = p_company_id
            AND cm.employee_id = p_employee_id
            AND j.contractor_id IS NOT NULL
            AND cm.contractor_id = j.contractor_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Not allowed to set usage for this job';
  END IF;

  CREATE TEMPORARY TABLE _old_usage ON COMMIT DROP AS
  SELECT
    u.inventory_item_id,
    SUM(u.quantity) AS qty
  FROM public.job_inventory_usage u
  WHERE u.company_id = p_company_id
    AND u.job_id = p_job_id
    AND u.employee_id = p_employee_id
  GROUP BY u.inventory_item_id;

  CREATE TEMPORARY TABLE _new_usage ON COMMIT DROP AS
  SELECT
    (x.inventory_item_id)::bigint AS inventory_item_id,
    COALESCE((x.quantity)::numeric, 0) AS qty
  FROM jsonb_to_recordset(COALESCE(p_usages, '[]'::jsonb)) AS x(inventory_item_id text, quantity text)
  WHERE COALESCE((x.quantity)::numeric, 0) > 0;

  FOR r IN
    SELECT
      COALESCE(n.inventory_item_id, o.inventory_item_id) AS inventory_item_id,
      COALESCE(n.qty, 0) - COALESCE(o.qty, 0) AS delta
    FROM _new_usage n
    FULL OUTER JOIN _old_usage o
      ON o.inventory_item_id = n.inventory_item_id
  LOOP
    IF r.delta <> 0 THEN
      UPDATE public.inventory_items i
      SET quantity_on_hand = COALESCE(i.quantity_on_hand, 0) - r.delta,
          updated_at = now()
      WHERE i.company_id = p_company_id
        AND i.id = r.inventory_item_id;
    END IF;
  END LOOP;

  DELETE FROM public.job_inventory_usage
  WHERE company_id = p_company_id
    AND job_id = p_job_id
    AND employee_id = p_employee_id;

  INSERT INTO public.job_inventory_usage (company_id, job_id, employee_id, inventory_item_id, quantity, used_at)
  SELECT p_company_id, p_job_id, p_employee_id, n.inventory_item_id, n.qty, now()
  FROM _new_usage n;
END;
$$;
