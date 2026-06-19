-- Drop the 8-parameter overload of hr_convert_quote_to_job.
-- This version predates the job_contractors / project_contractors join tables
-- and does NOT write either of them on conversion. It must be removed so that
-- PostgreSQL always resolves calls to the 9-parameter version (which includes
-- p_deal_id DEFAULT NULL and writes both join tables atomically).
--
-- The 9-parameter version is preserved untouched.

DROP FUNCTION IF EXISTS public.hr_convert_quote_to_job(
    uuid,                        -- p_company_id
    uuid,                        -- p_hr_user_id
    uuid,                        -- p_quote_id
    text,                        -- p_job_title
    text,                        -- p_description
    text,                        -- p_priority
    timestamp with time zone,    -- p_scheduled_start
    timestamp with time zone     -- p_scheduled_end
);
