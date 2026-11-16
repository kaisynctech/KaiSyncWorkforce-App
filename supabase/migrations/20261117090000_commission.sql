-- Piece 10b: sales commission. The company chooses the basis (profit or sale value, excl. VAT), a default % and when
-- it's earned (as the client pays, or only when paid in full). Reps are picked in settings, each on the default or their
-- own %. A quote's sales rep (commercial_quotes.salesperson_id, already there, unused) gets one commission row when the
-- quote is accepted; the % and basis are fixed then. Earned follows the invoices made from that quote. Paid outside
-- payroll: the office marks earned commission paid, which books money out. Nobody pays their own, except the owner.
-- Rollback: DROP TRIGGER trg_quote_commission ON commercial_quotes; DROP the functions below;
--           DROP TABLE commission_payments, commissions, commission_reps;
--           ALTER TABLE companies DROP COLUMN commission_basis, DROP COLUMN commission_percent, DROP COLUMN commission_earned_on;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS commission_basis text NOT NULL DEFAULT 'profit' CHECK (commission_basis IN ('profit', 'sale')),
  ADD COLUMN IF NOT EXISTS commission_percent numeric(6,3) CHECK (commission_percent IS NULL OR (commission_percent >= 0 AND commission_percent <= 100)),
  ADD COLUMN IF NOT EXISTS commission_earned_on text NOT NULL DEFAULT 'payment' CHECK (commission_earned_on IN ('payment', 'paid_in_full'));

-- Who sells. percent NULL = the company default.
CREATE TABLE IF NOT EXISTS public.commission_reps (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  percent numeric(6,3) CHECK (percent IS NULL OR (percent >= 0 AND percent <= 100)),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, employee_id)
);

-- One per accepted quote with a rep. Amounts in the company's home currency, excl. VAT.
CREATE TABLE IF NOT EXISTS public.commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL UNIQUE REFERENCES public.commercial_quotes(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  basis text NOT NULL CHECK (basis IN ('profit', 'sale')),
  percent numeric(6,3) NOT NULL,
  base_amount numeric(14,2) NOT NULL DEFAULT 0,
  commission_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commissions_company ON public.commissions (company_id, status);
CREATE INDEX IF NOT EXISTS commissions_employee ON public.commissions (employee_id);

CREATE TABLE IF NOT EXISTS public.commission_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  commission_id uuid NOT NULL REFERENCES public.commissions(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  amount numeric(14,2) NOT NULL,
  paid_on date NOT NULL,
  method text,
  reference text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commission_payments_commission ON public.commission_payments (commission_id);

ALTER TABLE public.commission_reps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_payments ENABLE ROW LEVEL SECURITY;

-- Read: HR and above see everything; a rep sees their own. Changes only through the functions below.
DROP POLICY IF EXISTS commission_reps_read ON public.commission_reps;
CREATE POLICY commission_reps_read ON public.commission_reps FOR SELECT
  USING (company_id = ANY (public.user_company_ids()) AND public.role_is_hr_or_above(public.get_my_role(company_id)));
DROP POLICY IF EXISTS commissions_read ON public.commissions;
CREATE POLICY commissions_read ON public.commissions FOR SELECT
  USING (company_id = ANY (public.user_company_ids()) AND (public.role_is_hr_or_above(public.get_my_role(company_id))
         OR employee_id = public._my_employee_id(company_id)));
DROP POLICY IF EXISTS commission_payments_read ON public.commission_payments;
CREATE POLICY commission_payments_read ON public.commission_payments FOR SELECT
  USING (company_id = ANY (public.user_company_ids()) AND (public.role_is_hr_or_above(public.get_my_role(company_id))
         OR employee_id = public._my_employee_id(company_id)));

-- Work out (or refresh) a quote's commission. Accepted + has a rep → an open row; otherwise an unpaid row is cancelled.
-- The % and basis are fixed when the row is made (or when the rep changes); the amount follows later quote edits.
CREATE OR REPLACE FUNCTION public._commission_sync(p_quote_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q public.commercial_quotes%ROWTYPE;
  co public.companies%ROWTYPE;
  c public.commissions%ROWTYPE;
  v_pct numeric; v_basis text; v_base numeric; v_fx numeric;
BEGIN
  SELECT * INTO q FROM public.commercial_quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO c FROM public.commissions WHERE quote_id = p_quote_id FOR UPDATE;

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
END $$;

CREATE OR REPLACE FUNCTION public._trg_quote_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.salesperson_id IS DISTINCT FROM OLD.salesperson_id
     OR NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.gross_profit IS DISTINCT FROM OLD.gross_profit
     OR NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate THEN
    PERFORM public._commission_sync(NEW.id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_quote_commission ON public.commercial_quotes;
CREATE TRIGGER trg_quote_commission AFTER INSERT OR UPDATE ON public.commercial_quotes
  FOR EACH ROW EXECUTE FUNCTION public._trg_quote_commission();

-- Commission rows with what the client has paid and what's earned so far.
CREATE OR REPLACE FUNCTION public._commission_rows(p_company_id uuid, p_employee_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, quote_id uuid, quote_number text, quote_title text, client_name text, employee_id uuid, rep_name text,
               basis text, percent numeric, base_amount numeric, commission_amount numeric, paid_share numeric,
               earned numeric, paid_amount numeric, to_pay numeric, status text, accepted_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH x AS (
    SELECT c.*, q.quote_number, q.title, q.total_amount, q.accepted_at, q.client_id,
           coalesce((SELECT sum(coalesce(i.amount_paid, 0)) FROM public.finance_invoices i
                      WHERE i.quote_id = c.quote_id AND i.company_id = c.company_id
                        AND coalesce(i.status, '') NOT IN ('voided', 'cancelled', 'draft') AND i.voided_at IS NULL), 0) AS paid_in
      FROM public.commissions c JOIN public.commercial_quotes q ON q.id = c.quote_id
     WHERE c.company_id = p_company_id AND (p_employee_id IS NULL OR c.employee_id = p_employee_id)
  ), y AS (
    SELECT x.*, CASE WHEN coalesce(x.total_amount, 0) <= 0 THEN 0 ELSE least(1, x.paid_in / x.total_amount) END AS share,
           (SELECT commission_earned_on FROM public.companies WHERE id = x.company_id) AS earned_on
      FROM x
  )
  SELECT y.id, y.quote_id, y.quote_number, y.title, cl.name, y.employee_id, nullif(btrim(concat_ws(' ', e.name, e.surname)), ''),
         y.basis, y.percent, y.base_amount, y.commission_amount, round(y.share, 4),
         z.earned, y.paid_amount, greatest(0, z.earned - y.paid_amount), y.status, y.accepted_at
    FROM y
    CROSS JOIN LATERAL (SELECT CASE WHEN y.status = 'cancelled' THEN 0
                                    WHEN y.earned_on = 'paid_in_full' THEN CASE WHEN y.share >= 0.999 THEN y.commission_amount ELSE 0 END
                                    ELSE round(y.commission_amount * y.share, 2) END AS earned) z
    LEFT JOIN public.employees e ON e.id = y.employee_id
    LEFT JOIN public.clients cl ON cl.id = y.client_id;
$$;

-- Office: settings, reps and the list.
CREATE OR REPLACE FUNCTION public.commission_overview(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (p_company_id = ANY (public.user_company_ids())) OR NOT public.role_is_hr_or_above(public.get_my_role(p_company_id)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  RETURN jsonb_build_object(
    'settings', (SELECT jsonb_build_object('basis', commission_basis, 'percent', commission_percent, 'earned_on', commission_earned_on)
                   FROM public.companies WHERE id = p_company_id),
    'reps', coalesce((SELECT jsonb_agg(jsonb_build_object('employee_id', r.employee_id, 'name', nullif(btrim(concat_ws(' ', e.name, e.surname)), ''),
                                                          'percent', r.percent, 'active', r.active) ORDER BY e.name, e.surname)
                        FROM public.commission_reps r JOIN public.employees e ON e.id = r.employee_id
                       WHERE r.company_id = p_company_id), '[]'::jsonb),
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.accepted_at DESC NULLS LAST) FROM public._commission_rows(p_company_id) t), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.commission_save_settings(p_company_id uuid, p_basis text, p_percent numeric, p_earned_on text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (p_company_id = ANY (public.user_company_ids())) OR NOT public.role_is_hr_or_above(public.get_my_role(p_company_id)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF p_basis NOT IN ('profit', 'sale') OR p_earned_on NOT IN ('payment', 'paid_in_full') THEN RAISE EXCEPTION 'BAD_SETTING'; END IF;
  IF p_percent IS NOT NULL AND (p_percent < 0 OR p_percent > 100) THEN RAISE EXCEPTION 'BAD_PERCENT'; END IF;
  UPDATE public.companies SET commission_basis = p_basis, commission_percent = p_percent, commission_earned_on = p_earned_on
   WHERE id = p_company_id;
END $$;

-- Add or change a rep (percent NULL = company default; active false = can't be picked on new quotes).
CREATE OR REPLACE FUNCTION public.commission_set_rep(p_company_id uuid, p_employee_id uuid, p_percent numeric, p_active boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (p_company_id = ANY (public.user_company_ids())) OR NOT public.role_is_hr_or_above(public.get_my_role(p_company_id)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF p_percent IS NOT NULL AND (p_percent < 0 OR p_percent > 100) THEN RAISE EXCEPTION 'BAD_PERCENT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id AND company_id = p_company_id) THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;
  INSERT INTO public.commission_reps (company_id, employee_id, percent, active) VALUES (p_company_id, p_employee_id, p_percent, coalesce(p_active, true))
  ON CONFLICT (company_id, employee_id) DO UPDATE SET percent = EXCLUDED.percent, active = EXCLUDED.active, updated_at = now();
END $$;

-- Names only, for the quote's "Sales rep" list (anyone who can edit quotes).
CREATE OR REPLACE FUNCTION public.commission_rep_options(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (p_company_id = ANY (public.user_company_ids())) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'name', nullif(btrim(concat_ws(' ', e.name, e.surname)), ''))
                                    ORDER BY e.name, e.surname)
                     FROM public.commission_reps r JOIN public.employees e ON e.id = r.employee_id
                    WHERE r.company_id = p_company_id AND r.active), '[]'::jsonb);
END $$;

-- Pay what's earned and not yet paid on the picked commissions. One payment + one money-out line each.
CREATE OR REPLACE FUNCTION public.commission_mark_paid(p_ids uuid[], p_paid_on date, p_method text DEFAULT 'eft', p_reference text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.commissions%ROWTYPE; v_n int := 0; v_me uuid; v_due numeric; v_name text; v_qnum text; v_pay uuid;
        v_on date := coalesce(p_paid_on, (now() AT TIME ZONE 'Africa/Johannesburg')::date);
        v_ref text := nullif(trim(coalesce(p_reference, '')), ''); v_method text := coalesce(nullif(p_method, ''), 'eft');
BEGIN
  FOR c IN SELECT * FROM public.commissions WHERE id = ANY (p_ids) FOR UPDATE LOOP
    IF NOT (c.company_id = ANY (public.user_company_ids())) OR NOT public.role_is_hr_or_above(public.get_my_role(c.company_id)) THEN
      RAISE EXCEPTION 'NOT_ALLOWED';
    END IF;
    v_me := public._my_employee_id(c.company_id);
    IF v_me = c.employee_id AND public.get_my_role(c.company_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'OWN_COMMISSION'; END IF;
    SELECT t.to_pay, t.rep_name, t.quote_number INTO v_due, v_name, v_qnum
      FROM public._commission_rows(c.company_id, c.employee_id) t WHERE t.id = c.id;
    IF coalesce(v_due, 0) <= 0 THEN CONTINUE; END IF;
    INSERT INTO public.commission_payments (company_id, commission_id, employee_id, amount, paid_on, method, reference, created_by)
    VALUES (c.company_id, c.id, c.employee_id, v_due, v_on, v_method, v_ref, v_me) RETURNING id INTO v_pay;
    UPDATE public.commissions SET paid_amount = paid_amount + v_due, updated_at = now() WHERE id = c.id;
    INSERT INTO public.finance_transactions (company_id, transaction_type, direction, source_table, source_id, reference_number,
      amount, vat_amount, total_amount, transaction_date, payment_method, notes, created_by)
    VALUES (c.company_id, 'expense', 'outgoing', 'commission_payments', v_pay, v_ref, v_due, 0, v_due, v_on, v_method,
      'Commission · ' || coalesce(v_name, 'rep') || coalesce(' · ' || v_qnum, ''), v_me);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- Rep: their own commission (code sign-in or own login).
CREATE OR REPLACE FUNCTION public.employee_list_commission(p_company_id uuid, p_employee_id uuid, p_session_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN jsonb_build_object(
    'settings', (SELECT jsonb_build_object('basis', commission_basis, 'earned_on', commission_earned_on) FROM public.companies WHERE id = p_company_id),
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(t) - 'rep_name' - 'employee_id' ORDER BY t.accepted_at DESC NULLS LAST)
                        FROM public._commission_rows(p_company_id, p_employee_id) t WHERE t.status = 'open' OR t.paid_amount > 0), '[]'::jsonb),
    'payments', coalesce((SELECT jsonb_agg(jsonb_build_object('amount', p.amount, 'paid_on', p.paid_on, 'reference', p.reference) ORDER BY p.paid_on DESC)
                            FROM public.commission_payments p WHERE p.company_id = p_company_id AND p.employee_id = p_employee_id), '[]'::jsonb));
END $$;

-- Is this person a sales rep (or have they earned commission before)? Shows "My commission" in their menu.
CREATE OR REPLACE FUNCTION public.employee_is_commission_rep(p_company_id uuid, p_employee_id uuid, p_session_token text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN EXISTS (SELECT 1 FROM public.commission_reps WHERE company_id = p_company_id AND employee_id = p_employee_id AND active)
      OR EXISTS (SELECT 1 FROM public.commissions WHERE company_id = p_company_id AND employee_id = p_employee_id);
END $$;

REVOKE ALL ON FUNCTION public._commission_sync(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._trg_quote_commission() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._commission_rows(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commission_overview(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commission_save_settings(uuid, text, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commission_set_rep(uuid, uuid, numeric, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commission_rep_options(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commission_mark_paid(uuid[], date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.employee_list_commission(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commission_overview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_save_settings(uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_set_rep(uuid, uuid, numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_rep_options(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_mark_paid(uuid[], date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_list_commission(uuid, uuid, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.employee_is_commission_rep(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_is_commission_rep(uuid, uuid, text) TO anon, authenticated;
