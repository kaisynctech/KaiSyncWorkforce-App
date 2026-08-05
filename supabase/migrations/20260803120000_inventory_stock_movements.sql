-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 2 — Inventory stock movements (receive / adjust / return / allocate)
--
-- • Append-only ledger: inventory_stock_movements
-- • Single SECURITY DEFINER RPC: hr_inventory_stock_movement
-- • Patch hr_allocate_inventory_to_job to write allocate movements
-- • Guard: quantity_on_hand updates only via SECURITY DEFINER (set_config flag)
-- • Patch employee_set_inventory_usage_for_job to set the flag
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = public;

-- ─── 1. Ledger table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_stock_movements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  item_id            uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  movement_type      text NOT NULL CHECK (movement_type IN ('receive', 'adjust', 'return', 'allocate')),
  quantity           numeric NOT NULL,          -- signed delta applied to on-hand
  quantity_before    numeric NOT NULL,
  quantity_after     numeric NOT NULL,
  actor_employee_id  uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  job_id             uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  note               text,
  unit_cost          numeric,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_stock_movements_qty_check CHECK (quantity <> 0)
);

CREATE INDEX IF NOT EXISTS inventory_stock_movements_company_created_idx
  ON public.inventory_stock_movements (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inventory_stock_movements_item_created_idx
  ON public.inventory_stock_movements (item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inventory_stock_movements_job_idx
  ON public.inventory_stock_movements (job_id)
  WHERE job_id IS NOT NULL;

ALTER TABLE public.inventory_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_stock_movements_select ON public.inventory_stock_movements;
CREATE POLICY inventory_stock_movements_select ON public.inventory_stock_movements
  FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids()));

-- No client INSERT/UPDATE/DELETE — SECURITY DEFINER RPCs only (table owner bypasses RLS).

-- ─── 2. Guard direct quantity_on_hand updates ────────────────────────────────
CREATE OR REPLACE FUNCTION public.inventory_items_guard_qty()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.quantity_on_hand IS DISTINCT FROM OLD.quantity_on_hand THEN
    IF coalesce(current_setting('kaisync.allow_stock_update', true), '') <> 'on' THEN
      RAISE EXCEPTION 'STOCK_QTY_RPC_ONLY: change stock via hr_inventory_stock_movement or allocate/usage RPCs'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_items_guard_qty ON public.inventory_items;
CREATE TRIGGER trg_inventory_items_guard_qty
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_items_guard_qty();

-- ─── 3. Unified HR stock movement RPC ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_inventory_stock_movement(
  p_company_id        uuid,
  p_item_id           uuid,
  p_type              text,
  p_quantity          numeric,
  p_actor_employee_id uuid,
  p_job_id            uuid DEFAULT NULL,
  p_note              text DEFAULT NULL,
  p_unit_cost         numeric DEFAULT NULL
)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item       public.inventory_items%ROWTYPE;
  v_type       text := lower(trim(coalesce(p_type, '')));
  v_delta      numeric;
  v_before     numeric;
  v_after      numeric;
  v_usage_left numeric;
  v_row        record;
  v_take       numeric;
BEGIN
  IF v_type NOT IN ('receive', 'adjust', 'return', 'allocate') THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT_TYPE';
  END IF;

  IF p_quantity IS NULL OR p_quantity = 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  IF NOT (p_company_id = ANY (public.user_company_ids())) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED_FOR_COMPANY';
  END IF;

  -- Resolve signed delta
  IF v_type = 'receive' THEN
    IF p_quantity <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
    v_delta := p_quantity;
  ELSIF v_type = 'return' THEN
    IF p_quantity <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
    v_delta := p_quantity;
  ELSIF v_type = 'allocate' THEN
    IF p_quantity <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
    IF p_job_id IS NULL THEN RAISE EXCEPTION 'JOB_REQUIRED_FOR_ALLOCATE'; END IF;
    v_delta := -p_quantity;
  ELSE
    -- adjust: signed delta as provided
    v_delta := p_quantity;
  END IF;

  PERFORM set_config('kaisync.allow_stock_update', 'on', true);

  SELECT * INTO v_item
  FROM public.inventory_items
  WHERE id = p_item_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  v_before := coalesce(v_item.quantity_on_hand, 0);

  IF v_before + v_delta < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'check_violation';
  END IF;

  -- Job-linked return: reduce inventory_usage for that job+item
  IF v_type = 'return' AND p_job_id IS NOT NULL THEN
    SELECT coalesce(sum(u.quantity_used), 0) INTO v_usage_left
    FROM public.inventory_usage u
    WHERE u.company_id = p_company_id
      AND u.job_id = p_job_id
      AND u.inventory_item_id = p_item_id;

    IF v_usage_left < p_quantity THEN
      RAISE EXCEPTION 'RETURN_EXCEEDS_JOB_USAGE';
    END IF;

    v_take := p_quantity;
    FOR v_row IN
      SELECT u.id, u.quantity_used
      FROM public.inventory_usage u
      WHERE u.company_id = p_company_id
        AND u.job_id = p_job_id
        AND u.inventory_item_id = p_item_id
      ORDER BY u.used_at DESC
      FOR UPDATE
    LOOP
      EXIT WHEN v_take <= 0;
      IF v_row.quantity_used <= v_take THEN
        v_take := v_take - v_row.quantity_used;
        DELETE FROM public.inventory_usage WHERE id = v_row.id;
      ELSE
        UPDATE public.inventory_usage
        SET quantity_used = quantity_used - v_take
        WHERE id = v_row.id;
        v_take := 0;
      END IF;
    END LOOP;
  END IF;

  -- Allocate: write usage row (same as hr_allocate_inventory_to_job)
  IF v_type = 'allocate' THEN
    INSERT INTO public.inventory_usage (
      id, company_id, job_id, inventory_item_id, quantity_used,
      employee_id, unit_cost_at_use, used_at
    ) VALUES (
      gen_random_uuid(), p_company_id, p_job_id, p_item_id, p_quantity,
      p_actor_employee_id, coalesce(p_unit_cost, v_item.unit_cost), now()
    );
  END IF;

  UPDATE public.inventory_items
  SET quantity_on_hand = quantity_on_hand + v_delta
  WHERE id = p_item_id
    AND company_id = p_company_id
  RETURNING * INTO v_item;

  v_after := coalesce(v_item.quantity_on_hand, 0);

  INSERT INTO public.inventory_stock_movements (
    company_id, item_id, movement_type, quantity,
    quantity_before, quantity_after,
    actor_employee_id, job_id, note, unit_cost
  ) VALUES (
    p_company_id, p_item_id, v_type, v_delta,
    v_before, v_after,
    p_actor_employee_id, p_job_id, nullif(trim(coalesce(p_note, '')), ''),
    coalesce(p_unit_cost, v_item.unit_cost)
  );

  RETURN v_item;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hr_inventory_stock_movement(
  uuid, uuid, text, numeric, uuid, uuid, text, numeric
) TO authenticated;
REVOKE ALL ON FUNCTION public.hr_inventory_stock_movement(
  uuid, uuid, text, numeric, uuid, uuid, text, numeric
) FROM anon;

-- ─── 4. Patch allocate to log movement + set guard flag ──────────────────────
CREATE OR REPLACE FUNCTION public.hr_allocate_inventory_to_job(
  p_company_id        uuid,
  p_job_id            uuid,
  p_employee_id       uuid,
  p_inventory_item_id uuid,
  p_quantity          numeric,
  p_unit_cost         numeric DEFAULT NULL
)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item   public.inventory_items%ROWTYPE;
  v_before numeric;
  v_after  numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  IF NOT (p_company_id = ANY (public.user_company_ids())) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED_FOR_COMPANY';
  END IF;

  PERFORM set_config('kaisync.allow_stock_update', 'on', true);

  SELECT * INTO v_item
  FROM public.inventory_items
  WHERE id = p_inventory_item_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  v_before := coalesce(v_item.quantity_on_hand, 0);

  IF v_before < p_quantity THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.inventory_items
  SET quantity_on_hand = quantity_on_hand - p_quantity
  WHERE id = p_inventory_item_id
    AND company_id = p_company_id
  RETURNING * INTO v_item;

  v_after := coalesce(v_item.quantity_on_hand, 0);

  INSERT INTO public.inventory_usage (
    id, company_id, job_id, inventory_item_id, quantity_used,
    employee_id, unit_cost_at_use, used_at
  ) VALUES (
    gen_random_uuid(), p_company_id, p_job_id, p_inventory_item_id, p_quantity,
    p_employee_id, coalesce(p_unit_cost, v_item.unit_cost), now()
  );

  INSERT INTO public.inventory_stock_movements (
    company_id, item_id, movement_type, quantity,
    quantity_before, quantity_after,
    actor_employee_id, job_id, note, unit_cost
  ) VALUES (
    p_company_id, p_inventory_item_id, 'allocate', -p_quantity,
    v_before, v_after,
    p_employee_id, p_job_id, NULL,
    coalesce(p_unit_cost, v_item.unit_cost)
  );

  RETURN v_item;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hr_allocate_inventory_to_job(
  uuid, uuid, uuid, uuid, numeric, numeric
) TO authenticated;

-- ─── 5. Patch worker usage RPC to set guard flag ─────────────────────────────
CREATE OR REPLACE FUNCTION public.employee_set_inventory_usage_for_job(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_usages jsonb,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r record;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN
    RAISE EXCEPTION 'Not allowed to set usage for this job';
  END IF;

  PERFORM set_config('kaisync.allow_stock_update', 'on', true);

  CREATE TEMPORARY TABLE _old_usage ON COMMIT DROP AS
  SELECT u.inventory_item_id, sum(u.quantity_used) AS qty
  FROM public.inventory_usage u
  WHERE u.company_id = p_company_id
    AND u.job_id = p_job_id
    AND u.employee_id = p_employee_id
  GROUP BY u.inventory_item_id;

  CREATE TEMPORARY TABLE _new_usage ON COMMIT DROP AS
  SELECT (x.inventory_item_id)::uuid AS inventory_item_id,
         coalesce((x.quantity)::numeric, 0) AS qty
  FROM jsonb_to_recordset(coalesce(p_usages, '[]'::jsonb)) AS x(
    inventory_item_id text,
    quantity text
  )
  WHERE coalesce((x.quantity)::numeric, 0) > 0;

  PERFORM 1
  FROM public.inventory_items i
  WHERE i.company_id = p_company_id
    AND i.id IN (
      SELECT inventory_item_id FROM _new_usage
      UNION
      SELECT inventory_item_id FROM _old_usage
    )
  FOR UPDATE;

  FOR r IN
    SELECT coalesce(n.inventory_item_id, o.inventory_item_id) AS inventory_item_id,
           coalesce(n.qty, 0) - coalesce(o.qty, 0) AS delta
    FROM _new_usage n
    FULL OUTER JOIN _old_usage o ON o.inventory_item_id = n.inventory_item_id
  LOOP
    IF r.delta > 0 THEN
      UPDATE public.inventory_items i
      SET quantity_on_hand = i.quantity_on_hand - r.delta
      WHERE i.company_id = p_company_id
        AND i.id = r.inventory_item_id
        AND i.quantity_on_hand >= r.delta;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for item %', r.inventory_item_id
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF r.delta < 0 THEN
      UPDATE public.inventory_items i
      SET quantity_on_hand = i.quantity_on_hand + abs(r.delta)
      WHERE i.company_id = p_company_id
        AND i.id = r.inventory_item_id;
    END IF;
  END LOOP;

  DELETE FROM public.inventory_usage u
  WHERE u.company_id = p_company_id
    AND u.job_id = p_job_id
    AND u.employee_id = p_employee_id;

  INSERT INTO public.inventory_usage (
    company_id, job_id, inventory_item_id, quantity_used, employee_id, used_at
  )
  SELECT p_company_id, p_job_id, n.inventory_item_id, n.qty, p_employee_id, now()
  FROM _new_usage n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.employee_set_inventory_usage_for_job(
  uuid, uuid, uuid, jsonb, text
) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual)
--   DROP TRIGGER IF EXISTS trg_inventory_items_guard_qty ON public.inventory_items;
--   DROP FUNCTION IF EXISTS public.inventory_items_guard_qty();
--   DROP FUNCTION IF EXISTS public.hr_inventory_stock_movement(uuid,uuid,text,numeric,uuid,uuid,text,numeric);
--   DROP TABLE IF EXISTS public.inventory_stock_movements;
--   Redeploy hr_allocate + employee_set from prior migrations if needed.
-- ════════════════════════════════════════════════════════════════════════════
