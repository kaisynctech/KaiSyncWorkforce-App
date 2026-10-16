-- Stock adjustments were callable without a company permission check, including
-- by the public anon role. The history view also ran as the owner, so it
-- skipped row security on the tables underneath.

CREATE OR REPLACE FUNCTION public.record_stock_adjustment(
  p_company_id uuid,
  p_catalogue_item_id uuid,
  p_adjusted_by uuid,
  p_adjustment_type text,
  p_qty_change numeric,
  p_notes text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_allow_negative boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_qty_before    numeric(12,3);
  v_qty_after     numeric(12,3);
  v_is_stockable  boolean;
  v_adj_id        uuid;
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'catalogue.edit');

  IF p_adjusted_by IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = p_adjusted_by
      AND e.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'ADJUSTED_BY_NOT_IN_COMPANY';
  END IF;

  SELECT qty_on_hand, is_stockable
  INTO v_qty_before, v_is_stockable
  FROM public.quote_catalogue_items
  WHERE id = p_catalogue_item_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  IF NOT v_is_stockable THEN
    RAISE EXCEPTION 'Item is not stockable';
  END IF;

  v_qty_after := v_qty_before + p_qty_change;

  IF v_qty_after < 0 AND NOT p_allow_negative THEN
    RAISE EXCEPTION 'Stock would go negative (current: %, change: %)',
      v_qty_before, p_qty_change;
  END IF;

  INSERT INTO public.stock_adjustments (
    company_id, catalogue_item_id, adjusted_by,
    adjustment_type, qty_change, qty_before, qty_after,
    reference_type, reference_id, notes
  ) VALUES (
    p_company_id, p_catalogue_item_id, p_adjusted_by,
    p_adjustment_type, p_qty_change, v_qty_before, v_qty_after,
    p_reference_type, p_reference_id, p_notes
  )
  RETURNING id INTO v_adj_id;

  UPDATE public.quote_catalogue_items
  SET qty_on_hand = v_qty_after
  WHERE id = p_catalogue_item_id;

  RETURN jsonb_build_object(
    'adjustment_id', v_adj_id,
    'qty_before',    v_qty_before,
    'qty_after',     v_qty_after,
    'qty_change',    p_qty_change
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_stock_adjustment(uuid, uuid, uuid, text, numeric, text, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_adjustment(uuid, uuid, uuid, text, numeric, text, text, uuid, boolean) TO authenticated;

ALTER VIEW public.stock_adjustment_history SET (security_invoker = true);
REVOKE ALL ON TABLE public.stock_adjustment_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.stock_adjustment_history TO authenticated;

COMMENT ON VIEW public.stock_adjustment_history IS
  'Stock adjustment log. security_invoker: the caller only sees rows their company policies allow.';
