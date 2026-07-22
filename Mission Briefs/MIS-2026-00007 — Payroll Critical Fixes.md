# MIS-2026-00007 — Payroll Critical Fixes

**Mission ID:** MIS-2026-00007  
**Priority:** Critical  
**Affects:** kaisync-web — `/dashboard/payroll` and `/dashboard/payroll/[id]`  
**Gap reference:** GAP-01, GAP-02, GAP-14, GAP-55  

---

## Summary

The payroll list page has three critical broken behaviours: period locking is a UI toggle that doesn't write to the DB; the date range filter doesn't change the DB query (all records load regardless); and the Generate Payroll button does nothing. The payroll detail page calls a `recalculate_payslip` RPC that doesn't exist. This Mission fixes all four.

---

## Business Objective

Payroll is a financial operation. Incorrect period locking, wrong date-range filtering, a non-functional Generate button, and a broken recalculate button all represent direct financial and compliance risk.

---

## Current Behaviour

1. **Period locking:** Clicking the lock toggle changes UI state only — no write to `payroll_period_locks` table.
2. **Date range filter:** The query loads ALL employee_payments for the company regardless of the selected period — date filtering is done client-side only.
3. **Generate Payroll:** Button calls nothing — no RPC, no action.
4. **Recalculate Payslip:** Calls `supabase.rpc('recalculate_payslip', ...)` — RPC does not exist in DB.

---

## Expected Behaviour

1. **Period locking:** Locking a period writes a row to `payroll_period_locks`. Unlocking deletes it. The lock/unlock state is read from the DB, not UI state.
2. **Date range filter:** All DB queries use the selected period dates in the `.gte/.lte` filter.
3. **Generate Payroll:** Calls a new `hr_generate_payroll` DB function that creates `employee_payments` rows for the selected period for all active employees.
4. **Recalculate Payslip:** Calls a new `hr_recalculate_payslip` DB function.

---

## Architecture

### Fix 1 — Real Period Locking

#### New DB function: `hr_lock_payroll_period`

```sql
CREATE OR REPLACE FUNCTION public.hr_lock_payroll_period(
  p_company_id uuid,
  p_period_start date,
  p_period_end date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO payroll_period_locks (company_id, period_start, period_end, locked_by, locked_at)
  VALUES (p_company_id, p_period_start, p_period_end, auth.uid(), now())
  ON CONFLICT (company_id, period_start, period_end) DO NOTHING;
END;
$$;
```

#### New DB function: `hr_unlock_payroll_period`

```sql
CREATE OR REPLACE FUNCTION public.hr_unlock_payroll_period(
  p_company_id uuid,
  p_period_start date,
  p_period_end date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM payroll_period_locks
  WHERE company_id = p_company_id
    AND period_start = p_period_start
    AND period_end = p_period_end;
END;
$$;
```

**Verify:** Check `payroll_period_locks` column names before writing the migration. The table exists — check its schema with `list_tables`.

#### Web change — read lock from DB

```typescript
// Load locked periods for this company
const { data: locks } = await supabase
  .from('payroll_period_locks')
  .select('period_start, period_end')
  .eq('company_id', companyId)

const isLocked = locks?.some(
  l => l.period_start === periodStart && l.period_end === periodEnd
) ?? false
```

#### Web change — toggle lock writes to DB

```typescript
async function toggleLock() {
  if (isLocked) {
    await supabase.rpc('hr_unlock_payroll_period', {
      p_company_id: companyId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    })
  } else {
    await supabase.rpc('hr_lock_payroll_period', {
      p_company_id: companyId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    })
  }
  await loadPayroll()
}
```

---

### Fix 2 — Date Range in DB Query

```typescript
// BEFORE (remove client-side filter, add to DB query)
const { data } = await supabase
  .from('employee_payments')
  .select('*, employee:employees(name, surname, employee_code)')
  .eq('company_id', companyId)
  // Add these two lines:
  .gte('period_start', periodStart)
  .lte('period_end', periodEnd)
  .order('created_at', { ascending: false })
```

The period_start and period_end are the currently selected payroll period dates in the UI. Remove the client-side `.filter()` on dates.

---

### Fix 3 — Generate Payroll RPC

#### New DB function: `hr_generate_payroll`

```sql
CREATE OR REPLACE FUNCTION public.hr_generate_payroll(
  p_company_id uuid,
  p_period_start date,
  p_period_end date
)
RETURNS int  -- returns count of payslips generated
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp RECORD;
  v_count int := 0;
  v_settings RECORD;
BEGIN
  -- Get payroll settings
  SELECT * INTO v_settings FROM payroll_settings WHERE company_id = p_company_id LIMIT 1;

  FOR v_emp IN
    SELECT id, name, surname, hourly_rate, monthly_salary, pay_basis
    FROM employees
    WHERE company_id = p_company_id AND is_active = true
  LOOP
    -- Only create if not already generated for this period
    IF NOT EXISTS (
      SELECT 1 FROM employee_payments
      WHERE company_id = p_company_id
        AND employee_id = v_emp.id
        AND period_start = p_period_start
        AND period_end = p_period_end
    ) THEN
      INSERT INTO employee_payments (
        company_id, employee_id,
        period_start, period_end,
        status, gross_pay, net_pay,
        deductions, hours_worked
      )
      SELECT
        p_company_id,
        v_emp.id,
        p_period_start,
        p_period_end,
        'draft',
        -- Calculate gross from punches in this period
        COALESCE(
          (SELECT SUM(hours_worked) * v_emp.hourly_rate
           FROM timesheet_punches
           WHERE employee_id = v_emp.id
             AND company_id = p_company_id
             AND punch_in::date >= p_period_start
             AND punch_in::date <= p_period_end
             AND punch_out IS NOT NULL),
          v_emp.monthly_salary,
          0
        ),
        0, -- net_pay (to be calculated)
        0, -- deductions
        COALESCE(
          (SELECT SUM(hours_worked)
           FROM timesheet_punches
           WHERE employee_id = v_emp.id
             AND company_id = p_company_id
             AND punch_in::date >= p_period_start
             AND punch_in::date <= p_period_end
             AND punch_out IS NOT NULL),
          0
        );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;
```

**Important:** Before implementing, verify the exact column names in `employee_payments` and `timesheet_punches` from `types/database.ts`. The logic above is the pattern — column names may differ.

#### Web change

```typescript
async function handleGenerate() {
  if (!window.confirm(`Generate payroll for ${periodStart} to ${periodEnd}?`)) return
  setGenerating(true)
  const { data, error } = await supabase.rpc('hr_generate_payroll', {
    p_company_id: companyId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  })
  if (error) setError(error.message)
  else {
    setSuccess(`Generated ${data} payslips`)
    await loadPayroll()
  }
  setGenerating(false)
}
```

---

### Fix 4 — Recalculate Payslip RPC

#### New DB function: `hr_recalculate_payslip`

```sql
CREATE OR REPLACE FUNCTION public.hr_recalculate_payslip(
  p_company_id uuid,
  p_payment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_settings RECORD;
  v_hours numeric;
  v_gross numeric;
  v_uif numeric;
  v_paye numeric;
  v_net numeric;
BEGIN
  SELECT * INTO v_payment FROM employee_payments
  WHERE id = p_payment_id AND company_id = p_company_id;

  SELECT * INTO v_settings FROM payroll_settings WHERE company_id = p_company_id;

  -- Recalculate hours from punches
  SELECT COALESCE(SUM(hours_worked), 0) INTO v_hours
  FROM timesheet_punches
  WHERE employee_id = v_payment.employee_id
    AND company_id = p_company_id
    AND punch_in::date >= v_payment.period_start
    AND punch_in::date <= v_payment.period_end
    AND punch_out IS NOT NULL;

  -- Recalculate gross
  v_gross := v_hours * COALESCE(
    (SELECT hourly_rate FROM employees WHERE id = v_payment.employee_id),
    0
  );

  -- Calculate deductions
  v_uif := CASE WHEN COALESCE(v_settings.uif_enabled, true)
    THEN LEAST(v_gross, COALESCE(v_settings.uif_ceiling_monthly, 17712)) *
         COALESCE(v_settings.uif_rate_percent, 1) / 100
    ELSE 0 END;

  v_paye := CASE WHEN COALESCE(v_settings.paye_enabled, true)
    THEN v_gross * COALESCE(v_settings.default_paye_rate_percent, 25) / 100
    ELSE 0 END;

  v_net := v_gross - v_uif - v_paye;

  UPDATE employee_payments SET
    hours_worked = v_hours,
    gross_pay = v_gross,
    deductions = v_uif + v_paye,
    net_pay = v_net,
    updated_at = now()
  WHERE id = p_payment_id;
END;
$$;
```

#### Web change in `src/app/dashboard/payroll/[id]/page.tsx`

```typescript
// BEFORE
await supabase.rpc('recalculate_payslip', { payment_id: paymentId, company_id: companyId })

// AFTER
await supabase.rpc('hr_recalculate_payslip', {
  p_company_id: companyId,
  p_payment_id: paymentId,
})
```

---

## Database Impact

**Migrations required:**
1. `hr_lock_payroll_period(p_company_id uuid, p_period_start date, p_period_end date)` — new function
2. `hr_unlock_payroll_period(p_company_id uuid, p_period_start date, p_period_end date)` — new function
3. `hr_generate_payroll(p_company_id uuid, p_period_start date, p_period_end date)` — new function
4. `hr_recalculate_payslip(p_company_id uuid, p_payment_id uuid)` — new function

**Before writing the migration, verify these column names from `types/database.ts`:**
- `employee_payments`: `period_start`, `period_end`, `gross_pay`, `net_pay`, `deductions`, `hours_worked`, `status`
- `payroll_period_locks`: all columns (table confirmed to exist)
- `timesheet_punches`: `hours_worked`, `punch_in`, `punch_out`

---

## Files to Change

| File | Change |
|---|---|
| `src/app/dashboard/payroll/page.tsx` | Real lock from DB, date range in query, Generate button wired |
| `src/app/dashboard/payroll/[id]/page.tsx` | Fix RPC name for recalculate |
| New Supabase migration | 4 new DB functions |

---

## Regression Risks

- The period lock UI currently uses local state — switching to DB-driven state means the lock reads on every load. Ensure a loading state prevents interaction before locks are fetched.
- `hr_generate_payroll` must not create duplicate payslips — the `NOT EXISTS` guard handles this.
- Recalculate overwrites `gross_pay`, `deductions`, `net_pay` — this is intentional but irreversible. The existing `approved` status check should prevent recalculating approved payslips.

---

## Testing Requirements

1. Lock a period — verify row in `payroll_period_locks` table in DB.
2. Refresh page — lock state reflects DB, not UI memory.
3. Unlock — row deleted from `payroll_period_locks`.
4. Select a period with date range — verify DB query uses those dates (check network tab / Supabase logs).
5. Generate payroll for a period — verify `employee_payments` rows created for active employees.
6. Generate again for same period — no duplicates created.
7. Open a payslip, click Recalculate — verify `gross_pay` and `net_pay` updated in DB.

---

## Acceptance Criteria

- [ ] Lock/unlock writes to and reads from `payroll_period_locks`
- [ ] Date range in UI changes the DB query
- [ ] Generate Payroll creates `employee_payments` rows
- [ ] Generate is idempotent (no duplicates)
- [ ] Recalculate Payslip updates the payslip figures in DB
- [ ] No TypeScript errors

---

## Definition of Done

- All 4 DB migrations applied
- All behaviours tested with real payroll data
- Lock state persists across page refreshes
- No TypeScript errors
