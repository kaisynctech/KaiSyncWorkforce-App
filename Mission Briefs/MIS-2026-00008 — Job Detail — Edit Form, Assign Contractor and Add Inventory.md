# MIS-2026-00008 — Job Detail — Edit Form, Assign Contractor, Add Inventory

**Mission ID:** MIS-2026-00008  
**Priority:** High  
**Affects:** kaisync-web — `/dashboard/jobs/[id]`  
**Gap reference:** GAP-19, GAP-60, GAP-61  

---

## Summary

The Job Detail page has three non-functional elements: the Edit button is `disabled` (no edit form exists), the "+ Assign Contractor" button has no action, and the "+ Add" inventory button has no action. All three RPCs needed exist in the DB. This Mission wires them all up.

---

## Business Objective

HR managers must be able to edit job details, assign contractors, and allocate inventory from the web without switching to the mobile app.

---

## Current Behaviour

- Edit button: `disabled` — clicking does nothing
- "+ Assign Contractor": button renders but `onClick` is not wired to any flow
- "+ Add" (inventory): button renders but `onClick` is not wired to any flow

---

## Expected Behaviour

- Edit button opens an inline edit form for job title, description, priority, scheduled start/end, and client
- Assign Contractor opens a search-and-select modal to pick a contractor and enter agreed amount + role
- Add Inventory opens a search-and-select modal to pick an inventory item and enter quantity

---

## Architecture

### Fix 1 — Edit Job Form

Add an `isEditing` state toggle. When true, the job header card switches from display mode to edit mode inline.

```typescript
const [isEditing, setIsEditing] = useState(false)
const [editTitle, setEditTitle] = useState('')
const [editDescription, setEditDescription] = useState('')
const [editPriority, setEditPriority] = useState<Job['priority']>('medium')
const [editStart, setEditStart] = useState('')
const [editEnd, setEditEnd] = useState('')
const [editClientId, setEditClientId] = useState<string | null>(null)

// Populate on entering edit mode
function startEdit() {
  if (!job) return
  setEditTitle(job.title)
  setEditDescription(job.description ?? '')
  setEditPriority(job.priority)
  setEditStart(job.scheduled_start ? job.scheduled_start.slice(0, 16) : '')
  setEditEnd(job.scheduled_end ? job.scheduled_end.slice(0, 16) : '')
  setEditClientId(job.client_id ?? null)
  setIsEditing(true)
}

async function saveEdit() {
  if (!job) return
  setSaving(true)
  const supabase = createClient()
  const { error: e } = await supabase.from('jobs').update({
    title: editTitle.trim(),
    description: editDescription.trim() || null,
    priority: editPriority,
    scheduled_start: editStart ? new Date(editStart).toISOString() : null,
    scheduled_end: editEnd ? new Date(editEnd).toISOString() : null,
    client_id: editClientId,
  }).eq('id', jobId)

  if (e) setError(e.message)
  else {
    setJob(prev => prev ? {
      ...prev,
      title: editTitle.trim(),
      description: editDescription.trim() || null,
      priority: editPriority,
      scheduled_start: editStart ? new Date(editStart).toISOString() : null,
      scheduled_end: editEnd ? new Date(editEnd).toISOString() : null,
      client_id: editClientId,
    } : prev)
    setIsEditing(false)
  }
  setSaving(false)
}
```

In the action bar, change the Edit button:
```tsx
// BEFORE
<button disabled className="...">Edit</button>

// AFTER
<button onClick={isEditing ? saveEdit : startEdit} disabled={saving}>
  {isEditing ? 'Save' : 'Edit'}
</button>
{isEditing && (
  <button onClick={() => setIsEditing(false)}>Cancel</button>
)}
```

In the job header card, when `isEditing`:
```tsx
{isEditing ? (
  <div className="space-y-3">
    <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
      className="..." placeholder="Job title" />
    <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)}
      className="..." placeholder="Description" rows={3} />
    <FormSelect value={editPriority} onChange={e => setEditPriority(e.target.value as Job['priority'])}>
      <option value="high">High</option>
      <option value="medium">Medium</option>
      <option value="low">Low</option>
    </FormSelect>
    <input type="datetime-local" value={editStart} onChange={e => setEditStart(e.target.value)} />
    <input type="datetime-local" value={editEnd} onChange={e => setEditEnd(e.target.value)} />
    {/* Client selector — use existing clients list loaded in load() */}
    <FormSelect value={editClientId ?? ''} onChange={e => setEditClientId(e.target.value || null)}>
      <option value="">No client</option>
      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </FormSelect>
  </div>
) : (
  /* existing display grid */
)}
```

Load the clients list in `load()`:
```typescript
const { data: clientsData } = await supabase
  .from('clients')
  .select('id, name')
  .eq('company_id', me.company_id)
  .order('name')
setClients((clientsData ?? []) as Pick<Client, 'id' | 'name'>[])
```

---

### Fix 2 — Assign Contractor

Use `hr_upsert_job_contractor(p_company_id, p_job_id, p_contractor_id, p_agreed_amount)` — confirmed in DB.

Add state:
```typescript
const [showContractorModal, setShowContractorModal] = useState(false)
const [contractorSearch, setContractorSearch] = useState('')
const [allContractors, setAllContractors] = useState<Contractor[]>([])
const [selectedContractorId, setSelectedContractorId] = useState('')
const [agreedAmount, setAgreedAmount] = useState('')
const [contractorRole, setContractorRole] = useState('')
```

Load contractors list in `load()`:
```typescript
const { data: contractorData } = await supabase
  .from('contractors')
  .select('id, name, contractor_code')
  .eq('company_id', me.company_id)
  .eq('is_active', true)
  .order('name')
setAllContractors((contractorData ?? []) as Contractor[])
```

Modal UI (full-screen overlay):
```tsx
{showContractorModal && (
  <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
    <div className="bg-surface rounded-xl w-full max-w-md p-5 space-y-4">
      <h2 className="text-[16px] font-semibold text-text-primary">Assign Contractor</h2>

      <input placeholder="Search contractors…" value={contractorSearch}
        onChange={e => setContractorSearch(e.target.value)} className="..." />

      <div className="max-h-[200px] overflow-y-auto space-y-1">
        {allContractors
          .filter(c => c.name.toLowerCase().includes(contractorSearch.toLowerCase()))
          .map(c => (
            <label key={c.id} className="flex items-center gap-2 px-2 py-2 cursor-pointer hover:bg-background rounded-lg">
              <input type="radio" name="contractor"
                checked={selectedContractorId === c.id}
                onChange={() => setSelectedContractorId(c.id)} />
              <span className="text-[13px] text-text-primary">{c.name}</span>
              <span className="text-[11px] text-text-secondary ml-auto">{c.contractor_code}</span>
            </label>
          ))}
      </div>

      <input type="number" placeholder="Agreed amount (R)" value={agreedAmount}
        onChange={e => setAgreedAmount(e.target.value)} className="..." />

      <input placeholder="Role (optional)" value={contractorRole}
        onChange={e => setContractorRole(e.target.value)} className="..." />

      <div className="flex gap-2 justify-end">
        <button onClick={() => setShowContractorModal(false)} className="btn-outlined h-10 px-4">Cancel</button>
        <button onClick={assignContractor} disabled={!selectedContractorId || saving}
          className="btn-primary h-10 px-4">Assign</button>
      </div>
    </div>
  </div>
)}
```

Assign function:
```typescript
async function assignContractor() {
  if (!selectedContractorId || !companyId) return
  setSaving(true)
  const supabase = createClient()
  const { error: e } = await supabase.rpc('hr_upsert_job_contractor', {
    p_company_id: companyId,
    p_job_id: jobId,
    p_contractor_id: selectedContractorId,
    p_agreed_amount: parseFloat(agreedAmount) || 0,
  })
  if (e) setError(e.message)
  else {
    setShowContractorModal(false)
    setSelectedContractorId('')
    setAgreedAmount('')
    await load()
  }
  setSaving(false)
}
```

Wire the "+ Assign Contractor" button to `setShowContractorModal(true)`.

---

### Fix 3 — Add Inventory

Use `hr_allocate_inventory_to_job(p_company_id, p_job_id, p_employee_id, p_inventory_item_id, p_quantity, p_unit_cost)` — confirmed in DB.

Add state:
```typescript
const [showInventoryModal, setShowInventoryModal] = useState(false)
const [inventorySearch, setInventorySearch] = useState('')
const [allInventory, setAllInventory] = useState<InventoryItem[]>([])
const [selectedItemId, setSelectedItemId] = useState('')
const [quantity, setQuantity] = useState('1')
```

Load inventory list in `load()`:
```typescript
const { data: invData } = await supabase
  .from('inventory_items')
  .select('id, name, unit_cost, stock_quantity')
  .eq('company_id', me.company_id)
  .order('name')
setAllInventory((invData ?? []) as InventoryItem[])
```

Modal follows same pattern as contractor modal above.

Allocate function:
```typescript
async function allocateInventory() {
  if (!selectedItemId || !companyId) return
  setSaving(true)
  const supabase = createClient()
  const item = allInventory.find(i => i.id === selectedItemId)
  const { error: e } = await supabase.rpc('hr_allocate_inventory_to_job', {
    p_company_id: companyId,
    p_job_id: jobId,
    p_employee_id: myEmployeeId,
    p_inventory_item_id: selectedItemId,
    p_quantity: parseFloat(quantity) || 1,
    p_unit_cost: item?.unit_cost ?? null,
  })
  if (e) setError(e.message)
  else {
    setShowInventoryModal(false)
    await load()
  }
  setSaving(false)
}
```

Wire the "+ Add" button in the Inventory section to `setShowInventoryModal(true)`.

**Note:** The `inventory_items` table name needs to be confirmed — it may be `inventory` or `inventory_items`. Check `types/database.ts` for the correct table name.

---

## Database Impact

None. All three RPCs confirmed to exist:
- `hr_upsert_job_contractor` ✓
- `hr_allocate_inventory_to_job` ✓
- Direct `jobs` table update for edit ✓

---

## Files to Change

| File | Change |
|---|---|
| `src/app/dashboard/jobs/[id]/page.tsx` | Add edit form, contractor modal, inventory modal |

---

## Regression Risks

- The edit form overwrites existing job fields on save — ensure all fields are pre-populated from `job` state before the user sees the form.
- `hr_upsert_job_contractor` may replace an existing assignment for the same contractor. Verify the RPC behaviour.
- Inventory allocation may reduce stock. Verify `hr_allocate_inventory_to_job` handles stock deduction.

---

## Testing Requirements

1. Click Edit — form appears with existing values pre-filled.
2. Change title, save — title updated in DB and displayed.
3. Cancel edit — original values restored, no DB change.
4. Assign Contractor — contractor appears in the contractors section.
5. Add Inventory item (qty 2) — item appears in inventory section with correct total cost.

---

## Acceptance Criteria

- [ ] Edit form pre-fills all job fields
- [ ] Save updates the `jobs` row in DB
- [ ] Cancel reverts to display mode with no change
- [ ] Assign Contractor modal works end-to-end
- [ ] Add Inventory modal works end-to-end
- [ ] No TypeScript errors

---

## Definition of Done

- All three flows tested manually
- DB rows confirmed updated
- No TypeScript errors
