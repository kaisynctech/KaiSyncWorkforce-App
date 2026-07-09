# Storage Hardening Report

**Date:** 2026-06-01  
**Migration:** `20260601140000_storage_hardening.sql`

## Buckets audited

| Bucket | Before | After |
|--------|--------|-------|
| `workforce-media` | Public + anon INSERT | **Private** + grant-based anon INSERT |
| `releases` | Public (installers) | Unchanged |

## Sensitive paths in `workforce-media`

| Path prefix | Use | Hardening |
|-------------|-----|-----------|
| `leave_attachments/` | Leave requests | Upload grant + signed URL |
| `incident_reports/` | Incident photos | Upload grant + signed URL |
| `job_photos/` | Job site photos | Upload grant + signed URL |
| `employee_documents/` | Worker/HR documents | Upload grant + signed URL |
| `job_documents/` | Job attachments | Upload grant + signed URL |
| `project_documents/` | HR project files | Authenticated INSERT only |
| `job_cards/` | Job card signatures | Upload grant / HR JWT |

## Mechanism

1. **`media_upload_grants`** — short-lived (15 min) path grants after `_assert_worker_access`.
2. **`employee_prepare_media_upload`** — worker RPC creates grant before client upload.
3. **`employee_consume_media_upload`** — marks grant consumed after successful upload.
4. Storage RLS — anon INSERT/SELECT only when matching active grant exists.
5. HR users upload via **authenticated** INSERT policy (JWT).

## Client changes

| File | Change |
|------|--------|
| `SupabaseStorageService.Media.cs` | Prepare/consume grants, `ResolveWorkforceMediaUrlAsync` |
| `SupabaseStorageService.cs` | Leave, document, job photo uploads use grants + signed URLs |

## Rollback

1. `UPDATE storage.buckets SET public = true WHERE id = 'workforce-media';`
2. Restore `p_workforce_media_anon_insert` from `20260525281100_project_job_document_storage_rls.sql`
3. `DROP TABLE media_upload_grants CASCADE;`
4. Drop `employee_prepare_media_upload`, `employee_consume_media_upload`
5. Revert client to public URL builder (`BuildWorkforceMediaUrl`)

## Compatibility notes

- Existing public URLs in DB remain valid until bucket is made private; after rollout, clients must use signed URLs.
- Deploy **DB migration and MAUI client together** to avoid upload failures.
