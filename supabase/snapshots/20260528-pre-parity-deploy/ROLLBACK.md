# Pre-Parity Deploy Rollback Guide

**Snapshot date:** 2026-05-28  
**Linked project:** `vcivtjwreybaxgtdhtou` (kaisynctech's Project)  
**Pending migrations:** `20260528120000`, `20260528140000`

## Deployment order

1. `20260528120000_uuid_rpc_parity_jobs_messaging_inventory.sql`
2. `20260528140000_fix_employee_insert_punch_overload.sql`

## Pre-deploy checklist

- [ ] Run `supabase migration list` — confirm only the two migrations above are pending
- [ ] Run `supabase/smoke/pre_deploy_probe.ps1` — save output as `pre_deploy_probe.txt`
- [ ] Confirm C# app build passes (`dotnet build KaiFlow.Timesheets.Maui.csproj`)
- [ ] Confirm no active payroll cut-off or critical HR operations window

## Deploy command

```powershell
cd KaiFlow.Timesheets.Maui
supabase db push --linked
```

## Post-deploy verification

```powershell
./supabase/smoke/post_deploy_probe.ps1
./supabase/smoke/attendance_rpc_smoke.ps1
```

## Rollback strategy

These migrations are **RPC/function replacements**, not destructive DDL. Rollback = restore prior function definitions.

### Option A — Re-apply prior function bodies (recommended)

Run `rollback/20260528140000_revert_punch_overload.sql` only if punch RPC regressions occur.

For `20260528120000`, worker messaging RPCs did **not exist** on remote before deploy (404). Rollback = `DROP FUNCTION` the new UUID messaging/inventory RPCs if they cause issues; MAUI HR paths use direct Postgrest for messaging.

### Option B — Supabase point-in-time recovery

Use Supabase Dashboard → Database → Backups → restore to timestamp **before** deploy.  
**Warning:** restores entire database; use only for catastrophic failure.

### Option C — Migration repair (last resort)

```powershell
supabase migration repair --status reverted 20260528140000
supabase migration repair --status reverted 20260528120000
```

Then manually apply rollback SQL. Do not use unless Options A/B unavailable.

## Environment note

No separate staging Supabase project is linked. The linked project **is** the live production database.  
Treat this as a **controlled production deploy** with pre/post probes and rollback scripts ready.
