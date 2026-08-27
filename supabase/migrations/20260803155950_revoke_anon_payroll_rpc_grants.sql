-- P0 payroll hardening: remove anonymous EXECUTE on financially sensitive RPCs.
REVOKE EXECUTE ON FUNCTION public.hr_generate_payroll(uuid, date, date) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hr_recalculate_payslip(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hr_lock_payroll_period(uuid, date, date) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hr_unlock_payroll_period(uuid, date, date) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.hr_generate_payroll(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hr_recalculate_payslip(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hr_lock_payroll_period(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hr_unlock_payroll_period(uuid, date, date) TO authenticated, service_role;
