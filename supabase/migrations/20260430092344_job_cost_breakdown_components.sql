-- Structured cost breakdown on jobs so profitability can reconcile
-- inventory, labor, and miscellaneous costs separately.
ALTER TABLE IF EXISTS public.jobs
  ADD COLUMN IF NOT EXISTS inventory_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS labor_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS other_cost numeric(12,2);

COMMENT ON COLUMN public.jobs.inventory_cost
  IS 'Inventory/material component of actual cost.';
COMMENT ON COLUMN public.jobs.labor_cost
  IS 'Labor/payroll component of actual cost.';
COMMENT ON COLUMN public.jobs.other_cost
  IS 'Other/misc component of actual cost.';

-- Backfill inventory_cost from existing actual_cost where no split exists.
UPDATE public.jobs
SET inventory_cost = actual_cost
WHERE actual_cost IS NOT NULL
  AND inventory_cost IS NULL
  AND labor_cost IS NULL
  AND other_cost IS NULL;
