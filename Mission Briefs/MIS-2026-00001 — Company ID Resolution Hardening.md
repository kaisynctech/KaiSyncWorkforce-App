# MIS-2026-00001 — Company ID Resolution Hardening

**Mission ID:** MIS-2026-00001  
**Priority:** Critical  
**Affects:** kaisync-web (all pages)  
**Gap reference:** GAP-03  

---

## Summary

Every dashboard page in kaisync-web queries the `employees` table to resolve the authenticated user's `company_id`. This query is duplicated ~30 times across the codebase. If it returns null the page silently shows nothing — no error, no explanation. This Mission hardens that resolution into a single shared utility and adds a clear error state for users whose account is not properly linked.

---

## Business Objective

Ensure every HR admin and manager can always see their data when they log in. Eliminate silent blank pages caused by a missing employee record linkage.

---

## Business Value

This is the architectural foundation every other Mission Brief depends on. Without it, any HR user without an employee record is completely locked out of the web app — invisibly.

---

## Current Behaviour

Each page independently runs:

```typescript
const { data: { user } } = await supabase.auth.getUser()
const { data: me } = await supabase
  .from('employees')
  .select('id, company_id')
  .eq('user_id', user.id)
  .eq('is_active', true)
  .maybeSingle()
if (!me) { setLoading(false); return }
```

If `me` is null, the page silently stops loading and shows nothing. There is no error message, no redirect, and no explanation to the user.

---

## Expected Behaviour

1. A single shared function `resolveCurrentMember(supabase)` handles company_id resolution for the entire app.
2. If resolution fails (employee record not found or not active), the user is shown a clear in-page error: **"Your account is not linked to an active employee record. Please contact your administrator."**
3. No page ever silently returns empty — a null result always produces a visible error state.
4. Every page that currently repeats the inline query is refactored to call the shared function.

---

## Root Cause

The company_id resolution pattern was copy-pasted into every page during initial development. There is no centralised auth context and no error state for the null case.

---

## Affected Systems

- kaisync-web (all ~30 dashboard pages)
- File: `src/lib/supabase/resolve-company.ts` (new file)
- All `page.tsx` files under `src/app/dashboard/`

---

## Architecture

### New file: `src/lib/supabase/resolve-company.ts`

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export type CurrentMember = {
  employeeId: string
  companyId: string
}

export async function resolveCurrentMember(
  supabase: SupabaseClient
): Promise<CurrentMember | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('employees')
    .select('id, company_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (!data?.company_id) return null
  return { employeeId: data.id, companyId: data.company_id }
}
```

### Standard error state component (add inline or extract to component)

When `resolveCurrentMember` returns null, every page renders:

```tsx
<div className="flex items-center justify-center h-full">
  <div className="text-center space-y-2">
    <span className="material-icons text-[48px] text-text-disabled">person_off</span>
    <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
    <p className="text-[13px] text-text-secondary">
      Your account is not linked to an active employee record.<br/>
      Please contact your administrator.
    </p>
  </div>
</div>
```

### Refactor pattern for every page

Replace the duplicated inline block:

```typescript
// BEFORE (remove this)
const { data: { user } } = await supabase.auth.getUser()
if (!user) return
const { data: me } = await supabase
  .from('employees')
  .select('id, company_id')
  .eq('user_id', user.id)
  .eq('is_active', true)
  .maybeSingle()
if (!me) { setLoading(false); return }
setCompanyId(me.company_id)

// AFTER (use this)
const member = await resolveCurrentMember(supabase)
if (!member) { setError('not_linked'); setLoading(false); return }
setCompanyId(member.companyId)
```

---

## Implementation Scope

1. Create `src/lib/supabase/resolve-company.ts` with the `resolveCurrentMember` function.
2. Add a `[error, setError]` state to every page that currently does the inline query.
3. Replace all inline company_id resolution blocks with `resolveCurrentMember`.
4. Add the "Account not linked" error render to each page's JSX (when `error === 'not_linked'`).
5. Pages to update (all files under `src/app/dashboard/` that contain `.eq('user_id', user.id)`):
   - overview, attendance, employees, leave, payroll, jobs, contractors, incidents, clients, projects, settings, reports, scheduling, work-teams, inventory, assets, active-sessions, activity-log, properties, residents, notifications, suppliers, team-punch, time-templates, compliance-packs, payroll/settings, employees/[id], payroll/[id], contractors/[id], incidents/[id], clients/[id], projects/[id], work-teams/[id], inventory/[id], jobs/[id]

---

## Database Impact

None. No migrations required.

---

## Shared Components

None new. The `resolveCurrentMember` function is the shared component introduced.

---

## Regression Risks

Low. This is a mechanical refactor — same query, same logic, centralised. The only behavioural change is that null results now show an error message instead of a blank page.

---

## Testing Requirements

1. Sign in as a user whose `employees.user_id` is set — all pages load normally.
2. Temporarily set a test user's `employees.is_active = false` — all pages show the "Account not linked" error.
3. Confirm no page silently returns empty after the refactor.

---

## Acceptance Criteria

- [ ] `resolve-company.ts` exists and is the single source of truth for company_id resolution
- [ ] No page.tsx under `/dashboard/` contains the inline `from('employees').select('id, company_id').eq('user_id'...)` pattern
- [ ] A user with no employee record sees the "Account not linked" error on every page, not a blank screen
- [ ] All existing page functionality is unaffected for users with a valid employee record

---

## Definition of Done

- All inline queries replaced
- Error state visible on all pages for null resolution
- No TypeScript errors
- Manually tested with a valid and an invalid account
