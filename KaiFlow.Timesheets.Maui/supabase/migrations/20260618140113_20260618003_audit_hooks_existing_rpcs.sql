-- ARCH-002 Migration 2: Audit Hooks on Existing RPCs
-- Added write_audit_event instrumentation to pre-existing RPCs:
-- decide_leave_request, set_employee_active, delete_employee, reject_payment_run.
-- Those RPCs' current production definitions already incorporate audit logging;
-- they are rebuilt by other migration files in this sequence.
-- This representation file is a no-op.
DO $$ BEGIN NULL; END $$;
