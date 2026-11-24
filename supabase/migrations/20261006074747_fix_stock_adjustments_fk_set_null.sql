-- Fix employee hard-delete blocked by stock_adjustments immutability RULE.
--
-- Root cause:
--   stock_adjustments.adjusted_by → employees(id) ON DELETE SET NULL
--   but RULE stock_adjustments_no_update DO INSTEAD NOTHING swallows the
--   SET NULL update, so Postgres raises:
--   "referential integrity query on employees from constraint
--    stock_adjustments_adjusted_by_fkey gave unexpected result"
--
-- Fix:
--   Replace UPDATE rule with a trigger that allows only adjusted_by→NULL
--   (FK cascade / employee purge). All other mutations stay blocked.
--   Keep DELETE rule (or trigger) so audit rows remain immutable.

DROP RULE IF EXISTS stock_adjustments_no_update ON public.stock_adjustments;

CREATE OR REPLACE FUNCTION public.stock_adjustments_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock_adjustments are immutable and cannot be deleted'
      USING ERRCODE = 'P0001';
  END IF;

  -- Allow ONLY the FK ON DELETE SET NULL path (adjusted_by cleared, nothing else).
  IF NEW.adjusted_by IS NULL
     AND OLD.adjusted_by IS NOT NULL
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
     AND NEW.catalogue_item_id IS NOT DISTINCT FROM OLD.catalogue_item_id
     AND NEW.adjustment_type IS NOT DISTINCT FROM OLD.adjustment_type
     AND NEW.qty_change IS NOT DISTINCT FROM OLD.qty_change
     AND NEW.qty_before IS NOT DISTINCT FROM OLD.qty_before
     AND NEW.qty_after IS NOT DISTINCT FROM OLD.qty_after
     AND NEW.reference_type IS NOT DISTINCT FROM OLD.reference_type
     AND NEW.reference_id IS NOT DISTINCT FROM OLD.reference_id
     AND NEW.notes IS NOT DISTINCT FROM OLD.notes
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'stock_adjustments are immutable and cannot be updated'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_adjustments_immutable ON public.stock_adjustments;
CREATE TRIGGER trg_stock_adjustments_immutable
  BEFORE UPDATE OR DELETE ON public.stock_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.stock_adjustments_immutable_guard();

-- Keep delete RULE as a second line of defence for plain DELETE statements.
-- (Trigger already blocks DELETE; RULE remains for older clients / direct SQL.)
-- stock_adjustments_no_delete already exists — leave it.

COMMENT ON FUNCTION public.stock_adjustments_immutable_guard() IS
  'Immutable stock adjustment audit: block updates/deletes except adjusted_by SET NULL for employee purge.';
