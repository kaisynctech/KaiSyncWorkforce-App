Read `MISSION_BRIEF_XERO_003.md` in full before doing anything.

Then implement in this order:

1. Replace the entire contents of `supabase/functions/xero-sync-contacts/index.ts` with the full file in the brief. This fixes two things at once: the bulk push bug (was pushing employees, now correctly pushes clients + contractors) and adds the new `direction: 'pull'` import functionality.

2. Redeploy: `supabase functions deploy xero-sync-contacts --project-ref vcivtjwreybaxgtdhtou`

3. Add the `importFromXero` handler, `xeroImporting` + `xeroMsg` state, "Import from Xero" button, and result message to these three pages:
   - `kaisync-web/src/app/dashboard/contractors/page.tsx`
   - `kaisync-web/src/app/dashboard/suppliers/page.tsx`
   - `kaisync-web/src/app/dashboard/clients/page.tsx`

Rules:
- The "Import from Xero" button must only render when `xeroConnected === true`
- After a successful import, call `load()` to refresh the table so newly created records and ticks appear immediately
- Do not use `apply_migration`
