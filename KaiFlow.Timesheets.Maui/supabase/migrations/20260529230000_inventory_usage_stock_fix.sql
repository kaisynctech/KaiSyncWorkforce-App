-- ════════════════════════════════════════════════════════════════════════════
-- FIX C1 + M9 — INVENTORY STOCK DEDUCTION
--
-- Two related production risks:
--   • C1 (critical): employee_set_inventory_usage_for_job writes the NON-EXISTENT
--     column `stock_count`. The real column is `quantity_on_hand`, so worker-side
--     stock deduction fails at runtime (function body is only validated lazily).
--   • M9 (medium): HR allocation is a non-transactional "insert usage + manually
--     decrement quantity_on_hand" two-step that can diverge on partial failure /
--     race conditions.
--
-- This migration:
--   1. Recreates employee_set_inventory_usage_for_job using `quantity_on_hand`,
--      with FOR UPDATE row locking, negative-stock guards, and EXCEPTION handling.
--      Signature is UNCHANGED (uuid,uuid,uuid,jsonb) → fully backward compatible.
--   2. Adds an atomic hr_allocate_inventory_to_job RPC so the HR path is a single
--      transactional, row-locked operation (insert usage + decrement in one tx).
--
-- No schema changes. No bigint overloads. Anon/authenticated grants preserved.
-- ════════════════════════════════════════════════════════════════════════════

set search_path = public;
-- ─── 1. Worker path: fix column + add locking/atomicity ─────────────────────
CREATE OR REPLACE FUNCTION public.employee_set_inventory_usage_for_job(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_usages jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r record;
BEGIN
  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN
    RAISE EXCEPTION 'Not allowed to set usage for this job';
  END IF;

  -- Prior usage for this (job, employee), aggregated per item.
  CREATE TEMPORARY TABLE _old_usage ON COMMIT DROP AS
  SELECT u.inventory_item_id, sum(u.quantity_used) AS qty
  FROM public.inventory_usage u
  WHERE u.company_id = p_company_id
    AND u.job_id = p_job_id
    AND u.employee_id = p_employee_id
  GROUP BY u.inventory_item_id;

  -- Desired new usage from the client payload.
  CREATE TEMPORARY TABLE _new_usage ON COMMIT DROP AS
  SELECT (x.inventory_item_id)::uuid AS inventory_item_id,
         coalesce((x.quantity)::numeric, 0) AS qty
  FROM jsonb_to_recordset(coalesce(p_usages, '[]'::jsonb)) AS x(
    inventory_item_id text,
    quantity text
  )
  WHERE coalesce((x.quantity)::numeric, 0) > 0;

  -- Lock every affected item row up-front to serialise concurrent edits and
  -- prevent read-modify-write races / negative stock under concurrency.
  PERFORM 1
  FROM public.inventory_items i
  WHERE i.company_id = p_company_id
    AND i.id IN (
      SELECT inventory_item_id FROM _new_usage
      UNION
      SELECT inventory_item_id FROM _old_usage
    )
  FOR UPDATE;

  -- Apply the per-item delta (new − old) against quantity_on_hand.
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

  -- Replace this (job, employee)'s usage rows with the new set. Because this all
  -- runs inside one function (one transaction), any RAISE above rolls the whole
  -- operation back — no partial stock/usage state can be committed.
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
-- ─── 2. HR path: single atomic, row-locked allocation ───────────────────────
-- Replaces the previous client-side "insert usage + UpdateInventoryItem" two-step.
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
  v_item public.inventory_items%ROWTYPE;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  -- Multi-tenant guard: the authenticated caller must belong to the company.
  IF NOT (p_company_id = ANY(public.user_company_ids())) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED_FOR_COMPANY';
  END IF;

  -- Lock the item row for the duration of the transaction.
  SELECT * INTO v_item
  FROM public.inventory_items
  WHERE id = p_inventory_item_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  IF v_item.quantity_on_hand < p_quantity THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.inventory_items
  SET quantity_on_hand = quantity_on_hand - p_quantity
  WHERE id = p_inventory_item_id
    AND company_id = p_company_id
  RETURNING * INTO v_item;

  INSERT INTO public.inventory_usage (
    id, company_id, job_id, inventory_item_id, quantity_used,
    employee_id, unit_cost_at_use, used_at
  ) VALUES (
    gen_random_uuid(), p_company_id, p_job_id, p_inventory_item_id, p_quantity,
    p_employee_id, coalesce(p_unit_cost, v_item.unit_cost), now()
  );

  RETURN v_item;
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_set_inventory_usage_for_job(uuid, uuid, uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_allocate_inventory_to_job(uuid, uuid, uuid, uuid, numeric, numeric) TO authenticated;
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK NOTES (manual)
--   • employee_set_inventory_usage_for_job: re-deploy the prior body from
--     20260528120000_uuid_rpc_parity_jobs_messaging_inventory.sql (the version that
--     used `stock_count`). NOTE: that version is the BROKEN one — rolling back
--     re-introduces C1. Prefer fixing forward.
--   • hr_allocate_inventory_to_job:
--       drop function if exists public.hr_allocate_inventory_to_job(uuid,uuid,uuid,uuid,numeric,numeric);
--     The HR client path falls back to the previous insert+decrement behaviour
--     only if the C# AllocateInventoryToJobAsync wrapper is also reverted.
-- ════════════════════════════════════════════════════════════════════════════;
