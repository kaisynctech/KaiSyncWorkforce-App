-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: quote_to_job_conversion  (Phase 2D.4)
--
-- 1. Add source_quote_id to jobs (bidirectional traceability).
-- 2. Create hr_convert_quote_to_job RPC (atomic: job INSERT + quote UPDATE).
-- 3. Update hr_get_contractor_activity to include the new conversion event.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Bidirectional link ────────────────────────────────────────────────────
-- contractor_quotes already has converted_to_job_id (quote → job).
-- Add jobs.source_quote_id for the reverse direction (job → quote).

ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS source_quote_id uuid
        REFERENCES public.contractor_quotes(id) ON DELETE SET NULL;


-- ── 2. hr_convert_quote_to_job ───────────────────────────────────────────────
-- Atomically:
--   a) Validates quote is approved and not yet converted.
--   b) Generates a job code via _next_job_code().
--   c) Inserts a new job record linked to the contractor.
--   d) Updates contractor_quotes: status='converted', converted_to_job_id, converted_at.
--   e) Logs to app_events.
--   f) Returns {job_id, job_code} JSON for the client to display.
--
-- Server-side duplicate-conversion guard: raises EXCEPTION if quote is not
-- in 'approved' status or already has converted_to_job_id set.

CREATE OR REPLACE FUNCTION public.hr_convert_quote_to_job(
    p_company_id      uuid,
    p_hr_user_id      uuid,
    p_quote_id        uuid,
    p_job_title       text,
    p_description     text    DEFAULT NULL,
    p_priority        text    DEFAULT 'normal',
    p_scheduled_start timestamptz DEFAULT NULL,
    p_scheduled_end   timestamptz DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_quote  record;
    v_job_id uuid;
    v_code   text;
BEGIN
    -- ── Validate (with row lock to prevent races) ────────────────────────────
    SELECT * INTO v_quote
    FROM public.contractor_quotes
    WHERE id         = p_quote_id
      AND company_id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quote not found';
    END IF;

    IF v_quote.status != 'approved' THEN
        RAISE EXCEPTION 'Only approved quotes can be converted (current status: %)',
            v_quote.status;
    END IF;

    IF v_quote.converted_to_job_id IS NOT NULL THEN
        RAISE EXCEPTION 'Quote has already been converted to job %',
            v_quote.converted_to_job_id;
    END IF;

    -- ── Generate job code ─────────────────────────────────────────────────────
    v_code := public._next_job_code(p_company_id);

    -- ── Create job ────────────────────────────────────────────────────────────
    INSERT INTO public.jobs (
        company_id,
        title,
        description,
        status,
        priority,
        contractor_id,
        contractor_cost,
        estimated_cost,
        source_quote_id,
        external_ref,
        scheduled_start,
        scheduled_end,
        created_by_employee_id,
        job_code,
        created_at,
        updated_at
    ) VALUES (
        p_company_id,
        trim(p_job_title),
        trim(coalesce(p_description, '')),
        'scheduled',
        coalesce(p_priority, 'normal'),
        v_quote.contractor_id,
        v_quote.total_amount,
        v_quote.total_amount,
        p_quote_id,
        'quote:' || p_quote_id::text,  -- also store as text for legacy searches
        p_scheduled_start,
        p_scheduled_end,
        p_hr_user_id,
        v_code,
        now(),
        now()
    )
    RETURNING id INTO v_job_id;

    -- ── Mark quote as converted ───────────────────────────────────────────────
    UPDATE public.contractor_quotes SET
        status              = 'converted',
        converted_to_job_id = v_job_id,
        converted_at        = now(),
        updated_at          = now()
    WHERE id         = p_quote_id
      AND company_id = p_company_id;

    -- ── Audit log ─────────────────────────────────────────────────────────────
    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
    VALUES (
        p_company_id,
        p_hr_user_id,
        'contractor_quotes',
        'contractor_quote_converted_to_job',
        'info',
        jsonb_build_object(
            'quote_id',      p_quote_id,
            'job_id',        v_job_id,
            'job_code',      v_code,
            'job_title',     p_job_title,
            'quote_number',  v_quote.quote_number,
            'total_amount',  v_quote.total_amount,
            'contractor_id', v_quote.contractor_id
        )
    );

    RETURN json_build_object(
        'job_id',   v_job_id,
        'job_code', v_code
    );
END;
$$;


-- ── 3. Update hr_get_contractor_activity ─────────────────────────────────────
-- Add contractor_quote_converted_to_job to the activity feed.

CREATE OR REPLACE FUNCTION public.hr_get_contractor_activity(
    p_company_id uuid,
    p_limit      int DEFAULT 50
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN coalesce((
        SELECT json_agg(row_to_json(a))
        FROM (
            SELECT
                ae.id::text  AS id,
                ae.screen,
                ae.action,
                ae.created_at,

                coalesce(
                    ae.meta->>'contractor_id',
                    CASE
                        WHEN ae.meta->>'quote_id' IS NOT NULL
                        THEN (
                            SELECT cq.contractor_id::text
                            FROM public.contractor_quotes cq
                            WHERE cq.id = (ae.meta->>'quote_id')::uuid
                            LIMIT 1
                        )
                        ELSE NULL
                    END,
                    ''
                ) AS contractor_id,

                coalesce((
                    SELECT c2.name
                    FROM public.contractors c2
                    WHERE c2.id = coalesce(
                        (ae.meta->>'contractor_id')::uuid,
                        (SELECT cq2.contractor_id FROM public.contractor_quotes cq2
                         WHERE cq2.id = (ae.meta->>'quote_id')::uuid LIMIT 1)
                    )
                    AND c2.company_id = ae.company_id
                    LIMIT 1
                ), '') AS contractor_name,

                coalesce((
                    SELECT c3.contractor_code
                    FROM public.contractors c3
                    WHERE c3.id = coalesce(
                        (ae.meta->>'contractor_id')::uuid,
                        (SELECT cq3.contractor_id FROM public.contractor_quotes cq3
                         WHERE cq3.id = (ae.meta->>'quote_id')::uuid LIMIT 1)
                    )
                    AND c3.company_id = ae.company_id
                    LIMIT 1
                ), '') AS contractor_code,

                CASE ae.action
                    WHEN 'hr_approve_quote'                     THEN 'quotes'
                    WHEN 'hr_reject_quote'                      THEN 'quotes'
                    WHEN 'hr_request_revision'                  THEN 'quotes'
                    WHEN 'hr_start_review'                      THEN 'quotes'
                    WHEN 'contractor_quote_submitted'           THEN 'quotes'
                    WHEN 'resubmit_quote'                       THEN 'quotes'
                    WHEN 'contractor_quote_converted_to_job'    THEN 'quotes'
                    WHEN 'contractor_banking_update_submitted'  THEN 'banking'
                    WHEN 'contractor_banking_update_approved'   THEN 'banking'
                    WHEN 'contractor_banking_update_rejected'   THEN 'banking'
                    WHEN 'contractor_profile_updated'           THEN 'profile'
                    WHEN 'contractor_tax_updated'               THEN 'profile'
                    ELSE 'other'
                END AS event_type,

                CASE ae.action
                    WHEN 'hr_approve_quote'                     THEN 'Quote Approved'
                    WHEN 'hr_reject_quote'                      THEN 'Quote Rejected'
                    WHEN 'hr_request_revision'                  THEN 'Revision Requested'
                    WHEN 'hr_start_review'                      THEN 'Under Review'
                    WHEN 'contractor_quote_submitted'           THEN 'Quote Submitted'
                    WHEN 'resubmit_quote'                       THEN 'Quote Resubmitted'
                    WHEN 'contractor_quote_converted_to_job'    THEN 'Converted to Job'
                    WHEN 'contractor_banking_update_submitted'  THEN 'Banking Submitted'
                    WHEN 'contractor_banking_update_approved'   THEN 'Banking Approved'
                    WHEN 'contractor_banking_update_rejected'   THEN 'Banking Rejected'
                    WHEN 'contractor_profile_updated'           THEN 'Profile Updated'
                    WHEN 'contractor_tax_updated'               THEN 'Tax/VAT Updated'
                    ELSE ae.action
                END AS event_label,

                CASE ae.action
                    WHEN 'hr_approve_quote'
                        THEN coalesce('Quote ' || (ae.meta->>'quote_number'), 'Quote') || ' approved'
                    WHEN 'hr_reject_quote'
                        THEN left(coalesce(ae.meta->>'rejection_reason', 'Rejected'), 80)
                    WHEN 'hr_request_revision'
                        THEN left(coalesce(ae.meta->>'revision_comments', 'Revisions requested'), 80)
                    WHEN 'hr_start_review'
                        THEN 'Quote opened for review'
                    WHEN 'contractor_quote_submitted'
                        THEN coalesce(
                            CASE WHEN ae.meta->>'quote_number' IS NOT NULL
                                 THEN 'Quote ' || (ae.meta->>'quote_number') || ' submitted'
                            END, 'Quote submitted for review')
                    WHEN 'resubmit_quote'
                        THEN coalesce('Quote ' || (ae.meta->>'quote_number'), 'Quote') || ' resubmitted after revision'
                    WHEN 'contractor_quote_converted_to_job'
                        THEN coalesce('Quote ' || (ae.meta->>'quote_number'), 'Quote') ||
                             ' → Job ' || coalesce(ae.meta->>'job_code', '')
                    WHEN 'contractor_banking_update_submitted'  THEN 'Banking details update awaiting approval'
                    WHEN 'contractor_banking_update_approved'   THEN 'Banking details approved'
                    WHEN 'contractor_banking_update_rejected'   THEN 'Banking update rejected'
                    WHEN 'contractor_profile_updated'           THEN 'Profile information updated'
                    WHEN 'contractor_tax_updated'               THEN 'Tax / VAT details updated'
                    ELSE ae.action
                END AS summary,

                CASE ae.screen
                    WHEN 'ContractorPortal'  THEN 'Portal'
                    WHEN 'contractor_portal' THEN 'Portal'
                    ELSE 'HR'
                END AS source

            FROM app_events ae
            WHERE ae.company_id = p_company_id
              AND ae.action IN (
                'hr_approve_quote', 'hr_reject_quote', 'hr_request_revision', 'hr_start_review',
                'contractor_quote_submitted', 'resubmit_quote',
                'contractor_quote_converted_to_job',
                'contractor_banking_update_submitted',
                'contractor_banking_update_approved',
                'contractor_banking_update_rejected',
                'contractor_profile_updated', 'contractor_tax_updated'
              )
            ORDER BY ae.created_at DESC
            LIMIT p_limit
        ) a
    ), '[]'::json);
END;
$$;;
