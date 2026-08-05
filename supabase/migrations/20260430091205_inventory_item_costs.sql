-- Add optional per-unit inventory cost so stock valuation and financial
-- reporting can include inventory economics.
ALTER TABLE IF EXISTS public.inventory_items
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2);
COMMENT ON COLUMN public.inventory_items.unit_cost
  IS 'Optional cost per inventory unit in company currency.';
