
-- ── 1. Lock a payroll period ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_lock_payroll_period(
  p_company_id   uuid,
  p_period_start date,
  p_period_end   date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO payroll_period_locks (company_id, period_start, period_end, locked_by, locked_at)
  SELECT p_company_id, p_period_start, p_period_end, auth.uid(), now()
  WHERE NOT EXISTS (
    SELECT 1 FROM payroll_period_locks
    WHERE company_id   = p_company_id
      AND period_start = p_period_start
      AND period_end   = p_period_end
  );
END;
$$;

-- ── 2. Unlock a payroll period ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_unlock_payroll_period(
  p_company_id   uuid,
  p_period_start date,
  p_period_end   date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM payroll_period_locks
  WHERE company_id   = p_company_id
    AND period_start = p_period_start
    AND period_end   = p_period_end;
END;
$$;

-- ── 3. Generate payroll for a period ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_generate_payroll(
  p_company_id   uuid,
  p_period_start date,
  p_period_end   date
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp   RECORD;
  v_hours numeric;
  v_gross numeric;
  v_count int := 0;
BEGIN
  FOR v_emp IN
    SELECT id, hourly_rate, monthly_salary, pay_basis
    FROM employees
    WHERE company_id = p_company_id
      AND is_active  = true
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM payment_approvals
      WHERE company_id   = p_company_id
        AND employee_id  = v_emp.id
        AND period_start = p_period_start
        AND period_end   = p_period_end
    ) THEN
      -- Hours: sum paired in→out punches whose clock-in falls in the period
      SELECT COALESCE(SUM(
        EXTRACT(EPOCH FROM (
          (SELECT tp_out.date_time
           FROM   time_punches tp_out
           WHERE  tp_out.employee_id = tp_in.employee_id
             AND  tp_out.company_id  = tp_in.company_id
             AND  tp_out.type        = 'out'
             AND  tp_out.date_time   > tp_in.date_time
           ORDER BY tp_out.date_time
           LIMIT 1)
          - tp_in.date_time
        )) / 3600
      ), 0) INTO v_hours
      FROM time_punches tp_in
      WHERE tp_in.employee_id        = v_emp.id
        AND tp_in.company_id         = p_company_id
        AND tp_in.type               = 'in'
        AND tp_in.date_time::date   >= p_period_start
        AND tp_in.date_time::date   <= p_period_end;

      v_gross := CASE
        WHEN v_emp.pay_basis = 'monthly' THEN COALESCE(v_emp.monthly_salary, 0)
        ELSE v_hours * COALESCE(v_emp.hourly_rate, 0)
      END;

      INSERT INTO payment_approvals (
        company_id, employee_id,
        period_start, period_end,
        regular_hours, overtime_hours,
        gross_pay, deductions, net_pay,
        status
      ) VALUES (
        p_company_id, v_emp.id,
        p_period_start, p_period_end,
        v_hours, 0,
        v_gross, 0, v_gross,
        'pending'
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ── 4. Recalculate a single payslip ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_recalculate_payslip(
  p_company_id uuid,
  p_payment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_emp     RECORD;
  v_hours   numeric;
  v_gross   numeric;
BEGIN
  SELECT * INTO v_payment
  FROM payment_approvals
  WHERE id           = p_payment_id
    AND company_id   = p_company_id;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT hourly_rate, monthly_salary, pay_basis INTO v_emp
  FROM employees
  WHERE id = v_payment.employee_id;

  SELECT COALESCE(SUM(
    EXTRACT(EPOCH FROM (
      (SELECT tp_out.date_time
       FROM   time_punches tp_out
       WHERE  tp_out.employee_id = tp_in.employee_id
         AND  tp_out.company_id  = tp_in.company_id
         AND  tp_out.type        = 'out'
         AND  tp_out.date_time   > tp_in.date_time
       ORDER BY tp_out.date_time
       LIMIT 1)
      - tp_in.date_time
    )) / 3600
  ), 0) INTO v_hours
  FROM time_punches tp_in
  WHERE tp_in.employee_id        = v_payment.employee_id
    AND tp_in.company_id         = p_company_id
    AND tp_in.type               = 'in'
    AND tp_in.date_time::date   >= v_payment.period_start
    AND tp_in.date_time::date   <= v_payment.period_end;

  v_gross := CASE
    WHEN v_emp.pay_basis = 'monthly' THEN COALESCE(v_emp.monthly_salary, 0)
    ELSE v_hours * COALESCE(v_emp.hourly_rate, 0)
  END;

  -- Apply manual adjustment and bonus if set on the row
  v_gross := v_gross
    + COALESCE(v_payment.bonus_amount, 0)
    - COALESCE(v_payment.manual_adjustment, 0);

  UPDATE payment_approvals SET
    regular_hours = v_hours,
    gross_pay     = v_gross,
    deductions    = 0,
    net_pay       = v_gross
  WHERE id = p_payment_id;
END;
$$;
;
