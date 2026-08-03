Read `MISSION_BRIEF_XERO_002.md` in full before doing anything.

Then implement in this order:

1. Update `supabase/functions/xero-sync-contacts/index.ts` — add single-record push support as described. Redeploy: `supabase functions deploy xero-sync-contacts --project-ref vcivtjwreybaxgtdhtou`

2. Update `kaisync-web/src/app/dashboard/contractors/page.tsx` — add Xero state, `pushToXero` and `syncAllToXero` handlers, "Sync All to Xero" toolbar button, Xero column in table.

3. Update `kaisync-web/src/app/dashboard/suppliers/page.tsx` — same pattern as contractors. `record_type` stays `'contractor'`.

4. Update `kaisync-web/src/app/dashboard/clients/page.tsx` — same pattern, `record_type: 'client'`. Also fix the missing `resolveCurrentMember` call and add `company_id` filter to the clients query.

5. Update the contractor detail page and client detail page — add Xero status badge and Push/Update button.

Key rules:
- Xero column and buttons only render when `xeroConnected === true`
- Always call `e.stopPropagation()` on Xero button clicks inside table rows
- `record_type` for suppliers is `'contractor'` (same DB table as contractors)
- Do not use `apply_migration`
