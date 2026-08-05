-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: assign_quote_to_existing_job  (Phase 2D.5)
--
-- 1. hr_assign_quote_to_job  — atomic RPC to link an approved quote to an
--      already-existing job (instead of creating a new one).
--    Multiple quotes can map to the same job (many → 1 via converted_to_job_id).
--    Contractor cost is accumulated; contractor_id is set only when empty.
--
-- 2. Update hr_get_contractor_activity to include the new event type.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. hr_assign_quote_to_job ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_assign_quote_to_job(
    p_company_id uuid,
    p_hr_user_id uuid,
    p_quote_id   uuid,
    p_job_id     uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_quote  record;
    v_job    record;
BEGIN
    -- ── Validate quote (lock row to prevent duplicate assignments) ────────────
    SELECT * INTO v_quote
    FROM public.contractor_quotes
    WHERE id = p_quote_id AND company_id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quote not found';
    END IF;
    IF v_quote.status != 'approved' THEN
        RAISE EXCEPTION 'Only approved quotes can be assigned to a job (current status: %)',
            v_quote.status;
    END IF;
    IF v_quote.converted_to_job_id IS NOT NULL THEN
        RAISE EXCEPTION 'Quote has already been linked to job %',
            v_quote.converted_to_job_id;
    END IF;

    -- ── Validate job (must belong to same company) ────────────────────────────
    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = p_job_id AND company_id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job not found or belongs to a different company';
    END IF;

    -- ── Link quote → job ──────────────────────────────────────────────────────
    UPDATE public.contractor_quotes SET
        status              = 'converted',
        converted_to_job_id = p_job_id,
        converted_at        = now(),
        updated_at          = now()
    WHERE id = p_quote_id AND company_id = p_company_id;

    -- ── Update job ─────────────────────────────────────────────────────────────
    -- • Set contractor_id only when currently NULL (don't overwrite existing contractor)
    -- • Accumulate contractor_cost (a job may have multiple contractor quotes)
    -- • Leave estimated_cost unchanged (set by the job creator, not the quote)
    UPDATE public.jobs SET
        contractor_id   = CASE
                              WHEN contractor_id IS NULL THEN v_quote.contractor_id
                              ELSE contractor_id
                          END,
        contractor_cost = contractor_cost + v_quote.total_amount,
        updated_at      = now()
    WHERE id = p_job_id AND company_id = p_company_id;

    -- ── Audit log ─────────────────────────────────────────────────────────────
    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
    VALUES (
        p_company_id,
        p_hr_user_id,
        'contractor_quotes',
        'contractor_quote_assigned_to_existing_job',
        'info',
        jsonb_build_object(
            'quote_id',      p_quote_id,
            'job_id',        p_job_id,
            'job_code',      v_job.job_code,
            'job_title',     v_job.title,
            'quote_number',  v_quote.quote_number,
            'total_amount',  v_quote.total_amount,
            'contractor_id', v_quote.contractor_id
        )
    );
END;
$$;


-- ── 2. Update hr_get_contractor_activity ─────────────────────────────────────

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
                    CASE WHEN ae.meta->>'quote_id' IS NOT NULL THEN (
                        SELECT cq.contractor_id::text FROM public.contractor_quotes cq
                        WHERE cq.id = (ae.meta->>'quote_id')::uuid LIMIT 1
                    ) ELSE NULL END,
                    ''
                ) AS contractor_id,

                coalesce((
                    SELECT c2.name FROM public.contractors c2
                    WHERE c2.id = coalesce(
                        (ae.meta->>'contractor_id')::uuid,
                        (SELECT cq2.contractor_id FROM public.contractor_quotes cq2
                         WHERE cq2.id = (ae.meta->>'quote_id')::uuid LIMIT 1)
                    ) AND c2.company_id = ae.company_id LIMIT 1
                ), '') AS contractor_name,

                coalesce((
                    SELECT c3.contractor_code FROM public.contractors c3
                    WHERE c3.id = coalesce(
                        (ae.meta->>'contractor_id')::uuid,
                        (SELECT cq3.contractor_id FROM public.contractor_quotes cq3
                         WHERE cq3.id = (ae.meta->>'quote_id')::uuid LIMIT 1)
                    ) AND c3.company_id = ae.company_id LIMIT 1
                ), '') AS contractor_code,

                CASE ae.action
                    WHEN 'hr_approve_quote'                          THEN 'quotes'
                    WHEN 'hr_reject_quote'                           THEN 'quotes'
                    WHEN 'hr_request_revision'                       THEN 'quotes'
                    WHEN 'hr_start_review'                           THEN 'quotes'
                    WHEN 'contractor_quote_submitted'                THEN 'quotes'
                    WHEN 'resubmit_quote'                            THEN 'quotes'
                    WHEN 'contractor_quote_converted_to_job'         THEN 'quotes'
                    WHEN 'contractor_quote_assigned_to_existing_job' THEN 'quotes'
                    WHEN 'contractor_banking_update_submitted'       THEN 'banking'
                    WHEN 'contractor_banking_update_approved'        THEN 'banking'
                    WHEN 'contractor_banking_update_rejected'        THEN 'banking'
                    WHEN 'contractor_profile_updated'                THEN 'profile'
                    WHEN 'contractor_tax_updated'                    THEN 'profile'
                    ELSE 'other'
                END AS event_type,

                CASE ae.action
                    WHEN 'hr_approve_quote'                          THEN 'Quote Approved'
                    WHEN 'hr_reject_quote'                           THEN 'Quote Rejected'
                    WHEN 'hr_request_revision'                       THEN 'Revision Requested'
                    WHEN 'hr_start_review'                           THEN 'Under Review'
                    WHEN 'contractor_quote_submitted'                THEN 'Quote Submitted'
                    WHEN 'resubmit_quote'                            THEN 'Quote Resubmitted'
                    WHEN 'contractor_quote_converted_to_job'         THEN 'Converted to Job'
                    WHEN 'contractor_quote_assigned_to_existing_job' THEN 'Assigned to Job'
                    WHEN 'contractor_banking_update_submitted'       THEN 'Banking Submitted'
                    WHEN 'contractor_banking_update_approved'        THEN 'Banking Approved'
                    WHEN 'contractor_banking_update_rejected'        THEN 'Banking Rejected'
                    WHEN 'contractor_profile_updated'                THEN 'Profile Updated'
                    WHEN 'contractor_tax_updated'                    THEN 'Tax/VAT Updated'
                    ELSE ae.action
                END AS event_label,

                CASE ae.action
                    WHEN 'hr_approve_quote'
                        THEN coalesce('Quote ' || (ae.meta->>'quote_number'), 'Quote') || ' approved'
                    WHEN 'hr_reject_quote'
                        THEN left(coalesce(ae.meta->>'rejection_reason', 'Rejected'), 80)
                    WHEN 'hr_request_revision'
                        THEN left(coalesce(ae.meta->>'revision_comments', 'Revisions requested'), 80)
                    WHEN 'hr_start_review'      THEN 'Quote opened for review'
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
                    WHEN 'contractor_quote_assigned_to_existing_job'
                        THEN coalesce('Quote ' || (ae.meta->>'quote_number'), 'Quote') ||
                             ' assigned to Job ' || coalesce(ae.meta->>'job_code', '') ||
                             ' — ' || coalesce(ae.meta->>'job_title', '')
                    WHEN 'contractor_banking_update_submitted' THEN 'Banking details update awaiting approval'
                    WHEN 'contractor_banking_update_approved'  THEN 'Banking details approved'
                    WHEN 'contractor_banking_update_rejected'  THEN 'Banking update rejected'
                    WHEN 'contractor_profile_updated'          THEN 'Profile information updated'
                    WHEN 'contractor_tax_updated'              THEN 'Tax / VAT details updated'
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
                'contractor_quote_assigned_to_existing_job',
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
