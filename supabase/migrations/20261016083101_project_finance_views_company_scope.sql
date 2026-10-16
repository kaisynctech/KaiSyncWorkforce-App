-- Project finance views were running as the owner, so company row security
-- on the tables underneath was skipped. Run them as the caller so each
-- company only sees its own projects, invoices, costs, and purchase orders.
-- The public anon role does not need to read these views.

ALTER VIEW public.project_financial_summary SET (security_invoker = true);
ALTER VIEW public.project_cost_variance SET (security_invoker = true);

REVOKE ALL ON TABLE public.project_financial_summary FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.project_cost_variance FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.project_financial_summary TO authenticated;
GRANT SELECT ON TABLE public.project_cost_variance TO authenticated;

COMMENT ON VIEW public.project_financial_summary IS
  'One row per project. security_invoker: the caller only sees rows their company policies allow.';

COMMENT ON VIEW public.project_cost_variance IS
  'Project cost variance. security_invoker: the caller only sees rows their company policies allow.';
