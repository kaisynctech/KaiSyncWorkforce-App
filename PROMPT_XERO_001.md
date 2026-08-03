# Claude Code Prompt — Xero Integration (XERO-001)

Paste the following into Claude Code:

---

Read the file `MISSION_BRIEF_XERO_001.md` in full before doing anything else.

Then implement everything in it, in this exact order:

**STEP 0 — Secrets**
Run the `supabase secrets set` command from the brief in the terminal.

**STEP 1 — DB tables**
Create the file `xero_tables.sql` with all four CREATE TABLE statements from the brief, then run:
```
supabase db execute --project-ref vcivtjwreybaxgtdhtou < xero_tables.sql
```
Confirm all four tables were created before moving on.

**STEP 2 — Edge Function files**
Create these five files with the exact code from the brief — do not paraphrase or summarise the code, write it verbatim:
- `supabase/functions/_shared/xero-utils.ts`
- `supabase/functions/xero-oauth-start/index.ts`
- `supabase/functions/xero-oauth-callback/index.ts`
- `supabase/functions/xero-sync-contacts/index.ts`
- `supabase/functions/xero-push-payroll/index.ts`

**STEP 3 — Deploy**
```
supabase functions deploy xero-oauth-start    --project-ref vcivtjwreybaxgtdhtou
supabase functions deploy xero-oauth-callback --project-ref vcivtjwreybaxgtdhtou --no-verify-jwt
supabase functions deploy xero-sync-contacts  --project-ref vcivtjwreybaxgtdhtou
supabase functions deploy xero-push-payroll   --project-ref vcivtjwreybaxgtdhtou
```

**STEP 4 — Settings UI**
Edit `kaisync-web/src/app/dashboard/settings/page.tsx` exactly as described in the WEB-1 section of the brief. Add the state variables, the `loadXero()` function, the three handler functions (`connectXero`, `syncXeroContacts`, `pushPayroll`), and the Xero UI section.

**Rules:**
- Do not use `apply_migration` for any DB work — use `supabase db execute` only
- Do not skip steps or reorder them
- After completing each step, confirm it succeeded before starting the next
- The scope string in `xero-oauth-start` must be exactly: `accounting.contacts accounting.manualjournals offline_access openid profile email`
