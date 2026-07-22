# MIS-2026-00010 — Reports — Analytics RPCs and Exports

**Mission ID:** MIS-2026-00010  
**Priority:** Critical  
**Affects:** kaisync-web — `/dashboard/reports`  
**Gap reference:** GAP-54, GAP-63  

---

## Summary

The Reports page calls 10 analytics RPCs and 4 export RPCs — none of which exist in the database. Every tab returns null data. This is the most DB-intensive Mission in the entire audit. It requires 14 new Postgres functions plus a reporting data architecture decision.

---

## Business Objective

Give managers a live analytics dashboard covering executive KPIs, financials, payroll, workforce, operations, incidents, inventory, contractors, property, and telemetry — matching what the MAUI app provides.

---

## Current Behaviour

All 11 analytics tabs and the Exports tab call RPCs that return null. The page renders empty charts and empty tables on every tab.

---

## Expected Behaviour

Each tab calls its RPC and receives a JSON snapshot of aggregated data. Charts and tables populate with real data. Export buttons download real files.

---

## Architecture — Phased Approach

This Mission is the largest in scope. The engineer must implement in two phases:

**Phase 1 (this Mission):** Implement the 4 highest-value analytics tabs + CSV export.  
**Phase 2 (future Mission):** Remaining 7 tabs and PDF exports.

**Phase 1 tabs:** Executive, Payroll, Workforce, Operational

---

### Analytics RPC Pattern

All analytics RPCs follow the same contract:
- Input: `p_company_id uuid, p_from date, p_to date`
- Output: `jsonb` containing aggregated snapshot data
- Called via: `supabase.rpc(rpcName, { p_company_id, p_from, p_to })`

---

### RPC 1: `hr_get_executive_snapshot`

```sql
CREATE OR REPLACE FUNCTION public.hr_get_executive_snapshot(
  p_company_id uuid, p_from date, p_to date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_employees',  (SELECT COUNT(*) FROM employees WHERE company_id = p_company_id AND is_active = true),
    'on_site_today',    (SELECT COUNT(DISTINCT employee_id) FROM timesheet_punches
                         WHERE company_id = p_company_id AND punch_out IS NULL
                           AND punch_in::date = CURRENT_DATE),
    'open_jobs',        (SELECT COUNT(*) FROM jobs WHERE company_id = p_company_id AND status IN ('open','in_progress')),
    'pending_leave',    (SELECT COUNT(*) FROM leave_requests WHERE company_id = p_company_id AND status = 'pending'),
    'total_hours',      (SELECT COALESCE(SUM(hours_worked),0) FROM timesheet_punches
                         WHERE company_id = p_company_id
                           AND punch_in::date BETWEEN p_from AND p_to),
    'total_payroll',    (SELECT COALESCE(SUM(gross_pay),0) FROM employee_payments
                         WHERE company_id = p_company_id
                           AND period_start >= p_from AND period_end <= p_to),
    'revenue_trend',    (
      SELECT jsonb_agg(jsonb_build_object('label', month_label, 'value', total))
      FROM (
        SELECT TO_CHAR(period_start, 'Mon') AS month_label,
               SUM(gross_pay) AS total
        FROM employee_payments
        WHERE company_id = p_company_id
          AND period_start >= p_from AND period_end <= p_to
        GROUP BY TO_CHAR(period_start, 'Mon'), DATE_TRUNC('month', period_start)
        ORDER BY DATE_TRUNC('month', period_start)
      ) t
    ),
    'attendance_trend', (
      SELECT jsonb_agg(jsonb_build_object('label', day_label, 'value', cnt))
      FROM (
        SELECT TO_CHAR(punch_in::date, 'DD Mon') AS day_label,
               COUNT(DISTINCT employee_id) AS cnt
        FROM timesheet_punches
        WHERE company_id = p_company_id
          AND punch_in::date BETWEEN p_from AND p_to
        GROUP BY punch_in::date
        ORDER BY punch_in::date
        LIMIT 30
      ) t
    )
  ) INTO v;
  RETURN v;
END;
$$;
```

---

### RPC 2: `hr_get_payroll_snapshot`

```sql
CREATE OR REPLACE FUNCTION public.hr_get_payroll_snapshot(
  p_company_id uuid, p_from date, p_to date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'total_gross',     COALESCE(SUM(gross_pay), 0),
      'total_net',       COALESCE(SUM(net_pay), 0),
      'total_deductions',COALESCE(SUM(deductions), 0),
      'total_hours',     COALESCE(SUM(hours_worked), 0),
      'payslip_count',   COUNT(*),
      'approved_count',  COUNT(*) FILTER (WHERE status = 'approved'),
      'draft_count',     COUNT(*) FILTER (WHERE status = 'draft'),
      'payroll_by_employee', (
        SELECT jsonb_agg(jsonb_build_object(
          'employee_name', e.name || ' ' || e.surname,
          'gross', p.gross_pay, 'net', p.net_pay, 'hours', p.hours_worked
        ) ORDER BY p.gross_pay DESC)
        FROM employee_payments p
        JOIN employees e ON e.id = p.employee_id
        WHERE p.company_id = p_company_id
          AND p.period_start >= p_from AND p.period_end <= p_to
        LIMIT 10
      )
    )
    FROM employee_payments
    WHERE company_id = p_company_id
      AND period_start >= p_from AND period_end <= p_to
  );
END;
$$;
```

---

### RPC 3: `hr_get_workforce_snapshot`

```sql
CREATE OR REPLACE FUNCTION public.hr_get_workforce_snapshot(
  p_company_id uuid, p_from date, p_to date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'total_employees',   (SELECT COUNT(*) FROM employees WHERE company_id = p_company_id AND is_active = true),
    'by_role',           (SELECT jsonb_object_agg(role, cnt) FROM
                           (SELECT role, COUNT(*) AS cnt FROM employees
                            WHERE company_id = p_company_id AND is_active = true GROUP BY role) t),
    'leave_days_taken',  (SELECT COALESCE(SUM(total_days), 0) FROM leave_requests
                          WHERE company_id = p_company_id AND status = 'approved'
                            AND start_date >= p_from AND end_date <= p_to),
    'leave_pending',     (SELECT COUNT(*) FROM leave_requests
                          WHERE company_id = p_company_id AND status = 'pending'),
    'attendance_trend',  (
      SELECT jsonb_agg(jsonb_build_object('label', d, 'value', cnt))
      FROM (
        SELECT punch_in::date::text AS d, COUNT(DISTINCT employee_id) AS cnt
        FROM timesheet_punches
        WHERE company_id = p_company_id AND punch_in::date BETWEEN p_from AND p_to
        GROUP BY punch_in::date ORDER BY punch_in::date LIMIT 30
      ) t
    ),
    'leave_trend',       (
      SELECT jsonb_agg(jsonb_build_object('label', m, 'value', cnt))
      FROM (
        SELECT TO_CHAR(start_date, 'Mon YYYY') AS m, COUNT(*) AS cnt
        FROM leave_requests
        WHERE company_id = p_company_id AND status = 'approved'
          AND start_date >= p_from AND end_date <= p_to
        GROUP BY TO_CHAR(start_date, 'Mon YYYY'), DATE_TRUNC('month', start_date)
        ORDER BY DATE_TRUNC('month', start_date)
      ) t
    )
  );
END;
$$;
```

---

### RPC 4: `hr_get_operational_snapshot`

```sql
CREATE OR REPLACE FUNCTION public.hr_get_operational_snapshot(
  p_company_id uuid, p_from date, p_to date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'total_jobs',      (SELECT COUNT(*) FROM jobs WHERE company_id = p_company_id
                         AND created_at::date BETWEEN p_from AND p_to),
    'completed_jobs',  (SELECT COUNT(*) FROM jobs WHERE company_id = p_company_id
                         AND status = 'completed' AND created_at::date BETWEEN p_from AND p_to),
    'open_jobs',       (SELECT COUNT(*) FROM jobs WHERE company_id = p_company_id
                         AND status IN ('open','in_progress')),
    'total_incidents', (SELECT COUNT(*) FROM incident_reports WHERE company_id = p_company_id
                         AND created_at::date BETWEEN p_from AND p_to),
    'completion_trend',(
      SELECT jsonb_agg(jsonb_build_object('label', d, 'value', cnt))
      FROM (
        SELECT closed_at::date::text AS d, COUNT(*) AS cnt
        FROM jobs
        WHERE company_id = p_company_id AND status = 'completed'
          AND closed_at::date BETWEEN p_from AND p_to
        GROUP BY closed_at::date ORDER BY closed_at::date LIMIT 30
      ) t
    )
  );
END;
$$;
```

---

### Placeholder RPCs for Phase 2 tabs (return empty snapshot, don't crash)

For the remaining 6 tabs not in Phase 1, create stub RPCs that return a minimal valid object so the page doesn't error:

```sql
-- Run for each: financial, incidents, inventory, contractors, property, telemetry
CREATE OR REPLACE FUNCTION public.hr_get_financial_snapshot(p_company_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.hr_get_incidents_snapshot(p_company_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.hr_get_inventory_snapshot(p_company_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.hr_get_contractors_snapshot(p_company_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.hr_get_property_snapshot(p_company_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.hr_get_telemetry_snapshot(p_company_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
```

---

### Web changes — update RPC_MAP with new names

In `src/app/dashboard/reports/page.tsx`, the `RPC_MAP` currently maps tab keys to RPC names. Update to the new `hr_` prefixed names and add `p_company_id` parameter:

```typescript
const RPC_MAP: Partial<Record<TabKey, string>> = {
  executive:   'hr_get_executive_snapshot',
  financial:   'hr_get_financial_snapshot',
  payroll:     'hr_get_payroll_snapshot',
  workforce:   'hr_get_workforce_snapshot',
  operational: 'hr_get_operational_snapshot',
  incidents:   'hr_get_incidents_snapshot',
  inventory:   'hr_get_inventory_snapshot',
  contractors: 'hr_get_contractors_snapshot',
  property:    'hr_get_property_snapshot',
  telemetry:   'hr_get_telemetry_snapshot',
}

// In useTabData hook, update the RPC call to include company_id:
const { data: d } = await supabase.rpc(rpc, {
  p_company_id: companyId,  // add this parameter
  p_from: start,
  p_to: end,
})
```

The `companyId` needs to be resolved once at the top of the Reports page (using `resolveCurrentMember` from MIS-2026-00001) and passed to the `useTabData` hook.

---

### Export CSV (4 buttons)

Replace the stub export RPCs with client-side CSV generation using data already loaded:

```typescript
// Export Payroll CSV — from the payroll snapshot data
function exportPayrollCSV(data: RpcData) {
  const rows = (data.payroll_by_employee as Record<string, unknown>[] ?? [])
    .map((r: any) => `${r.employee_name},${r.gross},${r.net},${r.hours}`)
  const csv = ['Employee,Gross,Net,Hours', ...rows].join('\n')
  downloadCSV(csv, 'payroll_report.csv')
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
```

Wire each Export button in `ExportsTab` to generate CSV from the relevant tab's loaded data.

---

## Database Impact

**Migrations required:**
1. `hr_get_executive_snapshot(p_company_id uuid, p_from date, p_to date)` — returns jsonb
2. `hr_get_payroll_snapshot(p_company_id uuid, p_from date, p_to date)` — returns jsonb
3. `hr_get_workforce_snapshot(p_company_id uuid, p_from date, p_to date)` — returns jsonb
4. `hr_get_operational_snapshot(p_company_id uuid, p_from date, p_to date)` — returns jsonb
5–10. Stub RPCs for the 6 Phase 2 tabs — each returns `'{}'::jsonb`

**Verify column names before writing migration:**
- `incident_reports` table name (may be `incidents`) — check types/database.ts
- `jobs.closed_at` column existence
- `employee_payments` columns: `gross_pay`, `net_pay`, `deductions`

---

## Files to Change

| File | Change |
|---|---|
| `src/app/dashboard/reports/page.tsx` | Update RPC_MAP names, add company_id param, wire export buttons |
| New Supabase migration | 10 DB functions (4 real + 6 stubs) |

---

## Testing Requirements

1. Open Executive tab — KPI tiles show real numbers from DB.
2. Change date preset from "30 days" to "This Month" — numbers update.
3. Open Payroll tab — table shows top employees by gross pay.
4. Open Workforce tab — attendance trend chart shows data.
5. Open Operational tab — job completion trend shows data.
6. Open Financial/Incidents/Inventory/Contractors/Property/Telemetry — no errors, empty state shown cleanly.
7. Click "Export Payroll CSV" — CSV downloads with real data.

---

## Acceptance Criteria

- [ ] Executive, Payroll, Workforce, Operational tabs show real data
- [ ] Phase 2 tabs load without errors (clean empty state)
- [ ] Date range change updates all tab data
- [ ] Export Payroll CSV downloads a valid file
- [ ] No TypeScript errors

---

## Definition of Done

- 4 Phase 1 RPC functions returning correct data
- 6 stub RPCs in place (no errors on those tabs)
- Client-side CSV export working
- No TypeScript errors
