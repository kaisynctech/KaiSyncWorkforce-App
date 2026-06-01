-- Client portal message inbox + notify client when HR replies (in-app read tracking is app-side).

CREATE OR REPLACE FUNCTION public.client_portal_list_message_inbox(
  p_company_code text,
  p_client_code  text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(json_agg(row_to_json(x) ORDER BY x.last_message_at DESC NULLS LAST), '[]'::json)
  FROM (
    SELECT
      d.id AS deal_id,
      d.title AS project_title,
      d.project_code,
      t.last_message_at,
      t.last_message_preview,
      (
        SELECT m.sender_client_id IS NULL
        FROM public.app_messages m
        WHERE m.thread_id = t.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS last_from_hr
    FROM public.client_deals d
    INNER JOIN public.clients cl ON cl.id = d.client_id
    INNER JOIN public.companies c ON c.id = d.company_id
    INNER JOIN public.message_threads t
      ON t.company_id = d.company_id
     AND t.subject = public._deal_message_subject(d.id)
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
      AND d.visibility <> 'private'
      AND t.last_message_at IS NOT NULL
  ) x;
$$;

GRANT EXECUTE ON FUNCTION public.client_portal_list_message_inbox(text, text) TO anon, authenticated;

-- When HR/employee sends on a client deal thread, queue client notification (email/SMS if configured).
CREATE OR REPLACE FUNCTION public.trg_app_message_hr_notify_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id uuid;
  v_title   text;
BEGIN
  IF NEW.sender_client_id IS NOT NULL OR NEW.thread_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_deal_id := replace(
      (SELECT subject FROM public.message_threads WHERE id = NEW.thread_id),
      'Deal:', ''
    )::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;

  SELECT title INTO v_title FROM public.client_deals WHERE id = v_deal_id;

  PERFORM public.enqueue_client_portal_notification(
    v_deal_id,
    'new_message',
    'New message: ' || coalesce(v_title, 'Project'),
    coalesce(nullif(trim(NEW.sender_display_name), ''), 'Your contractor') ||
      ': ' || left(trim(NEW.body), 200)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_message_hr_notify_client ON public.app_messages;
CREATE TRIGGER app_message_hr_notify_client
  AFTER INSERT ON public.app_messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_app_message_hr_notify_client();
