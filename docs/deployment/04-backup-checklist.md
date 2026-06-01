# Backup checklist

## Before major release

- [ ] Run manual backup via `IBackupService.CreateManualBackupAsync` (owner account)
- [ ] Confirm row in `company_backups` with `record_counts`
- [ ] Export payroll period reports (PDF) for active month
- [ ] Supabase project backup / PITR confirmed with hosting provider

## Scheduled backups (foundation)

- [ ] `backup_jobs` row created with `schedule_cron` (cron not executed server-side yet — metadata only)
- [ ] Document actual Supabase backup schedule in runbook

## Restore policy

- **Not implemented:** destructive restore from `company_backups`
- Restore today = Supabase PITR + manual data re-entry
- `is_restorable = false` on metadata-only backups until export pipeline ships

## Post-incident

- [ ] Record incident in `saas_support_notes` (platform admin)
- [ ] Attach backup job id to support ticket metadata
