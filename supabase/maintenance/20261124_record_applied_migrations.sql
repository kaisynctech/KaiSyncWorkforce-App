-- 2026-11-24 - Record in the live migration history the migrations that are already applied on production
-- but were never recorded (run by hand in the SQL editor), plus the two restored 17 Nov fixes and the
-- 20261124120000 match-live file (which only describes what production already has).
--
-- This changes NOTHING in the app's tables, functions or data. It only adds rows to Supabase's own list
-- supabase_migrations.schema_migrations so the repository and production list the same migrations.
-- Every one of these was checked on 24 Nov: all functions, tables and columns they create exist on production.
--
-- Undo: see the bottom of this file.

BEGIN;

WITH r(version, name) AS (VALUES
  ('20260902140000', 'farms_wave3a_diary_health_inputs'),
  ('20261009140000', 'directory_login_id'),
  ('20261021185900', 'compliance_one_system_schema'),
  ('20261021200000', 'compliance_daily_reminders'),
  ('20261022121000', 'owner_employment_type_permanent'),
  ('20261022130000', 'employee_numbers'),
  ('20261022140000', 'directory_employee_number'),
  ('20261023110000', 'w5_manual_timesheet_overnight'),
  ('20261102090000', 'insights'),
  ('20261103090000', 'salary_schedule'),
  ('20261103120000', 'document_numbers_and_invoice_ledger'),
  ('20261103130000', 'insights_people_speed'),
  ('20261104090000', 'payfast_billing'),
  ('20261104100000', 'billing_run'),
  ('20261105090000', 'finance_on_module_defaults'),
  ('20261106150000', 'xero_sync_v2'),
  ('20261106170000', 'xero_status_marks'),
  ('20261106190000', 'currencies_2a'),
  ('20261106210000', 'currencies_2b_home_totals'),
  ('20261107090000', 'xero_release3_from_xero'),
  ('20261109090000', 'pricing_v2'),
  ('20261112100000', 'project_quotes_follow_money_quotes'),
  ('20261112103000', 'project_value_in_home_currency'),
  ('20261112120000', 'portal_quotes_list'),
  ('20261112140000', 'quote_accepted_draft_invoice'),
  ('20261112150000', 'portal_invoice_currency'),
  ('20261112170000', 'quote_line_discount'),
  ('20261112180000', 'xero_tracking_items_pdfs'),
  ('20261113090000', 'quote_buyout'),
  ('20261113160000', 'client_payment_one_step'),
  ('20261113180000', 'money_out_safe_payments_receipts'),
  ('20261113190000', 'business_types_quote_templates'),
  ('20261113200000', 'one_item_list'),
  ('20261114100000', 'quotation_engine_fields'),
  ('20261114120000', 'client_side_quotes'),
  ('20261114140000', 'job_report_signoffs'),
  ('20261115090000', 'orders_pos_receiving'),
  ('20261116090000', 'process_order_vat_fix'),
  ('20261116120000', 'vat_rate_fraction_fix'),
  ('20261116130000', 'restock'),
  ('20261116150000', 'staff_claims'),
  ('20261116170000', 'claims_own_approval'),
  ('20261117090000', 'commission'),
  ('20261117190000', 'keep_role_on_relink'),
  ('20261117200000', 'commission_reps_not_a_link_table'),
  ('20261124120000', 'match_live_schema')
)
INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
SELECT r.version, r.name,
       ARRAY['-- already applied on production; recorded 2026-11-24. Source: supabase/migrations/' || r.version || '_' || r.name || '.sql'],
       'repo-sync-2026-11-24'
FROM r
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version = r.version);

-- Should show 46.
SELECT count(*) AS recorded_by_this_script FROM supabase_migrations.schema_migrations WHERE created_by = 'repo-sync-2026-11-24';

COMMIT;

-- UNDO (only if needed):
-- DELETE FROM supabase_migrations.schema_migrations WHERE created_by = 'repo-sync-2026-11-24';
