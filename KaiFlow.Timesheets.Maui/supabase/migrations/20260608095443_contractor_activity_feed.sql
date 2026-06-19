-- Migration: 20260608095443_contractor_activity_feed
-- Contractor activity feed GET function (initial version)
-- Representation file: idempotent (CREATE OR REPLACE FUNCTION throughout)

CREATE OR REPLACE FUNCTION public.hr_get_contractor_activity(p_company_id uuid, p_limit integer DEFAULT 50)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$


REVOKE ALL ON FUNCTION public.hr_get_contractor_activity(p_company_id uuid, p_limit integer DEFAULT 50) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_get_contractor_activity(p_company_id uuid, p_limit integer DEFAULT 50) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_get_contractor_activity(p_company_id uuid, p_limit integer DEFAULT 50) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_contractor_activity(p_company_id uuid, p_limit integer DEFAULT 50) TO service_role;

