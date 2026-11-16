-- Piece 10a: staff claims (travel and receipts), phone first.
-- Decided 16 Nov 2026:
--  • Travel km: KaiSync suggests from the day's clock-ins (positions) and job sites; the person confirms or types km.
--  • Approved claims are paid OUTSIDE payroll for now (a payment with a reference, recorded in Money out). Moving them
--    to the payslip as a non-taxable reimbursement waits for the accountant (piece 10c).
--  • Approvers: HR / owner / admin, or the person's manager. An approved claim on a job is part of that job's cost;
--    "bill to client" marks it to go on the client's invoice.
-- Rollback: DROP the functions below; DROP TABLE public.staff_claims; ALTER TABLE public.companies DROP COLUMN claim_km_rate;

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS claim_km_rate numeric CHECK (claim_km_rate IS NULL OR (claim_km_rate >= 0 AND claim_km_rate < 100));

CREATE TABLE IF NOT EXISTS public.staff_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('travel', 'toll', 'parking', 'meal', 'parts', 'other')),
  claim_date date NOT NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  description text CHECK (description IS NULL OR length(description) <= 500),
  from_place text CHECK (from_place IS NULL OR length(from_place) <= 200),
  to_place text CHECK (to_place IS NULL OR length(to_place) <= 200),
  km numeric CHECK (km IS NULL OR (km > 0 AND km < 5000)),
  vehicle text CHECK (vehicle IS NULL OR vehicle IN ('own', 'company')),
  rate_per_km numeric,
  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0 AND amount < 1000000),
  receipt_path text,
  bill_to_client boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'queried', 'approved', 'rejected', 'paid', 'cancelled')),
  manager_note text,
  decided_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  decided_at timestamptz,
  paid_at date,
  payment_reference text,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_claims_company_status ON public.staff_claims (company_id, status, claim_date DESC);
CREATE INDEX IF NOT EXISTS staff_claims_employee ON public.staff_claims (employee_id, claim_date DESC);
CREATE INDEX IF NOT EXISTS staff_claims_job ON public.staff_claims (job_id) WHERE job_id IS NOT NULL;

ALTER TABLE public.staff_claims ENABLE ROW LEVEL SECURITY;

-- Can the signed-in person approve this employee's claims? HR and above, or their manager.
CREATE OR REPLACE FUNCTION public._can_decide_claims(p_company_id uuid, p_employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_company_id = ANY (public.user_company_ids()) AND (
    public.role_is_hr_or_above(public.get_my_role(p_company_id))
    OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee_id AND e.company_id = p_company_id
                AND e.manager_id IS NOT NULL AND e.manager_id = public._my_employee_id(p_company_id))
  );
$$;

-- The office reads what it may decide on; staff read and write their own through the employee_* functions below.
DROP POLICY IF EXISTS staff_claims_read ON public.staff_claims;
CREATE POLICY staff_claims_read ON public.staff_claims FOR SELECT
  USING (public._can_decide_claims(company_id, employee_id)
         OR (company_id = ANY (public.user_company_ids()) AND employee_id = public._my_employee_id(company_id)));
-- No direct insert/update/delete: every change goes through the functions (status rules, amounts, money out).

CREATE OR REPLACE FUNCTION public._claim_json(c public.staff_claims)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT to_jsonb(c) || jsonb_build_object(
    'job_code', (SELECT j.job_code FROM public.jobs j WHERE j.id = c.job_id),
    'job_title', (SELECT j.title FROM public.jobs j WHERE j.id = c.job_id));
$$;

-- ── Staff side (code sign-in or own login) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.employee_list_claims(p_company_id uuid, p_employee_id uuid, p_session_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN jsonb_build_object(
    'km_rate', (SELECT claim_km_rate FROM public.companies WHERE id = p_company_id),
    'claims', coalesce((SELECT jsonb_agg(public._claim_json(c) ORDER BY c.claim_date DESC, c.created_at DESC)
                          FROM public.staff_claims c
                         WHERE c.company_id = p_company_id AND c.employee_id = p_employee_id
                           AND c.claim_date > (now() - interval '180 days')::date), '[]'::jsonb),
    'jobs', coalesce((SELECT jsonb_agg(jsonb_build_object('id', j.id, 'job_code', j.job_code, 'title', j.title) ORDER BY j.job_code DESC)
                        FROM public.jobs j
                       WHERE j.company_id = p_company_id AND public._employee_assigned_to_job(p_company_id, p_employee_id, j.id)
                         AND coalesce(j.status, '') NOT IN ('cancelled')), '[]'::jsonb));
END $$;

-- The day's places, for suggesting trips: clock-ins with a position or a job (and the job's site position).
CREATE OR REPLACE FUNCTION public.employee_claim_day(p_company_id uuid, p_employee_id uuid, p_date date, p_session_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'type', t.type, 'at', t.date_time, 'job_id', t.job_id, 'job_code', j.job_code,
      'lat', coalesce(t.latitude, s.latitude), 'lng', coalesce(t.longitude, s.longitude),
      'place', coalesce(nullif(s.name, ''), nullif(t.address, ''), nullif(j.address, ''), s.address)
    ) ORDER BY t.date_time)
      FROM public.time_punches t
      LEFT JOIN public.jobs j ON j.id = t.job_id
      LEFT JOIN public.sites s ON s.id = j.site_id
     WHERE t.company_id = p_company_id AND t.employee_id = p_employee_id
       AND (t.date_time AT TIME ZONE 'Africa/Johannesburg')::date = p_date), '[]'::jsonb);
END $$;

-- Add or change a claim (while it is waiting or was queried). p_claim: { id?, kind, claim_date, job_id?, description?,
-- from_place?, to_place?, km?, vehicle?, amount?, receipt_path?, bill_to_client? }. Travel by own car: amount = km × rate.
CREATE OR REPLACE FUNCTION public.employee_save_claim(p_company_id uuid, p_employee_id uuid, p_claim jsonb, p_session_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := nullif(p_claim ->> 'id', '')::uuid;
  v_old public.staff_claims%ROWTYPE;
  v_kind text := p_claim ->> 'kind';
  v_job uuid := nullif(p_claim ->> 'job_id', '')::uuid;
  v_km numeric := nullif(p_claim ->> 'km', '')::numeric;
  v_vehicle text := coalesce(nullif(p_claim ->> 'vehicle', ''), CASE WHEN p_claim ->> 'kind' = 'travel' THEN 'own' END);
  v_rate numeric;
  v_amount numeric := coalesce(nullif(p_claim ->> 'amount', '')::numeric, 0);
  v_receipt text := nullif(trim(coalesce(p_claim ->> 'receipt_path', '')), '');
  v_row public.staff_claims%ROWTYPE;
  v_name text;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  IF v_kind NOT IN ('travel', 'toll', 'parking', 'meal', 'parts', 'other') THEN RAISE EXCEPTION 'BAD_KIND'; END IF;
  IF v_job IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = v_job AND company_id = p_company_id) THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;
  IF v_receipt IS NOT NULL AND v_receipt NOT LIKE 'employee_documents/' || p_company_id || '/' || p_employee_id || '/claims/%' THEN
    RAISE EXCEPTION 'BAD_RECEIPT_PATH';
  END IF;
  IF v_kind = 'travel' THEN
    IF v_km IS NULL OR v_km <= 0 THEN RAISE EXCEPTION 'KM_REQUIRED'; END IF;
    IF v_vehicle = 'own' THEN
      SELECT claim_km_rate INTO v_rate FROM public.companies WHERE id = p_company_id;
      IF v_rate IS NULL THEN RAISE EXCEPTION 'KM_RATE_NOT_SET'; END IF;
      v_amount := round(v_km * v_rate, 2);
    ELSE
      v_amount := 0;   -- company vehicle: counts as travel and job cost, nothing paid per km
    END IF;
  ELSIF v_amount <= 0 THEN
    RAISE EXCEPTION 'AMOUNT_REQUIRED';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.staff_claims WHERE id = v_id AND company_id = p_company_id AND employee_id = p_employee_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
    IF v_old.status NOT IN ('submitted', 'queried') THEN RAISE EXCEPTION 'CLAIM_LOCKED'; END IF;
    UPDATE public.staff_claims SET kind = v_kind, claim_date = (p_claim ->> 'claim_date')::date, job_id = v_job,
      description = nullif(trim(coalesce(p_claim ->> 'description', '')), ''),
      from_place = nullif(trim(coalesce(p_claim ->> 'from_place', '')), ''), to_place = nullif(trim(coalesce(p_claim ->> 'to_place', '')), ''),
      km = CASE WHEN v_kind = 'travel' THEN v_km END, vehicle = CASE WHEN v_kind = 'travel' THEN v_vehicle END,
      rate_per_km = v_rate, amount = v_amount, receipt_path = v_receipt,
      bill_to_client = coalesce((p_claim ->> 'bill_to_client')::boolean, false),
      status = 'submitted', updated_at = now()
     WHERE id = v_id RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.staff_claims (company_id, employee_id, kind, claim_date, job_id, description, from_place, to_place,
      km, vehicle, rate_per_km, amount, receipt_path, bill_to_client, created_by)
    VALUES (p_company_id, p_employee_id, v_kind, coalesce((p_claim ->> 'claim_date')::date, (now() AT TIME ZONE 'Africa/Johannesburg')::date),
      v_job, nullif(trim(coalesce(p_claim ->> 'description', '')), ''),
      nullif(trim(coalesce(p_claim ->> 'from_place', '')), ''), nullif(trim(coalesce(p_claim ->> 'to_place', '')), ''),
      CASE WHEN v_kind = 'travel' THEN v_km END, CASE WHEN v_kind = 'travel' THEN v_vehicle END, v_rate, v_amount, v_receipt,
      coalesce((p_claim ->> 'bill_to_client')::boolean, false), p_employee_id)
    RETURNING * INTO v_row;
    SELECT nullif(btrim(concat_ws(' ', name, surname)), '') INTO v_name FROM public.employees WHERE id = p_employee_id;
    PERFORM public._notify_office(p_company_id, 'staff_claim', coalesce(v_name, 'Someone') || ' sent a claim',
      CASE v_kind WHEN 'travel' THEN 'Travel ' || v_km || ' km' ELSE initcap(v_kind) END || ' · R ' || to_char(v_amount, 'FM999G999G990D00'),
      'staff_claim', v_row.id::text, 'staff_claim:' || v_row.id, jsonb_build_object('claim_id', v_row.id, 'employee_id', p_employee_id));
  END IF;
  RETURN public._claim_json(v_row);
END $$;

CREATE OR REPLACE FUNCTION public.employee_cancel_claim(p_company_id uuid, p_employee_id uuid, p_claim_id uuid, p_session_token text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  UPDATE public.staff_claims SET status = 'cancelled', updated_at = now()
   WHERE id = p_claim_id AND company_id = p_company_id AND employee_id = p_employee_id AND status IN ('submitted', 'queried');
  IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_LOCKED'; END IF;
END $$;

-- ── Office side ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claims_set_km_rate(p_company_id uuid, p_rate numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (p_company_id = ANY (public.user_company_ids())) OR NOT public.role_is_hr_or_above(public.get_my_role(p_company_id)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF p_rate IS NOT NULL AND (p_rate < 0 OR p_rate >= 100) THEN RAISE EXCEPTION 'BAD_RATE'; END IF;
  UPDATE public.companies SET claim_km_rate = p_rate WHERE id = p_company_id;
END $$;

-- Approve, query (send back with a note) or reject claims.
CREATE OR REPLACE FUNCTION public.claims_decide(p_claim_ids uuid[], p_decision text, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.staff_claims%ROWTYPE; v_n int := 0; v_me uuid;
BEGIN
  IF p_decision NOT IN ('approve', 'query', 'reject') THEN RAISE EXCEPTION 'BAD_DECISION'; END IF;
  IF p_decision IN ('query', 'reject') AND length(trim(coalesce(p_note, ''))) < 2 THEN RAISE EXCEPTION 'NOTE_REQUIRED'; END IF;
  FOR c IN SELECT * FROM public.staff_claims WHERE id = ANY (p_claim_ids) FOR UPDATE LOOP
    IF NOT public._can_decide_claims(c.company_id, c.employee_id) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    v_me := public._my_employee_id(c.company_id);
    IF v_me = c.employee_id AND NOT public.role_is_hr_or_above(public.get_my_role(c.company_id)) THEN RAISE EXCEPTION 'OWN_CLAIM'; END IF;
    IF c.status NOT IN ('submitted', 'queried', 'approved') OR (c.status = 'approved' AND p_decision = 'approve') THEN CONTINUE; END IF;
    UPDATE public.staff_claims SET
      status = CASE p_decision WHEN 'approve' THEN 'approved' WHEN 'query' THEN 'queried' ELSE 'rejected' END,
      manager_note = nullif(trim(coalesce(p_note, '')), ''), decided_by = v_me, decided_at = now(), updated_at = now()
     WHERE id = c.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- Paid outside payroll: each claim's payment is its own Money-out entry.
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

REVOKE ALL ON FUNCTION public._can_decide_claims(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._can_decide_claims(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public._claim_json(public.staff_claims) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employee_list_claims(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.employee_claim_day(uuid, uuid, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.employee_save_claim(uuid, uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.employee_cancel_claim(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_list_claims(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_claim_day(uuid, uuid, date, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_save_claim(uuid, uuid, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_cancel_claim(uuid, uuid, uuid, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.claims_set_km_rate(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claims_decide(uuid[], text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claims_mark_paid(uuid[], date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claims_set_km_rate(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claims_decide(uuid[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claims_mark_paid(uuid[], date, text, text) TO authenticated;
