-- Piece 10 follow-up: each company chooses how claims and commission are paid: separately (as now) or on the payslip.
-- On the payslip: when a pending payslip is opened, the person's approved claims and earned, unpaid commission are linked
-- to it and shown as lines (claims as untaxed reimbursements, commission as taxable). The office can take a line off;
-- it waits for the next payslip. Approving the payslip marks them paid (no separate money-out line: the salary payment
-- covers it). Rejecting the payslip frees them again (and undoes the payment if it had been approved).
-- Rollback: DROP TRIGGER trg_payslip_extras_settle ON payment_approvals; DROP FUNCTION payslip_extras, payslip_remove_extra,
--           _trg_payslip_extras_settle; re-run claims_mark_paid and _commission_rows from 20261116170000 / 20261117090000;
--           ALTER TABLE ... DROP COLUMN the columns added below.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS claims_pay_via text NOT NULL DEFAULT 'separately' CHECK (claims_pay_via IN ('separately', 'payslip')),
  ADD COLUMN IF NOT EXISTS commission_pay_via text NOT NULL DEFAULT 'separately' CHECK (commission_pay_via IN ('separately', 'payslip'));

ALTER TABLE public.staff_claims
  ADD COLUMN IF NOT EXISTS payment_approval_id uuid REFERENCES public.payment_approvals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payslip_skip_id uuid;
ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS payment_approval_id uuid REFERENCES public.payment_approvals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payslip_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS payslip_skip_id uuid;
ALTER TABLE public.commission_payments
  ADD COLUMN IF NOT EXISTS payment_approval_id uuid REFERENCES public.payment_approvals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS staff_claims_payslip ON public.staff_claims (payment_approval_id) WHERE payment_approval_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commissions_payslip ON public.commissions (payment_approval_id) WHERE payment_approval_id IS NOT NULL;

DO $$
BEGIN
  INSERT INTO public._fn_backup (name, def)
    VALUES ('claims_mark_paid before pay-on-payslip', pg_get_functiondef('public.claims_mark_paid(uuid[], date, text, text)'::regprocedure))
    ON CONFLICT (name) DO NOTHING;
  INSERT INTO public._fn_backup (name, def)
    VALUES ('_commission_rows before pay-on-payslip', pg_get_functiondef('public._commission_rows(uuid, uuid)'::regprocedure))
    ON CONFLICT (name) DO NOTHING;
END $$;

-- Commission rows: what's linked to an open payslip is not "to pay" separately.
DROP FUNCTION IF EXISTS public._commission_rows(uuid, uuid);
CREATE FUNCTION public._commission_rows(p_company_id uuid, p_employee_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, quote_id uuid, quote_number text, quote_title text, client_name text, employee_id uuid, rep_name text,
               basis text, percent numeric, base_amount numeric, commission_amount numeric, paid_share numeric,
               earned numeric, paid_amount numeric, to_pay numeric, status text, accepted_at timestamptz,
               on_payslip boolean, payslip_amount numeric)
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
           (SELECT commission_earned_on FROM public.companies WHERE companies.id = x.company_id) AS earned_on
      FROM x
  )
  SELECT y.id, y.quote_id, y.quote_number, y.title, cl.name, y.employee_id, nullif(btrim(concat_ws(' ', e.name, e.surname)), ''),
         y.basis, y.percent, y.base_amount, y.commission_amount, round(y.share, 4),
         z.earned, y.paid_amount,
         greatest(0, z.earned - y.paid_amount - CASE WHEN y.payment_approval_id IS NOT NULL THEN coalesce(y.payslip_amount, 0) ELSE 0 END),
         y.status, y.accepted_at, y.payment_approval_id IS NOT NULL, CASE WHEN y.payment_approval_id IS NOT NULL THEN y.payslip_amount END
    FROM y
    CROSS JOIN LATERAL (SELECT CASE WHEN y.status = 'cancelled' THEN 0
                                    WHEN y.earned_on = 'paid_in_full' THEN CASE WHEN y.share >= 0.999 THEN y.commission_amount ELSE 0 END
                                    ELSE round(y.commission_amount * y.share, 2) END AS earned) z
    LEFT JOIN public.employees e ON e.id = y.employee_id
    LEFT JOIN public.clients cl ON cl.id = y.client_id;
$$;
REVOKE ALL ON FUNCTION public._commission_rows(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Claims on an open payslip are paid by the payslip, not here.
CREATE OR REPLACE FUNCTION public.claims_mark_paid(p_claim_ids uuid[], p_paid_on date, p_method text DEFAULT 'eft', p_reference text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.staff_claims%ROWTYPE; v_n int := 0; v_me uuid; v_name text;
BEGIN
  FOR c IN SELECT * FROM public.staff_claims WHERE id = ANY (p_claim_ids) FOR UPDATE LOOP
    IF NOT (c.company_id = ANY (public.user_company_ids())) OR NOT public.role_is_hr_or_above(public.get_my_role(c.company_id)) THEN
      RAISE EXCEPTION 'NOT_ALLOWED';
    END IF;
    IF c.status <> 'approved' OR c.payment_approval_id IS NOT NULL THEN CONTINUE; END IF;
    v_me := public._my_employee_id(c.company_id);
    IF v_me = c.employee_id AND public.get_my_role(c.company_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'OWN_CLAIM'; END IF;
    UPDATE public.staff_claims SET status = 'paid', paid_at = coalesce(p_paid_on, (now() AT TIME ZONE 'Africa/Johannesburg')::date),
      payment_reference = nullif(trim(coalesce(p_reference, '')), ''), updated_at = now() WHERE id = c.id;
    IF c.amount > 0 THEN
      SELECT nullif(btrim(concat_ws(' ', name, surname)), '') INTO v_name FROM public.employees WHERE id = c.employee_id;
      INSERT INTO public.finance_transactions (company_id, transaction_type, direction, source_table, source_id, reference_number,
        amount, vat_amount, total_amount, transaction_date, payment_method, notes, created_by)
      VALUES (c.company_id, 'expense', 'outgoing', 'staff_claims', c.id, nullif(trim(coalesce(p_reference, '')), ''),
        c.amount, 0, c.amount, coalesce(p_paid_on, (now() AT TIME ZONE 'Africa/Johannesburg')::date), coalesce(nullif(p_method, ''), 'eft'),
        'Staff claim · ' || coalesce(v_name, 'staff') || ' · ' || c.kind, v_me);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- The two "how is it paid" settings.
CREATE OR REPLACE FUNCTION public.pay_via_save(p_company_id uuid, p_claims text, p_commission text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (p_company_id = ANY (public.user_company_ids())) OR NOT public.role_is_hr_or_above(public.get_my_role(p_company_id)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF coalesce(p_claims, 'separately') NOT IN ('separately', 'payslip') OR coalesce(p_commission, 'separately') NOT IN ('separately', 'payslip') THEN
    RAISE EXCEPTION 'BAD_SETTING';
  END IF;
  UPDATE public.companies SET claims_pay_via = coalesce(p_claims, claims_pay_via), commission_pay_via = coalesce(p_commission, commission_pay_via)
   WHERE id = p_company_id;
END $$;

CREATE OR REPLACE FUNCTION public._payslip_can_edit(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_company_id = ANY (public.user_company_ids())
     AND (public.role_is_hr_or_above(public.get_my_role(p_company_id)) OR public.user_has_permission(p_company_id, 'payments.approve'));
$$;

-- The claims and commission on a payslip. On a pending payslip this first links what's due (and refreshes commission
-- amounts); on any other payslip it only lists what was linked. Lines: [{kind, id, label, amount, taxable}].
CREATE OR REPLACE FUNCTION public.payslip_extras(p_payment_approval_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pa public.payment_approvals%ROWTYPE;
  co public.companies%ROWTYPE;
  r record;
BEGIN
  SELECT * INTO pa FROM public.payment_approvals WHERE id = p_payment_approval_id;
  IF NOT FOUND OR NOT public._payslip_can_edit(pa.company_id) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  SELECT * INTO co FROM public.companies WHERE id = pa.company_id;

  IF pa.status = 'pending' THEN
    IF co.claims_pay_via = 'payslip' THEN
      UPDATE public.staff_claims SET payment_approval_id = pa.id, updated_at = now()
       WHERE company_id = pa.company_id AND employee_id = pa.employee_id AND status = 'approved' AND amount > 0
         AND payment_approval_id IS NULL AND payslip_skip_id IS DISTINCT FROM pa.id
         AND claim_date <= coalesce(pa.period_end, claim_date);
    END IF;
    IF co.commission_pay_via = 'payslip' THEN
      -- Already on this payslip: refresh to what's earned and unpaid now. Not on a payslip yet: link what's due.
      FOR r IN SELECT t.id, t.earned, t.paid_amount, t.to_pay, c.payment_approval_id AS linked
                 FROM public._commission_rows(pa.company_id, pa.employee_id) t JOIN public.commissions c ON c.id = t.id
                WHERE t.status = 'open' AND (c.payment_approval_id = pa.id
                      OR (c.payment_approval_id IS NULL AND c.payslip_skip_id IS DISTINCT FROM pa.id AND t.to_pay > 0)) LOOP
        UPDATE public.commissions SET payment_approval_id = pa.id,
               payslip_amount = greatest(0, r.earned - r.paid_amount), updated_at = now()
         WHERE id = r.id;
      END LOOP;
      UPDATE public.commissions SET payment_approval_id = NULL, payslip_amount = NULL
       WHERE payment_approval_id = pa.id AND coalesce(payslip_amount, 0) <= 0;
    END IF;
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(l ORDER BY l ->> 'kind' DESC, l ->> 'label') FROM (
      SELECT jsonb_build_object('kind', 'claim', 'id', c.id, 'taxable', false, 'amount', c.amount,
               'label', 'Reimbursement · ' || CASE c.kind WHEN 'travel' THEN 'Travel ' || coalesce(c.km::text || ' km', '')
                                                         WHEN 'toll' THEN 'Tolls' WHEN 'parking' THEN 'Parking' WHEN 'meal' THEN 'Meals'
                                                         WHEN 'parts' THEN 'Parts' ELSE 'Claim' END
                        || ' ' || to_char(c.claim_date, 'DD Mon')) AS l
        FROM public.staff_claims c WHERE c.payment_approval_id = pa.id
      UNION ALL
      SELECT jsonb_build_object('kind', 'commission', 'id', m.id, 'taxable', true, 'amount', m.payslip_amount,
               'label', 'Commission · ' || coalesce(q.quote_number, 'sale'))
        FROM public.commissions m JOIN public.commercial_quotes q ON q.id = m.quote_id
       WHERE m.payment_approval_id = pa.id AND m.payslip_amount > 0
      UNION ALL
      SELECT jsonb_build_object('kind', 'commission', 'id', p.commission_id, 'taxable', true, 'amount', p.amount,
               'label', 'Commission · ' || coalesce(q.quote_number, 'sale'))
        FROM public.commission_payments p JOIN public.commissions m ON m.id = p.commission_id
        JOIN public.commercial_quotes q ON q.id = m.quote_id
       WHERE p.payment_approval_id = pa.id
    ) s), '[]'::jsonb);
END $$;

-- Take a claim or commission off a pending payslip: it waits for the next one.
CREATE OR REPLACE FUNCTION public.payslip_remove_extra(p_payment_approval_id uuid, p_kind text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pa public.payment_approvals%ROWTYPE;
BEGIN
  SELECT * INTO pa FROM public.payment_approvals WHERE id = p_payment_approval_id;
  IF NOT FOUND OR NOT public._payslip_can_edit(pa.company_id) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF pa.status <> 'pending' THEN RAISE EXCEPTION 'PAYSLIP_NOT_PENDING'; END IF;
  IF p_kind = 'claim' THEN
    UPDATE public.staff_claims SET payment_approval_id = NULL, payslip_skip_id = pa.id, updated_at = now()
     WHERE id = p_id AND payment_approval_id = pa.id;
  ELSIF p_kind = 'commission' THEN
    UPDATE public.commissions SET payment_approval_id = NULL, payslip_amount = NULL, payslip_skip_id = pa.id, updated_at = now()
     WHERE id = p_id AND payment_approval_id = pa.id;
  ELSE
    RAISE EXCEPTION 'BAD_KIND';
  END IF;
END $$;

-- Approving a payslip pays what's on it; rejecting frees it (and undoes it if the payslip had been approved).
CREATE OR REPLACE FUNCTION public._trg_payslip_extras_settle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ref text := 'Payslip ' || to_char(coalesce(NEW.period_end, (now() AT TIME ZONE 'Africa/Johannesburg')::date), 'Mon YYYY');
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  m public.commissions%ROWTYPE;
  p public.commission_payments%ROWTYPE;
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    UPDATE public.staff_claims SET status = 'paid', paid_at = v_today, payment_reference = v_ref, updated_at = now()
     WHERE payment_approval_id = NEW.id AND status = 'approved';
    FOR m IN SELECT * FROM public.commissions WHERE payment_approval_id = NEW.id AND coalesce(payslip_amount, 0) > 0 FOR UPDATE LOOP
      INSERT INTO public.commission_payments (company_id, commission_id, employee_id, amount, paid_on, method, reference, payment_approval_id)
      VALUES (m.company_id, m.id, m.employee_id, m.payslip_amount, v_today, 'payslip', v_ref, NEW.id);
      UPDATE public.commissions SET paid_amount = paid_amount + m.payslip_amount, payment_approval_id = NULL, payslip_amount = NULL,
             updated_at = now()
       WHERE id = m.id;
    END LOOP;
  ELSIF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    UPDATE public.staff_claims SET status = 'approved', paid_at = NULL, payment_reference = NULL, payment_approval_id = NULL, updated_at = now()
     WHERE payment_approval_id = NEW.id AND status = 'paid';
    UPDATE public.staff_claims SET payment_approval_id = NULL, updated_at = now() WHERE payment_approval_id = NEW.id;
    UPDATE public.commissions SET payment_approval_id = NULL, payslip_amount = NULL, updated_at = now() WHERE payment_approval_id = NEW.id;
    FOR p IN SELECT * FROM public.commission_payments WHERE payment_approval_id = NEW.id LOOP
      UPDATE public.commissions SET paid_amount = greatest(0, paid_amount - p.amount), updated_at = now() WHERE id = p.commission_id;
      DELETE FROM public.commission_payments WHERE id = p.id;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_payslip_extras_settle ON public.payment_approvals;
CREATE TRIGGER trg_payslip_extras_settle AFTER UPDATE OF status ON public.payment_approvals
  FOR EACH ROW EXECUTE FUNCTION public._trg_payslip_extras_settle();

REVOKE ALL ON FUNCTION public._trg_payslip_extras_settle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._payslip_can_edit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._payslip_can_edit(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.pay_via_save(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payslip_extras(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payslip_remove_extra(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_via_save(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payslip_extras(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payslip_remove_extra(uuid, text, uuid) TO authenticated;
