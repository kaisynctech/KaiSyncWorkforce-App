# PROMPT: Fix My PA "Failed to load tasks." bug

## Root cause

`_assert_worker_access` references a table called `hr_users` that **does not exist** in the
database. PL/pgSQL compiles SQL statements lazily at first execution. When a JWT-authenticated
user (HR shell) calls the function, PostgreSQL tries to compile the full expression:

```sql
IF EXISTS (...employees...) OR EXISTS (SELECT 1 FROM public.hr_users ...)
```

Both sides of the `OR EXISTS` are compiled together as one SQL statement. Because `hr_users`
does not exist, compilation fails with "relation hr_users does not exist". This causes every
RPC that calls `_assert_worker_access` to fail for JWT users. On the My PA page:

- `sync_operational_pa_tasks` → fails silently (`.catch(() => {})`)
- `enqueue_pa_task_notifications` → fails silently
- `employee_get_pa_settings` → fails silently
- `employee_get_pa_tasks` → throws, caught as generic "Failed to load tasks."

The `hr_users` table was planned but never created. Its intended columns were
`company_id`, `auth_user_id`, `is_active`. The equivalent in the current DB is
`employees` with `access_level IN ('hr', 'owner', 'manager')`.

## Fix 1 — DB: replace `_assert_worker_access`

Run this SQL via `supabase db execute --project-ref vcivtjwreybaxgtdhtou < fix_assert_worker.sql`.
Create the file `fix_assert_worker.sql` with:

```sql
CREATE OR REPLACE FUNCTION public._assert_worker_access(
  p_company_id    uuid,
  p_employee_id   uuid,
  p_session_token text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id IS NULL OR p_employee_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501', DETAIL = 'company_id and employee_id are required';
  END IF;

  -- JWT path (HR shell or MAUI login)
  IF auth.uid() IS NOT NULL THEN

    -- Case 1: the caller IS the employee (own record)
    IF EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id          = p_employee_id
        AND e.company_id  = p_company_id
        AND e.user_id     = auth.uid()
    ) THEN
      RETURN;
    END IF;

    -- Case 2: the caller is an HR / manager / owner employee of this company
    --         (replaces the old hr_users table which no longer exists)
    IF EXISTS (
      SELECT 1 FROM public.employees hr
      WHERE hr.user_id     = auth.uid()
        AND hr.company_id  = p_company_id
        AND hr.access_level IN ('hr', 'owner', 'manager')
        AND hr.is_active   = true
    ) THEN
      RETURN;
    END IF;

    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501', DETAIL = 'jwt_not_linked_to_employee';
  END IF;

  -- Code-login worker path: require active session token
  IF p_session_token IS NULL OR length(trim(p_session_token)) = 0 THEN
    PERFORM public.employee_validate_session(
      p_company_id, p_employee_id, coalesce(p_session_token, '')
    );
    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501', DETAIL = 'session_token_required';
  END IF;

  IF NOT public._employee_session_is_valid(p_company_id, p_employee_id, p_session_token) THEN
    PERFORM public.employee_validate_session(p_company_id, p_employee_id, p_session_token);
    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501', DETAIL = 'invalid_or_expired_session';
  END IF;

  UPDATE public.employee_code_sessions
  SET last_seen_at = now()
  WHERE session_token = p_session_token;
END;
$function$;
```

Key change: the single `IF EXISTS(...) OR EXISTS(...hr_users...)` is split into **two
separate IF blocks**. Each block is compiled independently by PL/pgSQL, so the missing
`hr_users` reference is gone. The second block uses `employees.access_level` instead.

## Fix 2 — Web: show the real error message in `pa/page.tsx`

In `kaisync-web/src/app/dashboard/employee/pa/page.tsx`, find the catch block around
`employee_get_pa_tasks` (~line 469) and replace:

```typescript
} catch (e: unknown) {
  setError(e instanceof Error ? e.message : 'Failed to load tasks.')
}
```

with:

```typescript
} catch (e: unknown) {
  const msg =
    e instanceof Error
      ? e.message
      : typeof e === 'object' && e !== null && 'message' in e
        ? String((e as { message: unknown }).message)
        : 'Failed to load tasks.'
  setError(msg)
}
```

This ensures a `PostgrestError` (plain object with a `.message` property) shows its
actual message instead of the generic fallback.

## Order

1. Create `fix_assert_worker.sql` and run via `supabase db execute`
2. Update the catch block in `pa/page.tsx`
3. Test: open `/dashboard/pa` — tasks should load; if a new error appears it will now
   show the real message instead of the generic one

## Do NOT use `apply_migration`
