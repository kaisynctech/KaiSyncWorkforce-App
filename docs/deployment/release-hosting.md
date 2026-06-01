# Release hosting — Supabase Storage

Host KaiFlow release binaries in Supabase Storage. The **website Download Center** and **in-app update flow** link to public URLs — binaries are never stored in the website repository.

---

## Recommended bucket structure

```
releases/                          (public bucket)
├── windows/
│   └── KaiFlowSetup.exe           (or KaiFlowSetup-v1.0.0.exe)
└── android/
    ├── KaiFlow-v1.0.0.apk
    └── KaiFlow-v1.0.1.apk
```

Optional future:

```
releases/ios/                      (TestFlight — link only, not binary)
```

---

## 1. Create the bucket

### Supabase Dashboard

1. Open project → **Storage** → **New bucket**
2. Name: `releases`
3. **Public bucket:** ON (anonymous read for download links)
4. Create

### SQL (alternative)

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('releases', 'releases', true)
ON CONFLICT (id) DO UPDATE SET public = true;
```

---

## 2. Storage policies

Allow public read; restrict write to authenticated service role / platform admin:

```sql
CREATE POLICY "Public read releases"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'releases');

CREATE POLICY "Authenticated upload releases"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'releases');
```

For production, prefer uploads via **service role key** from a secure CI machine — not tenant HR users.

---

## 3. Upload process

### Dashboard

1. Storage → `releases` → Upload folder
2. Path: `windows/KaiFlowSetup.exe`
3. Path: `android/KaiFlow-v1.0.0.apk`

### CLI (supabase)

```powershell
supabase storage cp dist/KaiFlowSetup.exe ss:///releases/windows/KaiFlowSetup.exe --linked
supabase storage cp KaiFlow-v1.0.0.apk ss:///releases/android/KaiFlow-v1.0.0.apk --linked
```

### curl (service role)

```powershell
curl -X POST "https://vcivtjwreybaxgtdhtou.supabase.co/storage/v1/object/releases/windows/KaiFlowSetup.exe" `
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" `
  -H "Content-Type: application/octet-stream" `
  --data-binary "@dist/KaiFlowSetup.exe"
```

---

## 4. Public URL retrieval

Format:

```
https://<project-ref>.supabase.co/storage/v1/object/public/releases/<path>
```

Examples:

```
https://vcivtjwreybaxgtdhtou.supabase.co/storage/v1/object/public/releases/windows/KaiFlowSetup.exe

https://vcivtjwreybaxgtdhtou.supabase.co/storage/v1/object/public/releases/android/KaiFlow-v1.0.0.apk
```

---

## 5. Wire URLs to app_versions

```sql
UPDATE public.app_versions
SET
  download_url_windows = 'https://vcivtjwreybaxgtdhtou.supabase.co/storage/v1/object/public/releases/windows/KaiFlowSetup.exe',
  download_url_android = 'https://vcivtjwreybaxgtdhtou.supabase.co/storage/v1/object/public/releases/android/KaiFlow-v1.0.0.apk',
  release_notes = 'Pilot release — attendance, payroll, finance, full HR suite.',
  release_date = now(),
  is_active = true
WHERE version = '1.0.0' AND build_number = 1;
```

RPC aliases (website + docs):

| Column | RPC alias |
|--------|-----------|
| `download_url_windows` | `windows_download_url` |
| `download_url_android` | `android_download_url` |

---

## 6. Release replacement process

1. Build new artifact with **higher** version/build.
2. Upload to versioned path (recommended) or overwrite stable name:

| Strategy | Pros |
|----------|------|
| `KaiFlowSetup-v1.0.1.exe` | Cache-safe, audit trail |
| `KaiFlowSetup.exe` (overwrite) | Stable URL, simpler docs |

3. Update `app_versions` row (new row or update URLs + notes).
4. Purge CDN cache if using custom domain (Supabase public URLs update immediately on overwrite).
5. Verify Download Center + in-app update link.

---

## 7. Security notes

- **Do not** commit service role keys or keystores.
- Public bucket = anyone with URL can download (intended for installers).
- Use versioned filenames for rollback (`KaiFlowSetup-v1.0.0.exe` kept while v1.0.1 is current).
- Consider code signing (Windows) to reduce SmartScreen friction.

---

## Related docs

- [release-process.md](./release-process.md)
- [windows-installer.md](./windows-installer.md)
- [android-release.md](./android-release.md)
