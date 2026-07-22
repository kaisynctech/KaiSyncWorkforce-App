# MISSION BRIEF — HR Wave 1 Addendum
## Bug: Clocked-Out Employees Reappear in "Not Signed In" List

**Issued by:** KEES Architect
**Date:** 2026-07-17
**File:** `kaisync-web/src/app/dashboard/overview/page.tsx`
**No migrations required.**

---

## Problem

When an employee clocks in and then clocks out, they reappear in the "NOT SIGNED IN TODAY" attendance section on the HR Overview, and the "Mark Absent" button becomes available for them again — even though they were present and worked today.

## Root Cause

The "not signed in" list is computed using `clockedInIds` — a set of employees whose **latest punch today is `'in'`**. The moment an employee clocks out, their latest punch type changes to `'out'`, they drop out of `clockedInIds`, and fall back into the "not signed in" list.

**MAUI uses a different (correct) logic:** any employee who has punched at all today (`punchedTodayIds`) is excluded from the list — regardless of whether they're currently clocked in or clocked out.

MAUI source (`RefreshTodayPunchSummaryAsync`):
```csharp
var punchedTodayIds = todayPunches.Select(p => p.EmployeeId).ToHashSet();
var notIn = _allEmployees
    .Where(e => e.IsActive
             && !punchedTodayIds.Contains(e.Id)   // ← anyone who punched today is excluded
             && !onLeaveIds.Contains(e.Id)
             && !alreadyAbsent.Contains(e.Id))
    .ToList();
```

---

## Fix — Two changes, same file

Both `load()` and `refreshPunchData()` compute `notClockedInIds` using `clockedInIds`. Both must switch to `punchedTodayIds`.

The `clockedIn` KPI tile count is correct as-is — it should show who is **currently** clocked in. Only the "not signed in" list changes.

---

### Change 1 — `refreshPunchData` function (line ~82)

**Current (broken):**
```ts
async function refreshPunchData(cid: string, empList: EmpRow[]) {
  // ...
  const clockedInIds = new Set(
    [...latestByEmp.entries()].filter(([, t]) => t === 'in').map(([id]) => id)
  )
  setKpi(prev => ({ ...prev, clockedIn: clockedInIds.size }))
  setNotClockedInIds(new Set(empList.filter(e => !clockedInIds.has(e.id)).map(e => e.id)))
  // ...
}
```

**Required fix:**
```ts
async function refreshPunchData(cid: string, empList: EmpRow[]) {
  // ...
  const clockedInIds = new Set(
    [...latestByEmp.entries()].filter(([, t]) => t === 'in').map(([id]) => id)
  )
  setKpi(prev => ({ ...prev, clockedIn: clockedInIds.size }))
  // Use punchedTodayIds (any punch today) — not clockedInIds (currently clocked in)
  const punchedTodayIds = new Set(punches.map(p => p.employee_id))
  setNotClockedInIds(new Set(empList.filter(e => !punchedTodayIds.has(e.id)).map(e => e.id)))
  // ...
}
```

---

### Change 2 — `load()` function (line ~190)

**Current (broken):**
```ts
setNotClockedInIds(new Set(employees.filter(e => !clockedInIds.has(e.id)).map(e => e.id)))
```

**Required fix:**
```ts
const punchedTodayIds = new Set(punches.map(p => p.employee_id))
setNotClockedInIds(new Set(employees.filter(e => !punchedTodayIds.has(e.id)).map(e => e.id)))
```

Note: the `punches` variable is already in scope in `load()` as `(todayPunches ?? []) as TimePunch[]`.

---

## Engineer Checklist

- [ ] `refreshPunchData`: add `const punchedTodayIds = new Set(punches.map(p => p.employee_id))` and change `setNotClockedInIds` to use `punchedTodayIds`
- [ ] `load()`: add `const punchedTodayIds = new Set(punches.map(p => p.employee_id))` and change `setNotClockedInIds` to use `punchedTodayIds`
- [ ] Leave `clockedIn` KPI count unchanged (it correctly shows who is currently clocked in)
