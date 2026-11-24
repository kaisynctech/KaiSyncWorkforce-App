-- 20261021080556_notify_hr_client_profile_updated
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

CREATE OR REPLACE FUNCTION public.notify_hr_client_profile_updated(
  p_company_id uuid, p_client_id uuid, p_changes_summary text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
  v_hour text := to_char(now(), 'YYYYMMDDHH24');
  r record;
BEGIN
  SELECT coalesce(nullif(trim(name), ''), 'Client') INTO v_name FROM public.clients WHERE id = p_client_id;
  FOR r IN
    SELECT DISTINCT e.user_id AS auth_user_id, e.id AS employee_id
    FROM public.employees e
    WHERE e.company_id = p_company_id AND e.is_active = true AND e.user_id IS NOT NULL
      AND e.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
  LOOP
    INSERT INTO public.app_notifications (
      company_id, audience, recipient_auth_user_id, recipient_employee_id,
      type, title, body, ref_type, ref_id, dedupe_key, data)
    VALUES (
      p_company_id, 'hr', r.auth_user_id, r.employee_id,
      'client_profile_updated', 'Client Details Updated',
      coalesce(v_name, 'Client') || ' updated their details in the client portal (' || p_changes_summary || '). See the client''s Activity tab.',
      'client', p_client_id::text,
      'client_profile_updated:' || p_client_id::text || ':' || r.employee_id::text || ':' || v_hour,
      jsonb_build_object('client_id', p_client_id, 'changes', p_changes_summary))
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;
END;
$$;
ALTER FUNCTION public.notify_hr_client_profile_updated(uuid, uuid, text) OWNER TO postgres;
