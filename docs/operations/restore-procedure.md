# KaiFlow Restore Procedure

**Document version:** 1.1
**Effective date:** 2026-07-09 (updated — PITR deferred, daily backup posture documented)
**Last verified against staging:** [date of pre-onboarding staging test — required before first paying client]
**Peer reviewer:** Tinashe Eugene Nzombe — signed off 2026-07-09

---

## 1. Overview

This document describes how to restore KaiFlow tenant data following data loss, accidental deletion, or a bad schema migration. Two recovery paths are available:

- **Path 1 — Supabase daily backup restore:** Restores the entire production database to the most recent daily snapshot. Affects all tenants. Use for infrastructure-level failures or catastrophic data loss where restoring to yesterday's state is acceptable.
- **Path 2 — Tenant export re-import:** Re-imports a specific tenant's data from a previously downloaded export file. Use for single-tenant accidental deletion without a full database rollback.

**Recovery commitments:**

| Metric | Value | Notes |
|---|---|---|
| RPO (Recovery Point Objective) | Up to 24 hours | Daily backups run once per day — up to one day of data may be lost in a full restore |
| RTO (Recovery Point Objective) | 4 hours | For a full tenant restore via Path 2 |
| Backup retention | 7 days | Daily snapshots; oldest restoreable point is 7 days ago |

**PITR status:** Not enabled. Point-in-Time Recovery requires a minimum Small compute instance and costs $100–400/month as a separate add-on. It is deferred until the platform reaches sufficient revenue to justify the cost. When PITR is enabled in future, update Path 1 and this status note.

---

## 2. Who to Contact

| Role | Contact | When |
|---|---|---|
| KaiFlow platform admin | [name / email] | First contact for any incident |
| Supabase support | support@supabase.io | If backup restore fails or Dashboard is unavailable |
| Technical lead | [name] | For decisions on restore scope |

---

## 3. Path 1 — Daily Backup Restore

Use this path when a full database rollback is required (e.g., a bad migration, infrastructure failure, or catastrophic data loss affecting all tenants).

**Important:** This path rolls the entire database back to a previous day's snapshot. All tenants will lose any data written after the snapshot was taken. Communicate downtime to all active tenants before proceeding.

### 3.1 Confirm Backup Availability

1. Open Supabase Dashboard → `vcivtjwreybaxgtdhtou` → Database → Backups.
2. Confirm the backup list shows recent daily snapshots. You should see the last 7 days listed.
3. If no backups are listed, contact Supabase support immediately — do not proceed.

### 3.2 Determine the Restore Target

1. Identify the last known good state — the most recent daily snapshot taken before the incident.
2. Confirm the target snapshot date is within the 7-day retention window.
3. Record which backup you are restoring from and why.

### 3.3 Execute the Restore

1. On the Backups page, locate the target daily snapshot.
2. Click "Restore." Supabase will restore the database to a new instance.
3. Update the application connection string if Supabase assigns a new host (check Settings → Database → Connection string after restore).
4. Run application smoke tests: login, read data, create a time punch.
5. Record the restore in the incident log.

Estimated time: 30–90 minutes depending on database size.

### 3.4 Post-Restore Checklist

- [ ] Application connects successfully to restored database
- [ ] At least one tenant can log in and read their data
- [ ] `audit_events` shows events up to the target restore point
- [ ] No ARCH-001 through ARCH-010 schema objects are missing (run migration equivalence check from CI Gate 3)
- [ ] Any migrations applied after the restore point must be re-applied via `supabase db push --db-url $PRODUCTION_DB_URL`
- [ ] All affected tenants notified of the restore, the data loss window, and next steps

### 3.5 Known Limitation

Daily backups have a maximum RPO of ~24 hours. Any data written between the last backup and the incident is not recoverable through this path. Recovery of data from the gap window requires Path 2 (if tenant export files are available) or manual reconstruction.

If this limitation becomes unacceptable as the platform grows, enable PITR from Supabase Dashboard → Settings → Add-ons. Minimum requirement: Small compute ($25/month) + PITR 7-day ($100/month).

---

## 4. Path 2 — Tenant Export Re-Import

Use this path when a single tenant's data needs to be recovered and a tenant data export file is available. Does not require a full database rollback and does not affect other tenants.

### 4.1 Obtain the Export File

1. Locate the most recent completed export in `company_export_jobs` for the affected company:
   ```sql
   SELECT id, created_at, download_url, expires_at, record_counts
   FROM company_export_jobs
   WHERE company_id = '<affected_company_id>'
     AND status = 'completed'
   ORDER BY created_at DESC
   LIMIT 1;
   ```
2. If the `download_url` has not expired, download the file directly.
3. If the URL has expired, the file may still exist in Storage at `storage_path`. Generate a new signed URL:
   - Open Supabase Dashboard → Storage → `company-exports` bucket → navigate to `{company_id}/` → right-click the file → "Get URL."
4. Decompress: `gunzip export.json.gz` → `export.json`

### 4.2 Re-Import Data

**For accidental row deletion** (most common case):
1. Open `export.json` and locate the deleted records in the relevant table's array.
2. For each deleted record, reconstruct the `INSERT` statement using the export data.
3. Apply via `execute_sql` in MCP or Supabase SQL Editor.
4. Verify the records are restored with correct `company_id` and all foreign key references intact.

**For complete table wipe** (rare):
1. Extract the full table array from `export.json`.
2. Write a bulk insert script. Insert in dependency order (parent tables before child tables).
3. Re-enable RLS after inserting if it was disabled during the import.
4. Run referential integrity checks.

### 4.3 Verify Re-Import

- [ ] Affected records appear in the application for the tenant
- [ ] Record counts in the app match what the export manifest recorded
- [ ] Write an incident record: incident ID, affected company, export file used, records restored, date

---

## 5. Procedure Maintenance

This procedure must be re-reviewed and updated when:

- A significant migration changes the schema of any table listed in the export scope
- The Supabase plan or add-on configuration changes (affects backup type and retention)
- The `generate-company-export` Edge Function changes the export format or scope
- PITR is enabled — Path 1 must be rewritten to use the PITR restore flow
- A live restore test is completed against staging (update §1 with the verified date)

The live restore test against staging is required before the first paying client is onboarded (pre-onboarding checklist item 3).
