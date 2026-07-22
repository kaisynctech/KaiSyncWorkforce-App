-- Code-based contractor portal (MAUI + web) authenticates via company/contractor
-- codes on SECURITY DEFINER RPCs — same pattern as list_jobs / get_job_messages.
-- 20260609130300 revoked anon on visit RPCs, which breaks portal site visits.
-- Restore anon EXECUTE to match original portal design.

GRANT EXECUTE ON FUNCTION public.contractor_portal_visit_history(text, text, uuid)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_open_visit(text, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_site_sign_in(
  text, text, uuid, double precision, double precision, text, text, text
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_site_sign_out(
  text, text, uuid, double precision, double precision, text, text
) TO anon, authenticated;
