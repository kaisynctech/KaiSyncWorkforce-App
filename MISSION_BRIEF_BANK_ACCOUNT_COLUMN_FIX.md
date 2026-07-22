# MISSION BRIEF — `account_number` Column Name Bug
**Project:** kaisync-web (Next.js)  
**Prepared by:** KEES Architect  
**Date:** 2026-07-16  
**Supabase Project:** vcivtjwreybaxgtdhtou  
**Priority:** 🔴 CRITICAL — banking details invisible throughout the app  
**Status:** READY FOR ENGINEERING EXECUTION

---

## ROOT CAUSE

`database.ts` declares `account_number` on the `Employee` and `Contractor` interfaces. The actual DB column on both `employees` and `contractors` (and `contractor_banking_updates`) is `bank_account`.

PostgREST returns `bank_account` in query results. TypeScript looks for `account_number`, finds `undefined`. Every place in the app that reads or displays a bank account number shows blank/empty — silently.

**Confirmed via live DB:**
- `employees` table → column is `bank_account` ✅
- `contractors` table → column is `bank_account` ✅
- `contractor_banking_updates` table → column is `bank_account` ✅
- `account_number` column **does not exist** on any of these tables

---

## AFFECTED FILES — complete list

### 1. `src/types/database.ts`
Three occurrences to rename:
- Line 38: `account_number: string | null` → `bank_account: string | null` (Employee interface)
- Line 256: same fix (Contractor interface)
- Line 283: same fix (third interface — verify which type this is)

### 2. `src/app/dashboard/employees/[id]/edit/page.tsx`
- Line 112: `setAccountNumber(emp.account_number ?? '')` → `emp.bank_account`
- Line 162: `account_number: accountNumber.trim() || null` → `bank_account: accountNumber.trim() || null`  
  *(This is a direct table insert — wrong key means bank account never saves on edit)*

### 3. `src/app/dashboard/employees/[id]/page.tsx`
- Line 58: `emp.account_number` → `emp.bank_account` (banking check for completeness warning)
- Line 336: `employee.account_number` → `employee.bank_account` (masked display `****1234`)

### 4. `src/app/dashboard/profile/page.tsx`
- Line 64: `setAccountNumber(emp.account_number ?? '')` → `emp.bank_account`
- Line 86: `employee.account_number ?? ''` → `employee.bank_account ?? ''`  
  *(The RPC param `p_bank_account` is already correct — only the read-side comparison needs fixing)*

### 5. `src/app/dashboard/payroll/page.tsx`
- Line 112: `.select('..., account_number, ...')` → `bank_account` in the PostgREST select string  
  *(Column alias in join — wrong name means it's excluded from results)*
- Line 31: `account_number: string | null` in inline type → `bank_account`
- Line 258: `emp?.account_number ?? ''` → `emp?.bank_account ?? ''`

### 6. `src/app/dashboard/contractors/page.tsx`
- Line 22: `c.account_number` → `c.bank_account` (banking completeness check)

### 7. `src/app/dashboard/contractors/[id]/page.tsx`
- Line 195: `cont.account_number` → `cont.bank_account` (loading account number into state)
- Line 285: `account_number: payAccNumber.trim() || null` → `bank_account: payAccNumber.trim() || null`  
  *(Direct table update — wrong key means bank account never saves)*
- Line 392: `pendingBanking.account_number` → `pendingBanking.bank_account`
- Line 393: `pendingBanking.account_number.slice(-4)` → `pendingBanking.bank_account.slice(-4)`

---

## EXECUTION INSTRUCTIONS

This is a pure rename. Engineer should:

1. **Fix `database.ts` first** — rename all 3 `account_number` occurrences to `bank_account`

2. **Run TypeScript** — `npx tsc --noEmit` will surface every remaining reference that now breaks. Fix each one.

3. **Alternatively: global find-replace** — search `.account_number` (with leading dot to avoid the DB type declaration) across all `.tsx` files and replace with `.bank_account`. Then fix the two insert/update payload keys (`account_number:` → `bank_account:`) manually since those don't have a leading dot.

No DB migrations required. No RPC changes required. Pure TypeScript/JS rename.

---

## VERIFICATION

After fix, test:
1. Open an employee detail → Overview tab → banking section should show masked account number
2. Edit employee → banking fields pre-populated
3. My Profile → banking fields pre-populated
4. Payroll page → employee rows show bank account in export/display
5. Contractor detail → banking tab pre-populated
