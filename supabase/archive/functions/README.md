# Retired server (edge) functions

Kept for reference only. These are **not deployed** and nothing in the app calls them.

| Function | Retired | Why |
|---|---|---|
| `invite_worker` | 24 Nov 2026 | Replaced by the in-app invite (`kaisync-web/src/lib/employee-invite.ts`, sign-in link sent directly). It relied on `hr_users` and `contractor_members`, which no longer exist, so it could not invite anyone. To bring it back: move the folder to `supabase/functions/` and deploy it. |
