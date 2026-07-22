# MIS-2026-00011 — Payroll Exports (Register CSV, Bank CSV, IRP5)

**Mission ID:** MIS-2026-00011  
**Priority:** High  
**Affects:** kaisync-web — `/dashboard/payroll`  
**Gap reference:** GAP-15, GAP-16, GAP-17, GAP-18  

---

## Summary

The Payroll list page has four non-functional export/action buttons: Payroll Register CSV, Bank Payment CSV, IRP5, Approve All, and Release All. This Mission implements all of them client-side — no new DB RPCs needed since the data is already in `employee_payments`.

---

## Business Objective

Payroll is a financial operation. HR must be able to export a payroll register for record-keeping, generate a bank payment file for bulk transfers, and produce IRP5 tax certificates. Approve All and Release All must perform their actions in bulk.

---

## Current Behaviour

All five buttons are non-functional placeholders.

---

## Expected Behaviour

- **Payroll Register CSV** — downloads a CSV of all displayed payslips with columns: Employee, Code, Period, Gross, Deductions, Net, Hours, Status
- **Bank Payment CSV** — downloads a Standard Bank formatted CSV for bulk payment upload: Account Holder, Bank, Account Number, Branch Code, Amount, Reference
- **IRP5** — downloads a CSV formatted as a simplified IRP5 (Annual earnings, PAYE, UIF per employee) — note: real IRP5 PDF generation is a future mission; this delivers the data extract
- **Approve All** — calls `approve_payment_run` RPC for all visible draft payslips
- **Release All** — sets all approved payslips to `visible = true` (releases to employees)

---

## Architecture

All exports are client-side CSV generation from the `payments` state already loaded in the page.

### Payroll Register CSV

```typescript
function exportPayrollRegister(payments: EmployeePayment[]) {
  const header = 'Employee,Code,Period Start,Period End,Gross (R),Deductions (R),Net (R),Hours,Status'
  const rows = payments.map(p => [
    `${p.employee?.name ?? ''} ${p.employee?.surname ?? ''}`.trim(),
    p.employee?.employee_code ?? '',
    p.period_start,
    p.period_end,
    (p.gross_pay ?? 0).toFixed(2),
    (p.deductions ?? 0).toFixed(2),
    (p.net_pay ?? 0).toFixed(2),
    (p.hours_worked ?? 0).toFixed(2),
    p.status,
  ].join(','))
  downloadCSV([header, ...rows].join('\n'), `payroll_register_${p.period_start}_to_${periodEnd}.csv`)
}
```

### Bank Payment CSV (Standard Bank format)

```typescript
function exportBankCSV(payments: EmployeePayment[]) {
  // Standard Bank bulk payment format
  const header = 'Account Holder,Bank Name,Account Number,Branch Code,Account Type,Amount,Reference'
  const rows = payments
    .filter(p => p.status === 'approved' && (p.net_pay ?? 0) > 0)
    .map(p => {
      const emp = p.employee
      return [
        `${emp?.name ?? ''} ${emp?.surname ?? ''}`.trim(),
        emp?.bank_name ?? '',
        emp?.bank_account ?? '',
        emp?.bank_branch_code ?? '',
        'Savings',  // default — actual type not stored
        (p.net_pay ?? 0).toFixed(2),
        `SALARY ${p.period_start}`,  // payment reference
      ].join(',')
    })
  downloadCSV([header, ...rows].join('\n'), `bank_payments_${periodStart}.csv`)
}
```

**Note:** The `employee` join in the payroll query needs to include `bank_name`, `bank_account`, `bank_branch_code`. Update the select:
```typescript
.select('*, employee:employees(name, surname, employee_code, bank_name, bank_account, bank_branch_code)')
```

### IRP5 CSV Export

```typescript
function exportIRP5(payments: EmployeePayment[]) {
  // Simplified IRP5 data extract (not the official SARS format — that requires a future Mission)
  const header = 'Employee,ID Number,Tax Number,Gross Income,PAYE Deducted,UIF Deducted,Net Income,Tax Year'
  const taxYear = new Date(periodEnd).getFullYear()
  const rows = payments
    .filter(p => p.status === 'approved')
    .map(p => {
      const emp = p.employee
      return [
        `${emp?.name ?? ''} ${emp?.surname ?? ''}`.trim(),
        emp?.id_number ?? '',
        emp?.tax_number ?? '',
        (p.gross_pay ?? 0).toFixed(2),
        (p.paye_amount ?? 0).toFixed(2),
        (p.uif_amount ?? 0).toFixed(2),
        (p.net_pay ?? 0).toFixed(2),
        taxYear,
      ].join(',')
    })
  downloadCSV([header, ...rows].join('\n'), `IRP5_${taxYear}.csv`)
}
```

Update the employee join to include `id_number, tax_number`.

### Approve All

```typescript
async function approveAll() {
  if (!window.confirm(`Approve all ${draftPayments.length} draft payslips?`)) return
  setApproving(true)
  const supabase = createClient()
  const draftIds = payments.filter(p => p.status === 'draft').map(p => p.id)

  for (const id of draftIds) {
    // Use existing approve pattern from single-payslip approve
    await supabase.from('employee_payments')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', companyId)
  }
  await loadPayroll()
  setApproving(false)
}
```

### Release All

```typescript
async function releaseAll() {
  if (!window.confirm(`Release all approved payslips to employees?`)) return
  setReleasing(true)
  const supabase = createClient()
  await supabase.from('employee_payments')
    .update({ is_visible: true, released_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .eq('status', 'approved')
    .eq('is_visible', false)
    // Optionally scope to the current period:
    .gte('period_start', periodStart)
    .lte('period_end', periodEnd)
  await loadPayroll()
  setReleasing(false)
}
```

**Verify:** Column names `is_visible`, `approved_at`, `released_at` — check `types/database.ts` and adjust.

---

## Shared utility

```typescript
function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
```

---

## Database Impact

None. No new migrations needed. All data from `employee_payments` joined with `employees`.

The employee select query needs expanding to include: `bank_name`, `bank_account`, `bank_branch_code`, `id_number`, `tax_number`. Verify these columns exist in `types/database.ts`.

---

## Files to Change

| File | Change |
|---|---|
| `src/app/dashboard/payroll/page.tsx` | Wire all 5 buttons, expand employee select, add download utility |

---

## Regression Risks

- Approve All loops and updates individually — acceptable for MVP. If there are thousands of payslips consider batching with `.in()`.
- Bank CSV will have empty bank fields for employees without banking details — the export should still succeed but those rows will be incomplete. The HR manager is responsible for completing bank details before running the export.

---

## Testing Requirements

1. Load a period with payslips → click Payroll Register CSV → verify CSV downloads with correct data.
2. Approve some payslips → click Bank Payment CSV → verify only approved payslips included, bank details populated.
3. Click IRP5 → verify CSV downloads with employee, gross, PAYE, UIF columns.
4. Click Approve All → all draft payslips change to approved status.
5. Click Release All → all approved payslips become visible to employees.

---

## Acceptance Criteria

- [ ] Payroll Register CSV downloads and opens correctly in Excel
- [ ] Bank Payment CSV includes only approved payslips with banking details
- [ ] IRP5 CSV includes gross, PAYE, UIF per employee
- [ ] Approve All changes all draft payslips in the current period to approved
- [ ] Release All marks all approved payslips as visible
- [ ] No TypeScript errors

---

## Definition of Done

- All 5 buttons functional with real data
- CSV files open correctly in Excel
- No TypeScript errors
