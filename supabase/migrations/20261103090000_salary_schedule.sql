-- Insights: salary schedule (one row per person, the way payroll offices send it to the bank / accountant).
-- Same people who may open payslips (owner, HR and admins) may run it — managers may not, even though
-- they can see the payroll totals on the dashboard.
--
-- Columns: salary, overtime, other payments, other deductions, PAYE, UIF, MEIBC, total paid.
-- Payslips made by the payroll screen carry a breakdown (labels PAYE, UIF, MEIBC/MIEBC, …); older or
-- imported payslips without one show their whole deduction under "Deductions".

CREATE OR REPLACE FUNCTION public.insights_salary_schedule(p_company_id uuid, p_from date, p_to date,
  p_branch text DEFAULT NULL, p_department text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_company_id IS NULL OR NOT (p_company_id = ANY (public.user_company_ids()))
     OR NOT public.role_is_hr_or_above(public.get_my_role(p_company_id)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'BAD_RANGE'; END IF;
  p_branch := nullif(p_branch, ''); p_department := nullif(p_department, '');
  RETURN coalesce((
    WITH slip AS (
      SELECT p.employee_id, p.status,
             coalesce(p.gross_pay, 0)::numeric gross, coalesce(p.net_pay, 0)::numeric net, coalesce(p.deductions, 0)::numeric ded,
             coalesce(p.overtime_pay, 0)::numeric ot,
             (coalesce(p.bonus_amount, 0) + greatest(coalesce(p.manual_adjustment, 0), 0)
              + coalesce((p.payslip_lines ->> 'incentive')::numeric, 0) + coalesce((p.payslip_lines ->> 'refund')::numeric, 0)
              + coalesce((SELECT sum((x ->> 'amount')::numeric) FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(p.payslip_lines -> 'extraEarnings') = 'array' THEN p.payslip_lines -> 'extraEarnings' ELSE '[]' END) x), 0)
             )::numeric other_pay,
             coalesce((SELECT sum((x ->> 'amount')::numeric) FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(p.deductions_breakdown) = 'array' THEN p.deductions_breakdown ELSE '[]' END) x
               WHERE upper(trim(x ->> 'label')) = 'PAYE'), (p.payslip_lines ->> 'paye')::numeric, 0) paye,
             coalesce((SELECT sum((x ->> 'amount')::numeric) FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(p.deductions_breakdown) = 'array' THEN p.deductions_breakdown ELSE '[]' END) x
               WHERE upper(trim(x ->> 'label')) = 'UIF'), (p.payslip_lines ->> 'uif')::numeric, 0) uif,
             coalesce((SELECT sum((x ->> 'amount')::numeric) FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(p.deductions_breakdown) = 'array' THEN p.deductions_breakdown ELSE '[]' END) x
               WHERE upper(replace(trim(x ->> 'label'), ' ', '')) IN ('MEIBC', 'MIEBC', 'MIBCO')), 0) meibc
      FROM payment_approvals p JOIN employees e ON e.id = p.employee_id
      WHERE p.company_id = p_company_id AND p.status <> 'rejected' AND p.period_end BETWEEN p_from AND p_to
        AND (coalesce(p.gross_pay, 0) <> 0 OR coalesce(p.net_pay, 0) <> 0)
        AND (p_branch IS NULL OR e.branch = p_branch) AND (p_department IS NULL OR e.department = p_department)),
    per AS (
      SELECT employee_id, count(*) payslips,
             sum(gross - ot - other_pay) salary, sum(ot) overtime, sum(other_pay) other_payments,
             sum(greatest(ded - paye - uif - meibc, 0)) other_deductions, sum(paye) paye, sum(uif) uif, sum(meibc) meibc,
             sum(net) total_paid, sum(gross) gross,
             CASE WHEN bool_and(status = 'paid') THEN 'paid' WHEN bool_and(status IN ('paid', 'approved')) THEN 'approved' ELSE 'pending' END status
      FROM slip GROUP BY 1)
    SELECT jsonb_agg(x ORDER BY x.name) FROM (
      SELECT per.employee_id, trim(e.name || ' ' || coalesce(e.surname, '')) AS name,
             coalesce(e.employee_number, e.employee_code) AS code, e.department, e.branch, per.payslips, per.status,
             round(per.salary, 2) salary, round(per.overtime, 2) overtime, round(per.other_payments, 2) other_payments,
             round(per.other_deductions, 2) other_deductions, round(per.paye, 2) paye, round(per.uif, 2) uif,
             round(per.meibc, 2) meibc, round(per.total_paid, 2) total_paid, round(per.gross, 2) gross
      FROM per JOIN employees e ON e.id = per.employee_id) x), '[]'::jsonb);
END $$;

-- Permissions (run separately):
-- REVOKE ALL ON FUNCTION public.insights_salary_schedule(uuid, date, date, text, text) FROM PUBLIC, anon;
-- GRANT EXECUTE ON FUNCTION public.insights_salary_schedule(uuid, date, date, text, text) TO authenticated;
