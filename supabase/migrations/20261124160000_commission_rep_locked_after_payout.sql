-- Commission: once any commission has been paid out on a quote, its sales rep can't change.
-- Before this, changing the rep moved the paid amount onto the new rep's line (the money went to the old rep).
-- Same function as before, with one guard added after the commission row is read.
CREATE OR REPLACE FUNCTION public._commission_sync(p_quote_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  q public.commercial_quotes%ROWTYPE;
  co public.companies%ROWTYPE;
  c public.commissions%ROWTYPE;
  v_pct numeric; v_basis text; v_base numeric; v_fx numeric;
BEGIN
  SELECT * INTO q FROM public.commercial_quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO c FROM public.commissions WHERE quote_id = p_quote_id FOR UPDATE;

  -- Paid out already: the rep is fixed (payments stay with the person who was paid).
  IF c.id IS NOT NULL AND coalesce(c.paid_amount, 0) > 0 AND q.salesperson_id IS DISTINCT FROM c.employee_id THEN
    RAISE EXCEPTION 'COMMISSION_REP_LOCKED'
      USING HINT = 'Commission has already been paid out on this quote, so its sales rep can''t change.';
  END IF;

  IF q.status IS DISTINCT FROM 'accepted' OR q.salesperson_id IS NULL THEN
    IF c.id IS NOT NULL AND c.status = 'open' AND c.paid_amount = 0 THEN
      UPDATE public.commissions SET status = 'cancelled', updated_at = now() WHERE id = c.id;
    END IF;
    RETURN;
  END IF;

  SELECT * INTO co FROM public.companies WHERE id = q.company_id;
  v_fx := CASE WHEN coalesce(q.exchange_rate, 0) > 0 THEN q.exchange_rate ELSE 1 END;

  IF c.id IS NULL OR c.employee_id IS DISTINCT FROM q.salesperson_id OR c.status = 'cancelled' THEN
    -- New, re-opened, or the rep changed: take today's % and basis.
    SELECT coalesce(r.percent, co.commission_percent) INTO v_pct
      FROM (SELECT 1) one LEFT JOIN public.commission_reps r ON r.company_id = q.company_id AND r.employee_id = q.salesperson_id;
    v_pct := coalesce(v_pct, co.commission_percent);
    IF v_pct IS NULL THEN RETURN; END IF;   -- commission not set up yet
    v_basis := co.commission_basis;
  ELSE
    v_pct := c.percent; v_basis := c.basis;
  END IF;

  v_base := round(greatest(0, CASE WHEN v_basis = 'profit' THEN coalesce(q.gross_profit, q.subtotal - coalesce(q.cost_total, 0))
                                   ELSE coalesce(q.subtotal, 0) END) * v_fx, 2);

  IF c.id IS NULL THEN
    INSERT INTO public.commissions (company_id, quote_id, employee_id, basis, percent, base_amount, commission_amount)
    VALUES (q.company_id, q.id, q.salesperson_id, v_basis, v_pct, v_base, round(v_base * v_pct / 100, 2));
  ELSE
    UPDATE public.commissions SET employee_id = q.salesperson_id, basis = v_basis, percent = v_pct, base_amount = v_base,
           commission_amount = round(v_base * v_pct / 100, 2), status = 'open', updated_at = now()
     WHERE id = c.id;
  END IF;
END $function$;
