-- Migration: 20260609095220_fix_hr_review_rpc_notifications
-- Fix notifications in HR review RPC functions (hr_approve_contractor_quote, hr_reject_contractor_quote).
-- Representation file: idempotent — the fixed versions of these functions are captured
-- in 20260608153726_hr_quote_review_workflow.sql (CREATE OR REPLACE).
-- This migration patched notification logic within those same functions.
DO $$ BEGIN NULL; END $$;