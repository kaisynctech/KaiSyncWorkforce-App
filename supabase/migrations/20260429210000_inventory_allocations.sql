-- ============================================================
-- Inventory allocations
-- HR allocates a specific quantity of an inventory item to a worker
-- (employee or contractor), optionally for a specific job. The worker
-- then records actual usage on the job card. Variance =
-- allocated - used per (job, item, worker).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.inventory_allocations (
  id                bigserial PRIMARY KEY,
  company_id        bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  inventory_item_id bigint REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  worker_employee_id bigint REFERENCES public.employees(id) ON DELETE CASCADE,
  job_id            bigint REFERENCES public.jobs(id) ON DELETE SET NULL,
  quantity_allocated numeric(12,3) NOT NULL CHECK (quantity_allocated > 0),
  unit              text,
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','closed','cancelled')),
  allocated_by      bigint REFERENCES public.employees(id) ON DELETE SET NULL,
  allocated_at      timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_alloc_company  ON public.inventory_allocations(company_id);
CREATE INDEX IF NOT EXISTS idx_inv_alloc_item     ON public.inventory_allocations(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_inv_alloc_worker   ON public.inventory_allocations(worker_employee_id);
CREATE INDEX IF NOT EXISTS idx_inv_alloc_job      ON public.inventory_allocations(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_alloc_status   ON public.inventory_allocations(status);
ALTER TABLE public.inventory_allocations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_inv_alloc_all_hr_company') THEN
    CREATE POLICY p_inv_alloc_all_hr_company ON public.inventory_allocations
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;
ALTER TABLE public.job_inventory_usage
  ADD COLUMN IF NOT EXISTS allocation_id bigint
    REFERENCES public.inventory_allocations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS leftover_returned numeric(12,3),
  ADD COLUMN IF NOT EXISTS extra_used numeric(12,3);
CREATE INDEX IF NOT EXISTS idx_job_inv_usage_alloc
  ON public.job_inventory_usage(allocation_id) WHERE allocation_id IS NOT NULL;
CREATE OR REPLACE VIEW public.v_inventory_allocations AS
SELECT
  a.id                            AS allocation_id,
  a.company_id,
  a.inventory_item_id,
  i.name                          AS item_name,
  COALESCE(a.unit, i.unit)        AS unit,
  a.worker_employee_id,
  e.name || ' ' || e.surname      AS worker_name,
  e.worker_type                   AS worker_type,
  a.job_id,
  j.title                         AS job_title,
  a.quantity_allocated,
  a.status,
  a.allocated_at,
  a.closed_at,
  a.notes,
  COALESCE(SUM(u.quantity)        FILTER (WHERE u.allocation_id = a.id), 0) AS quantity_used,
  COALESCE(SUM(u.extra_used)      FILTER (WHERE u.allocation_id = a.id), 0) AS quantity_extra,
  COALESCE(SUM(u.leftover_returned) FILTER (WHERE u.allocation_id = a.id), 0) AS quantity_returned,
  GREATEST(
    a.quantity_allocated
      - COALESCE(SUM(u.quantity) FILTER (WHERE u.allocation_id = a.id), 0)
      - COALESCE(SUM(u.leftover_returned) FILTER (WHERE u.allocation_id = a.id), 0),
    0
  )                               AS quantity_remaining
FROM public.inventory_allocations a
LEFT JOIN public.inventory_items  i ON i.id = a.inventory_item_id
LEFT JOIN public.employees        e ON e.id = a.worker_employee_id
LEFT JOIN public.jobs             j ON j.id = a.job_id
LEFT JOIN public.job_inventory_usage u ON u.allocation_id = a.id
GROUP BY a.id, i.name, i.unit, e.name, e.surname, e.worker_type, j.title;
