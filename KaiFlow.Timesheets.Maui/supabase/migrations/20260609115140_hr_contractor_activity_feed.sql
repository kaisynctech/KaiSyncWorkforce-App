-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: hr_contractor_activity_feed
--
-- hr_get_contractor_activity(p_company_id, p_limit)
-- Returns recent contractor-related events from app_events with computed
-- display fields (event_label, summary, source, event_type) and contractor
-- name enrichment via LEFT JOIN.
-- ═══════════════════════════════════════════════════════════════════════════

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
                ae.id::text                  AS id,
                ae.screen,
                ae.action,
                ae.created_at,
                coalesce(ae.meta->>'contractor_id', '')  AS contractor_id,
                coalesce(c.name, 'Unknown Contractor')  AS contractor_name,
                coalesce(c.contractor_code, '')          AS contractor_code,

                -- Filter category
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

                -- Human-readable label
                CASE ae.action
                    WHEN 'hr_approve_quote'                    THEN 'Quote Approved'
                    WHEN 'hr_reject_quote'                     THEN 'Quote Rejected'
                    WHEN 'hr_request_revision'                 THEN 'Revision Requested'
                    WHEN 'hr_start_review'                     THEN 'Quote Under Review'
                    WHEN 'contractor_quote_submitted'          THEN 'Quote Submitted'
                    WHEN 'resubmit_quote'                      THEN 'Quote Resubmitted'
                    WHEN 'contractor_banking_update_submitted' THEN 'Banking Submitted'
                    WHEN 'contractor_banking_update_approved'  THEN 'Banking Approved'
                    WHEN 'contractor_banking_update_rejected'  THEN 'Banking Rejected'
                    WHEN 'contractor_profile_updated'          THEN 'Profile Updated'
                    WHEN 'contractor_tax_updated'              THEN 'Tax / VAT Updated'
                    ELSE ae.action
                END AS event_label,

                -- Short summary (uses meta JSONB fields where useful)
                CASE ae.action
                    WHEN 'hr_approve_quote'
                        THEN coalesce('Quote ' || (ae.meta->>'quote_number'), 'Quote') || ' approved'
                    WHEN 'hr_reject_quote'
                        THEN coalesce('Quote ' || (ae.meta->>'quote_number'), 'Quote') || ' — ' ||
                             left(coalesce(ae.meta->>'rejection_reason', 'rejected'), 80)
                    WHEN 'hr_request_revision'
                        THEN coalesce('Quote ' || (ae.meta->>'quote_number'), 'Quote') || ': ' ||
                             left(coalesce(ae.meta->>'revision_comments', 'revisions requested'), 80)
                    WHEN 'hr_start_review'
                        THEN 'Quote opened for HR review'
                    WHEN 'contractor_quote_submitted'
                        THEN 'Quote submitted for review'
                    WHEN 'resubmit_quote'
                        THEN coalesce('Quote ' || (ae.meta->>'quote_number'), 'Quote') || ' resubmitted after revision'
                    WHEN 'contractor_banking_update_submitted'
                        THEN 'Banking details update pending approval'
                    WHEN 'contractor_banking_update_approved'
                        THEN 'Banking details approved'
                    WHEN 'contractor_banking_update_rejected'
                        THEN 'Banking update rejected'
                    WHEN 'contractor_profile_updated'
                        THEN 'Profile information updated via portal'
                    WHEN 'contractor_tax_updated'
                        THEN 'Tax / VAT details updated via portal'
                    ELSE ae.action
                END AS summary,

                -- Source: Portal vs HR
                CASE ae.screen
                    WHEN 'ContractorPortal' THEN 'Portal'
                    WHEN 'contractor_portal' THEN 'Portal'
                    ELSE 'HR'
                END AS source

            FROM app_events ae
            LEFT JOIN contractors c
                   ON c.id          = (ae.meta->>'contractor_id')::uuid
                  AND c.company_id  = ae.company_id
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
