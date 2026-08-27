-- ============================================================
-- Rename Supply RFQ comparison RPC to avoid overload collision
-- with the obsolete quote-builder get_rfq_comparison(uuid,uuid,uuid).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_supply_rfq_comparison(p_rfq_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_result     jsonb;
BEGIN
  SELECT company_id INTO v_company_id FROM public.rfqs WHERE id = p_rfq_id;
  PERFORM public.require_user_permission(v_company_id, 'rfq.view');

  SELECT jsonb_build_object(
    'rfq_id',    p_rfq_id,
    'lines',     (
      SELECT jsonb_agg(
        jsonb_build_object(
          'rfq_line_id',  rl.id,
          'sort_order',   rl.sort_order,
          'description',  rl.description,
          'unit',         rl.unit,
          'quantity',     rl.quantity,
          'responses',    (
            SELECT jsonb_agg(
              jsonb_build_object(
                'recipient_id',  rr.id,
                'supplier_id',   rr.supplier_id,
                'supplier_name', c.name,
                'unit_price',    COALESCE(rrl.unit_price, 0),
                'line_total',    COALESCE(rrl.line_total, 0),
                'lead_time_days',COALESCE(rrl.lead_time_days, 0),
                'responded',     (rrl.id IS NOT NULL)
              ) ORDER BY rrl.unit_price ASC NULLS LAST
            )
            FROM public.rfq_recipients rr
            JOIN public.contractors c ON c.id = rr.supplier_id
            LEFT JOIN public.rfq_response_lines rrl
              ON rrl.recipient_id = rr.id AND rrl.rfq_line_id = rl.id
            WHERE rr.rfq_id = p_rfq_id
          )
        ) ORDER BY rl.sort_order
      )
      FROM public.rfq_lines rl
      WHERE rl.rfq_id = p_rfq_id
    ),
    'recipients', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'recipient_id',     rr.id,
          'supplier_id',      rr.supplier_id,
          'supplier_name',    c.name,
          'status',           rr.status,
          'response_total',   rr.response_total,
          'delivery_days',    rr.response_delivery_days,
          'is_selected',      rr.is_selected
        ) ORDER BY rr.response_total ASC NULLS LAST
      )
      FROM public.rfq_recipients rr
      JOIN public.contractors c ON c.id = rr.supplier_id
      WHERE rr.rfq_id = p_rfq_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_supply_rfq_comparison(uuid) IS
  'Supply RFQ supplier comparison matrix (lines × recipients) for the compare UI.';

-- Thin alias: keep single-arg get_rfq_comparison for any legacy callers
CREATE OR REPLACE FUNCTION public.get_rfq_comparison(p_rfq_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.get_supply_rfq_comparison(p_rfq_id);
END;
$$;

-- Drop obsolete quote-builder overload (quote_rfqs stack; UI removed)
DROP FUNCTION IF EXISTS public.get_rfq_comparison(uuid, uuid, uuid);

GRANT EXECUTE ON FUNCTION public.get_supply_rfq_comparison(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_rfq_comparison(uuid) TO authenticated;
