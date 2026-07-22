-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: contractor_activity_polish
--
-- Fix 1: hr_start_review — store contractor_id in meta (was missing, caused
--   "Unknown Contractor" in the activity feed).
-- Fix 2: hr_get_contractor_activity — use quote_id fallback to look up
--   contractor when meta->>'contractor_id' is absent (covers historical rows).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Fix hr_start_review ────────────────────────────────────────────────
-- Now stores contractor_id in meta so the activity feed can show the name.

CREATE OR REPLACE FUNCTION public.hr_start_quote_review(
    p_company_id  uuid,
    p_hr_user_id  uuid,
    p_quote_id    uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_contractor_id uuid;
BEGIN
    -- Resolve contractor_id so the activity feed can show the name
    SELECT contractor_id INTO v_contractor_id
    FROM public.contractor_quotes
    WHERE id = p_quote_id AND company_id = p_company_id;

    UPDATE public.contractor_quotes
    SET    status = 'under_review', updated_at = now()
    WHERE  id         = p_quote_id
      AND  company_id = p_company_id
      AND  status     = 'submitted';
    -- Silently no-op if already under_review (idempotent)

    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
    VALUES (p_company_id, p_hr_user_id, 'contractor_quotes', 'hr_start_review', 'info',
            jsonb_build_object(
                'quote_id',      p_quote_id,
                'contractor_id', v_contractor_id   -- now included
            ));
END;
$$;


-- ── 2. Fix hr_get_contractor_activity ─────────────────────────────────────
-- Add quote-based fallback for contractor lookup (covers historical rows that
-- lack contractor_id in meta, e.g. old hr_start_review events).

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

                -- Resolved contractor_id: meta field first, then via quote lookup
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

                -- Contractor name (uses resolved contractor_id above via subquery)
                coalesce((
                    SELECT c2.name
                    FROM public.contractors c2
                    WHERE c2.id = coalesce(
                        (ae.meta->>'contractor_id')::uuid,
                        (
                            SELECT cq2.contractor_id
                            FROM public.contractor_quotes cq2
                            WHERE cq2.id = (ae.meta->>'quote_id')::uuid
                            LIMIT 1
                        )
                    )
                    AND c2.company_id = ae.company_id
                    LIMIT 1
                ), '') AS contractor_name,

                coalesce((
                    SELECT c3.contractor_code
                    FROM public.contractors c3
                    WHERE c3.id = coalesce(
                        (ae.meta->>'contractor_id')::uuid,
                        (
                            SELECT cq3.contractor_id
                            FROM public.contractor_quotes cq3
                            WHERE cq3.id = (ae.meta->>'quote_id')::uuid
                            LIMIT 1
                        )
                    )
                    AND c3.company_id = ae.company_id
                    LIMIT 1
                ), '') AS contractor_code,

                CASE ae.action
                    WHEN 'hr_approve_quote'                    THEN 'quotes'
                    WHEN 'hr_reject_quote'                     THEN 'quotes'
                    WHEN 'hr_request_revision'                 THEN 'quotes'
                    WHEN 'hr_start_review'                     THEN 'quotes'
                    WHEN 'contractor_quote_submitted'          THEN 'quotes'
                    WHEN 'resubmit_quote'                      THEN 'quotes'
                    WHEN 'contractor_banking_update_submitted' THEN 'banking'
                    WHEN 'contractor_banking_update_approved'  THEN 'banking'
                    WHEN 'contractor_banking_update_rejected'  THEN 'banking'
                    WHEN 'contractor_profile_updated'          THEN 'profile'
                    WHEN 'contractor_tax_updated'              THEN 'profile'
                    ELSE 'other'
                END AS event_type,

                CASE ae.action
                    WHEN 'hr_approve_quote'                    THEN 'Quote Approved'
                    WHEN 'hr_reject_quote'                     THEN 'Quote Rejected'
                    WHEN 'hr_request_revision'                 THEN 'Revision Requested'
                    WHEN 'hr_start_review'                     THEN 'Under Review'
                    WHEN 'contractor_quote_submitted'          THEN 'Quote Submitted'
                    WHEN 'resubmit_quote'                      THEN 'Quote Resubmitted'
                    WHEN 'contractor_banking_update_submitted' THEN 'Banking Submitted'
                    WHEN 'contractor_banking_update_approved'  THEN 'Banking Approved'
                    WHEN 'contractor_banking_update_rejected'  THEN 'Banking Rejected'
                    WHEN 'contractor_profile_updated'          THEN 'Profile Updated'
                    WHEN 'contractor_tax_updated'              THEN 'Tax/VAT Updated'
                    ELSE ae.action
                END AS event_label,

                CASE ae.action
                    WHEN 'hr_approve_quote'
                        THEN coalesce('Quote ' || (ae.meta->>'quote_number'), 'Quote') || ' approved'
                    WHEN 'hr_reject_quote'
                        THEN coalesce('Quote approved — ' , 'Quote — ') ||
                             left(coalesce(ae.meta->>'rejection_reason', 'rejected'), 80)
                    WHEN 'hr_request_revision'
                        THEN left(coalesce(ae.meta->>'revision_comments', 'Revisions requested'), 80)
                    WHEN 'hr_start_review'
                        THEN 'Quote opened for review'
                    WHEN 'contractor_quote_submitted'
                        THEN coalesce(
                            CASE WHEN ae.meta->>'quote_number' IS NOT NULL
                                 THEN 'Quote ' || (ae.meta->>'quote_number') || ' submitted'
                            END,
                            'Quote submitted for review')
                    WHEN 'resubmit_quote'
                        THEN coalesce('Quote ' || (ae.meta->>'quote_number'), 'Quote') || ' resubmitted after revision'
                    WHEN 'contractor_banking_update_submitted'
                        THEN 'Banking details update awaiting approval'
                    WHEN 'contractor_banking_update_approved'
                        THEN 'Banking details approved'
                    WHEN 'contractor_banking_update_rejected'
                        THEN 'Banking update rejected'
                    WHEN 'contractor_profile_updated'
                        THEN 'Profile information updated'
                    WHEN 'contractor_tax_updated'
                        THEN 'Tax / VAT details updated'
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
