-- Client job detail includes assigned employees and whether each one is on site.
-- On site means an open clock-in on this job, or an open site sign-in. Contractor names stay omitted.

CREATE OR REPLACE FUNCTION public.client_portal_get_job(
  p_company_code text,
  p_client_code  text,
  p_job_id       uuid
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(t)
  FROM (
    SELECT
      j.id,
      j.job_code,
      j.title,
      j.description,
      j.status,
      j.priority,
      j.address,
      s.name AS site_name,
      s.address AS site_address,
      j.scheduled_start,
      j.scheduled_end,
      j.opened_at,
      j.closed_at,
      j.updated_at,
      d.id AS deal_id,
      d.project_code,
      d.title AS project_title,
      COALESCE((
        SELECT json_agg(url)
        FROM unnest(COALESCE(j.photo_urls_before, '{}'::text[])) AS url
        WHERE trim(url) <> ''
      ), '[]'::json) AS photos_before,
      COALESCE((
        SELECT json_agg(url)
        FROM unnest(COALESCE(j.photo_urls_after, '{}'::text[])) AS url
        WHERE trim(url) <> ''
      ), '[]'::json) AS photos_after,
      COALESCE((
        SELECT json_agg(url)
        FROM unnest(COALESCE(j.photo_urls, '{}'::text[])) AS url
        WHERE trim(url) <> ''
      ), '[]'::json) AS photos,
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'id', e.id,
            'name', trim(both FROM concat_ws(' ', nullif(trim(e.name), ''), nullif(trim(e.surname), ''))),
            'on_site', (open_visit.sign_in_at IS NOT NULL OR open_punch.date_time IS NOT NULL),
            'since', CASE
              WHEN open_visit.sign_in_at IS NULL THEN open_punch.date_time
              WHEN open_punch.date_time IS NULL THEN open_visit.sign_in_at
              ELSE least(open_visit.sign_in_at, open_punch.date_time)
            END
          )
          ORDER BY (open_visit.sign_in_at IS NOT NULL OR open_punch.date_time IS NOT NULL) DESC, e.name, e.surname
        )
        FROM public.employees e
        LEFT JOIN LATERAL (
          SELECT v.sign_in_at
          FROM public.job_site_visits v
          WHERE v.company_id = j.company_id
            AND v.job_id = j.id
            AND v.employee_id = e.id
            AND v.party_type = 'employee'
            AND v.sign_out_at IS NULL
          ORDER BY v.sign_in_at DESC
          LIMIT 1
        ) open_visit ON true
        LEFT JOIN LATERAL (
          SELECT p.date_time
          FROM public.time_punches p
          WHERE p.company_id = j.company_id
            AND p.employee_id = e.id
            AND p.type = 'in'
            AND p.job_id = j.id
            AND p.date_time = (
              SELECT max(latest.date_time)
              FROM public.time_punches latest
              WHERE latest.company_id = j.company_id
                AND latest.employee_id = e.id
            )
          LIMIT 1
        ) open_punch ON true
        WHERE e.company_id = j.company_id
          AND e.id = ANY (
            COALESCE(j.assigned_employee_ids, '{}'::uuid[])
            || CASE
                 WHEN j.assignee_employee_id IS NOT NULL THEN ARRAY[j.assignee_employee_id]
                 ELSE '{}'::uuid[]
               END
          )
      ), '[]'::json) AS team,
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'description', ci.description,
            'is_checked', ci.is_checked,
            'sort_order', ci.sort_order
          )
          ORDER BY ci.sort_order, ci.description
        )
        FROM public.job_checklist_items ci
        WHERE ci.job_id = j.id
          AND ci.company_id = j.company_id
      ), '[]'::json) AS checklist,
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'sign_in_at', v.sign_in_at,
            'sign_out_at', v.sign_out_at,
            'sign_in_address', v.sign_in_address,
            'sign_out_address', v.sign_out_address,
            'notes', v.notes
          )
          ORDER BY v.sign_in_at DESC
        )
        FROM public.job_site_visits v
        WHERE v.job_id = j.id
          AND v.company_id = j.company_id
      ), '[]'::json) AS visits,
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'id', doc.id,
            'document_name', doc.document_name,
            'document_type', doc.document_type,
            'file_url', doc.file_url,
            'created_at', doc.created_at
          )
          ORDER BY doc.created_at DESC
        )
        FROM public.job_documents doc
        WHERE doc.job_id = j.id
          AND doc.company_id = j.company_id
      ), '[]'::json) AS documents
    FROM public.jobs j
    INNER JOIN public.companies c
      ON c.id = j.company_id
    INNER JOIN public.clients cl
      ON cl.company_id = j.company_id
     AND cl.client_code IS NOT NULL
     AND COALESCE(cl.portal_enabled, false) = true
     AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
    LEFT JOIN public.sites s
      ON s.id = j.site_id
     AND s.company_id = j.company_id
    LEFT JOIN public.client_deals d
      ON d.id = j.deal_id
     AND d.company_id = j.company_id
     AND d.client_id = cl.id
     AND d.visibility <> 'private'
    WHERE j.id = p_job_id
      AND upper(trim(c.code)) = upper(trim(p_company_code))
      AND (
        j.client_id = cl.id
        OR d.id IS NOT NULL
      )
      AND j.visibility IS DISTINCT FROM 'private'
      AND NOT (
        j.visibility = 'inherit'
        AND d.id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.client_deals hidden
          WHERE hidden.id = j.deal_id
            AND hidden.company_id = j.company_id
            AND hidden.client_id = cl.id
            AND hidden.visibility = 'private'
        )
      )
  ) t;
$$;

REVOKE ALL ON FUNCTION public.client_portal_get_job(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_portal_get_job(text, text, uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.client_portal_get_job(text, text, uuid) IS
  'One client-visible job: status, assigned employees, on-site state, photos, checklist, visit times, and documents. Omits contractor identity, costs, and coordinates.';
