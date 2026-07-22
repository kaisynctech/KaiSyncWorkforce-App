# MIS-2026-00009 — Settings — Branch Management and HR User Management

**Mission ID:** MIS-2026-00009  
**Priority:** High  
**Affects:** kaisync-web — `/dashboard/settings`  
**Gap reference:** GAP-21, GAP-22  

---

## Summary

The Settings page is missing two sections that are present in the MAUI app: Branch Management (create/rename/delete branches) and HR User Management (invite/remove other HR admins). Both the `branches` and `company_branches` tables exist in the DB. This Mission adds both sections.

---

## Business Objective

Allow business owners to manage their company structure (branches) and control who has HR admin access to their workforce data — without needing the mobile app.

---

## Current Behaviour

Settings page has: Company details, Security toggles, Code rotation, Integrations, Audit log. No branch management. No HR user management.

---

## Expected Behaviour

Two new sections added to the Settings page:

**Branch Management section:**
- List of branches for this company
- Create branch: text input + Save button
- Rename branch: inline edit
- Delete branch: with confirm dialog

**HR Users section:**
- List of employees with HR admin role
- Promote an existing employee to HR admin (`set_employee_role` RPC, role = 'admin')
- Demote an HR admin back to employee (`set_employee_role` RPC, role = 'employee')
- Note: this reuses the employee role system — HR admins are employees with elevated role

---

## Architecture

### Branch Management

#### Load branches

```typescript
const { data: branchData } = await supabase
  .from('branches')
  .select('id, name, is_active')
  .eq('company_id', companyId)
  .order('name')
setBranches((branchData ?? []) as Branch[])
```

#### Create branch

```typescript
async function createBranch(name: string) {
  if (!name.trim()) return
  const { error } = await supabase.from('branches').insert({
    company_id: companyId,
    name: name.trim(),
    is_active: true,
  })
  if (!error) {
    setNewBranchName('')
    await loadBranches()
  }
}
```

#### Rename branch (inline edit)

```typescript
async function renameBranch(branchId: string, newName: string) {
  await supabase.from('branches').update({ name: newName.trim() }).eq('id', branchId)
  await loadBranches()
}
```

#### Delete branch

```typescript
async function deleteBranch(branchId: string) {
  if (!window.confirm('Delete this branch? Employees in this branch will be unassigned.')) return
  await supabase.from('branches').delete().eq('id', branchId)
  await loadBranches()
}
```

#### UI

```tsx
<section className="space-y-3">
  <h2 className="text-[13px] font-semibold text-text-primary uppercase tracking-wider">
    Branch Management
  </h2>

  {/* Create new branch */}
  <div className="flex gap-2">
    <input value={newBranchName} onChange={e => setNewBranchName(e.target.value)}
      placeholder="New branch name" className="flex-1 ..." />
    <button onClick={() => createBranch(newBranchName)} disabled={!newBranchName.trim()}>
      Add Branch
    </button>
  </div>

  {/* Branch list */}
  {branches.map(branch => (
    <div key={branch.id} className="flex items-center gap-2 py-2 border-b border-divider">
      {editingBranchId === branch.id ? (
        <>
          <input value={editBranchName} onChange={e => setEditBranchName(e.target.value)}
            className="flex-1 ..." autoFocus />
          <button onClick={() => renameBranch(branch.id, editBranchName)}>Save</button>
          <button onClick={() => setEditingBranchId(null)}>Cancel</button>
        </>
      ) : (
        <>
          <span className="flex-1 text-[13px] text-text-primary">{branch.name}</span>
          <button onClick={() => { setEditingBranchId(branch.id); setEditBranchName(branch.name) }}>
            Rename
          </button>
          <button onClick={() => deleteBranch(branch.id)} className="text-error">Delete</button>
        </>
      )}
    </div>
  ))}
</section>
```

---

### HR User Management

HR admins are employees with `role = 'admin'` (or equivalent — check `types/database.ts` for the Employee `role` values).

#### Load HR admins

```typescript
const { data: hrAdmins } = await supabase
  .from('employees')
  .select('id, name, surname, email, role')
  .eq('company_id', companyId)
  .eq('is_active', true)
  .in('role', ['admin', 'hr_admin', 'owner'])  // verify role values in types/database.ts
  .order('name')
setHrAdmins((hrAdmins ?? []) as Pick<Employee, 'id' | 'name' | 'surname' | 'email' | 'role'>[])
```

#### Load all employees (for promotion picker)

```typescript
const { data: allEmps } = await supabase
  .from('employees')
  .select('id, name, surname, email, role')
  .eq('company_id', companyId)
  .eq('is_active', true)
  .order('name')
setAllEmployees((allEmps ?? []) as Pick<Employee, 'id' | 'name' | 'surname' | 'email' | 'role'>[])
```

#### Promote to HR admin

```typescript
async function promoteToAdmin(employeeId: string) {
  await supabase.rpc('set_employee_role', {
    p_company_id: companyId,
    p_employee_id: employeeId,
    p_new_role: 'admin',  // verify the exact role value used in your system
  })
  await loadHrAdmins()
}
```

#### Demote from HR admin

```typescript
async function demoteFromAdmin(employeeId: string) {
  if (!window.confirm('Remove HR admin access for this employee?')) return
  await supabase.rpc('set_employee_role', {
    p_company_id: companyId,
    p_employee_id: employeeId,
    p_new_role: 'employee',
  })
  await loadHrAdmins()
}
```

#### UI

```tsx
<section className="space-y-3">
  <h2 className="text-[13px] font-semibold text-text-primary uppercase tracking-wider">
    HR Admins
  </h2>
  <p className="text-[12px] text-text-secondary">
    Employees with admin access can manage attendance, payroll, and leave.
  </p>

  {/* Current HR admins */}
  {hrAdmins.map(emp => (
    <div key={emp.id} className="flex items-center justify-between py-2 border-b border-divider">
      <div>
        <p className="text-[13px] font-medium text-text-primary">{emp.name} {emp.surname}</p>
        <p className="text-[11px] text-text-secondary">{emp.email ?? '—'} · {emp.role}</p>
      </div>
      {emp.role !== 'owner' && (
        <button onClick={() => demoteFromAdmin(emp.id)}
          className="text-[12px] text-error hover:underline">
          Remove admin
        </button>
      )}
    </div>
  ))}

  {/* Add new HR admin */}
  <div className="flex gap-2 items-center">
    <select value={promoteEmployeeId} onChange={e => setPromoteEmployeeId(e.target.value)}
      className="flex-1 ...">
      <option value="">Select employee to promote…</option>
      {allEmployees
        .filter(e => !hrAdmins.find(a => a.id === e.id))
        .map(e => (
          <option key={e.id} value={e.id}>{e.name} {e.surname}</option>
        ))}
    </select>
    <button onClick={() => promoteToAdmin(promoteEmployeeId)}
      disabled={!promoteEmployeeId}>
      Grant Admin
    </button>
  </div>
</section>
```

---

## Database Impact

None. Both `branches` and `set_employee_role` RPC are confirmed to exist.

**Verify before implementing:**
- The exact `role` values used in the `employees` table (check `types/database.ts` — could be `'admin'`, `'hr_admin'`, `'manager'`, etc.)
- `set_employee_role` RPC signature — confirmed in DB as `set_employee_role(p_company_id uuid, p_employee_id uuid, p_new_role text)`
- Whether `branches.company_id` is `uuid` or `bigint` (check `types/database.ts`)

---

## Files to Change

| File | Change |
|---|---|
| `src/app/dashboard/settings/page.tsx` | Add Branch Management section and HR Users section |

---

## Regression Risks

- Deleting a branch that has employees assigned will leave those employees' `branch_id` orphaned. The confirm dialog warning is sufficient for MVP — a more robust solution (reassign employees) can be a future enhancement.
- Demoting the current logged-in user's own admin role will remove their access — add a guard to prevent self-demotion.

---

## Testing Requirements

1. Create a branch — appears in list, also visible in the Employees page branch filter (MIS-2026-00004).
2. Rename a branch — name updates everywhere.
3. Delete a branch — removed from list.
4. Promote an employee — they appear in HR Admins list.
5. Demote an HR admin — removed from list, their role in DB updated.
6. Owner row shows no "Remove admin" button.

---

## Acceptance Criteria

- [ ] Create/rename/delete branches works and persists to DB
- [ ] HR Admins section shows all employees with admin role
- [ ] Promote employee to admin works
- [ ] Demote admin to employee works
- [ ] Cannot demote the owner
- [ ] Cannot self-demote (guard required)
- [ ] No TypeScript errors

---

## Definition of Done

- Both sections tested with real data
- Branch changes visible in Employees page filter
- Role changes reflected immediately
- No TypeScript errors
