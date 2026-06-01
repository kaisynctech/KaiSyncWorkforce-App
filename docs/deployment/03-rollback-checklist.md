# Rollback checklist

## When to rollback

- Migration causes RLS lockout or RPC failures
- Mandatory update blocks all users incorrectly
- Payroll or finance calculations show systemic errors

## Database rollback

1. Identify last good migration version in `supabase_migrations.schema_migrations`
2. Do **not** drop workforce core tables
3. For production ops only, optional reversal:
   - Disable new RLS policies
   - Drop `application_errors` insert policy if flooding
4. Forward-fix preferred over destructive rollback

## Client rollback

- [ ] Publish previous MSI/APK to store or distribute direct installer
- [ ] Lower `minimum_required_version` in `app_versions` or storage JSON
- [ ] Communicate to affected tenants

## Verification after rollback

- [ ] HR login works
- [ ] Employee code-login works
- [ ] No spike in `application_errors`
