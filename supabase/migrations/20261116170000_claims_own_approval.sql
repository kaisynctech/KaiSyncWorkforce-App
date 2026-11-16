-- 10a follow-up: office people (owner, HR, managers) claim through "My claims", and nobody approves their own claim.
-- Before: HR and above could approve their own. Now only the owner may (nobody sits above them); everyone else needs
-- someone else. Also: a claim can't be marked paid by the person it pays, unless they're the owner.
-- Rollback: re-run the old definitions kept in _fn_backup ('claims_decide before own-approval',
--           'claims_mark_paid before own-approval').

DO $$
BEGIN
  INSERT INTO public._fn_backup (name, def)
    VALUES ('claims_decide before own-approval', pg_get_functiondef('public.claims_decide(uuid[], text, text)'::regprocedure))
    ON CONFLICT (name) DO NOTHING;
  INSERT INTO public._fn_backup (name, def)
    VALUES ('claims_mark_paid before own-approval', pg_get_functiondef('public.claims_mark_paid(uuid[], date, text, text)'::regprocedure))
    ON CONFLICT (name) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.claims_decide(p_claim_ids uuid[], p_decision text, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.staff_claims%ROWTYPE; v_n int := 0; v_me uuid;
BEGIN
  IF p_decision NOT IN ('approve', 'query', 'reject') THEN RAISE EXCEPTION 'BAD_DECISION'; END IF;
  IF p_decision IN ('query', 'reject') AND length(trim(coalesce(p_note, ''))) < 2 THEN RAISE EXCEPTION 'NOTE_REQUIRED'; END IF;
  FOR c IN SELECT * FROM public.staff_claims WHERE id = ANY (p_claim_ids) FOR UPDATE LOOP
    IF NOT public._can_decide_claims(c.company_id, c.employee_id) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    v_me := public._my_employee_id(c.company_id);
    IF v_me = c.employee_id AND public.get_my_role(c.company_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'OWN_CLAIM'; END IF;
    IF c.status NOT IN ('submitted', 'queried', 'approved') OR (c.status = 'approved' AND p_decision = 'approve') THEN CONTINUE; END IF;
    UPDATE public.staff_claims SET
      status = CASE p_decision WHEN 'approve' THEN 'approved' WHEN 'query' THEN 'queried' ELSE 'rejected' END,
      manager_note = nullif(trim(coalesce(p_note, '')), ''), decided_by = v_me, decided_at = now(), updated_at = now()
     WHERE id = c.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.claims_mark_paid(p_claim_ids uuid[], p_paid_on date, p_method text DEFAULT 'eft', p_reference text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.staff_claims%ROWTYPE; v_n int := 0; v_me uuid; v_name text;
BEGIN
  FOR c IN SELECT * FROM public.staff_claims WHERE id = ANY (p_claim_ids) FOR UPDATE LOOP
    IF NOT (c.company_id = ANY (public.user_company_ids())) OR NOT public.role_is_hr_or_above(public.get_my_role(c.company_id)) THEN
      RAISE EXCEPTION 'NOT_ALLOWED';
    END IF;
    IF c.status <> 'approved' THEN CONTINUE; END IF;
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
