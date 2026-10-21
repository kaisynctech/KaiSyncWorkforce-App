-- C4: daily compliance reminders (one system: contractor_documents for contractors AND clients).
-- For each current, approved document with an expiry date, HR gets ONE in-app notification at each
-- stage: 30 days before, 7 days before, and on/after the expiry day. Stages are deduplicated per
-- document + stage + HR person, so re-running is harmless. Documents of ours that we owe a client
-- (direction to_party) remind HR only. Contractors/clients see the reminder in their portal
-- (computed live from the same documents). Nothing is changed on the documents; nothing is blocked.

CREATE OR REPLACE FUNCTION public.run_compliance_reminders(p_company_id uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  d record; r record; v_sent int := 0; v_docs int := 0; v_stage int; v_days int;
  v_title text; v_body text; v_type text;
BEGIN
  FOR d IN
    SELECT cd.id, cd.company_id, cd.document_type, cd.document_name, cd.expiry_date, cd.direction,
           CASE WHEN cd.client_id IS NOT NULL THEN 'client' ELSE 'contractor' END AS kind,
           coalesce(cd.client_id, cd.contractor_id) AS party_id,
           coalesce(nullif(trim(cl.name), ''), nullif(trim(co.name), ''), 'Unknown') AS party_name
    FROM public.contractor_documents cd
    LEFT JOIN public.clients cl ON cl.id = cd.client_id
    LEFT JOIN public.contractors co ON co.id = cd.contractor_id
    WHERE cd.is_current AND cd.approval_status = 'approved' AND cd.expiry_date IS NOT NULL
      AND cd.expiry_date <= current_date + 30
      AND cd.expiry_date >= current_date - 30          -- long-expired documents were already reminded
      AND (p_company_id IS NULL OR cd.company_id = p_company_id)
      AND (cd.contractor_id IS NULL OR coalesce(co.is_active, true))
  LOOP
    v_docs := v_docs + 1;
    v_days := d.expiry_date - current_date;
    v_stage := CASE WHEN v_days <= 0 THEN 0 WHEN v_days <= 7 THEN 7 ELSE 30 END;
    v_type := CASE WHEN v_days < 0 THEN 'compliance_expired' ELSE 'compliance_expiring' END;
    v_title := CASE WHEN v_days < 0 THEN 'Compliance Document Expired'
                    WHEN v_days = 0 THEN 'Compliance Document Expires Today'
                    ELSE 'Compliance Document Expiring' END;
    v_body := CASE WHEN d.direction = 'to_party' THEN 'Our document for ' ELSE '' END
      || d.party_name || ': ' || initcap(replace(d.document_type, '_', ' '))
      || coalesce(' ("' || nullif(nullif(trim(d.document_name), ''), 'none') || '")', '') || ' '
      || CASE WHEN v_days < 0 THEN 'expired on ' || to_char(d.expiry_date, 'DD Mon YYYY')
              WHEN v_days = 0 THEN 'expires today'
              ELSE 'expires in ' || v_days || ' day' || CASE WHEN v_days = 1 THEN '' ELSE 's' END
                   || ' (' || to_char(d.expiry_date, 'DD Mon YYYY') || ')' END
      || CASE WHEN d.direction = 'to_party' THEN ' — upload the new one on the client''s Compliance tab.'
              ELSE ' — ask for a new one or check their Compliance tab.' END;

    FOR r IN
      SELECT DISTINCT e.user_id AS auth_user_id, e.id AS employee_id
      FROM public.employees e
      WHERE e.company_id = d.company_id AND e.is_active = true AND e.user_id IS NOT NULL
        AND e.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
    LOOP
      INSERT INTO public.app_notifications (company_id, audience, recipient_auth_user_id, recipient_employee_id,
        type, title, body, ref_type, ref_id, dedupe_key, data)
      VALUES (d.company_id, 'hr', r.auth_user_id, r.employee_id, v_type, v_title, v_body,
        d.kind, d.party_id::text,
        'compliance_reminder:' || d.id::text || ':' || v_stage::text || ':' || r.employee_id::text,
        jsonb_build_object(d.kind || '_id', d.party_id, 'document_id', d.id, 'document_type', d.document_type,
                           'expiry_date', d.expiry_date, 'stage_days', v_stage, 'direction', d.direction))
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
      IF FOUND THEN v_sent := v_sent + 1; END IF;
    END LOOP;
  END LOOP;

  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (p_company_id, NULL, 'ComplianceJob', 'compliance_reminders_run', 'info',
          jsonb_build_object('documents_due', v_docs, 'notifications_sent', v_sent), now());
  RETURN json_build_object('documents_due', v_docs, 'notifications_sent', v_sent);
END;
$$;

REVOKE ALL ON FUNCTION public.run_compliance_reminders(uuid) FROM PUBLIC, anon, authenticated;

-- Daily at 06:00 South African time (04:00 UTC).
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('compliance-daily-reminders', '0 4 * * *', $$SELECT public.run_compliance_reminders()$$);
