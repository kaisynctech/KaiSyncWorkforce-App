# MIS-2026-00005 — Employee Detail — Documents Tab and Leave Balances

**Mission ID:** MIS-2026-00005  
**Priority:** High  
**Affects:** kaisync-web — `/dashboard/employees/[id]`  
**Gap reference:** GAP-12, GAP-28  

---

## Summary

The Employee Detail page has a Documents tab that shows a placeholder text ("coming in Phase 3") and a Leave tab that shows raw leave requests without balances. The `employee_documents` table exists and is ready. This Mission implements document upload/view/delete and adds leave balance display.

---

## Business Objective

Allow HR managers to store, view and manage employee documents (ID, contracts, certificates) and see accurate leave balances per employee directly from the web app.

---

## Current Behaviour

- Documents tab: renders "File uploads coming in Phase 3" — no functionality
- Leave tab: shows `leave_requests` rows only, no annual days / balance / taken calculation

---

## Expected Behaviour

**Documents tab:**
- List of uploaded documents: name, type, upload date, Open / Delete actions
- Upload button → file picker → uploads to `workforce-media` storage → inserts into `employee_documents`
- Document type selector (ID, Contract, Certificate, Other)
- Delete with confirm dialog

**Leave tab (enhanced):**
- Summary row per leave type: Annual Days | Used (YTD) | Remaining
- Existing leave request list below (unchanged)

---

## Architecture

### Documents Tab

#### Load documents

```typescript
const { data: docs } = await supabase
  .from('employee_documents')
  .select('*')
  .eq('employee_id', employeeId)
  .eq('company_id', companyId)
  .order('created_at', { ascending: false })
```

#### Upload

```typescript
async function uploadDocument(file: File, docType: string) {
  const path = `employee-docs/${companyId}/${employeeId}/${Date.now()}_${file.name}`

  const { error: upErr } = await supabase.storage
    .from('workforce-media')
    .upload(path, file)

  if (upErr) { setError(upErr.message); return }

  await supabase.from('employee_documents').insert({
    employee_id: employeeId,
    company_id: companyId,
    document_name: file.name,
    document_type: docType,
    storage_path: path,
    file_url: path, // signed URL generated on open
  })

  await loadDocuments()
}
```

#### Open (generate signed URL)

```typescript
async function openDocument(doc: EmployeeDocument) {
  const { data } = await supabase.storage
    .from('workforce-media')
    .createSignedUrl(doc.storage_path, 300) // 5-minute URL
  if (data?.signedUrl) window.open(data.signedUrl, '_blank')
}
```

#### Delete

```typescript
async function deleteDocument(doc: EmployeeDocument) {
  await supabase.storage.from('workforce-media').remove([doc.storage_path])
  await supabase.from('employee_documents').delete().eq('id', doc.id)
  setDocs(prev => prev.filter(d => d.id !== doc.id))
}
```

#### Document type options

```typescript
const DOC_TYPES = [
  'ID Document', 'Passport', 'Employment Contract', 'NDA',
  'Certificate', 'Qualification', 'Bank Letter', 'Tax Certificate', 'Other',
]
```

#### UI structure

```tsx
{/* Document type selector + Upload button */}
<div className="flex gap-2 items-center">
  <select value={docType} onChange={e => setDocType(e.target.value)} className="...">
    {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
  </select>
  <button onClick={() => fileRef.current?.click()}>Upload Document</button>
  <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange} />
</div>

{/* Document list */}
{docs.map(doc => (
  <div key={doc.id} className="flex items-center justify-between py-2 border-b">
    <div>
      <p className="font-medium text-[13px]">{doc.document_name}</p>
      <p className="text-[11px] text-text-secondary">{doc.document_type} · {formatDate(doc.created_at)}</p>
    </div>
    <div className="flex gap-2">
      <button onClick={() => openDocument(doc)}>Open</button>
      <button onClick={() => setConfirmDelete(doc.id)}>Delete</button>
    </div>
  </div>
))}
```

---

### Leave Tab — Balance Display

Add a balance summary section above the existing leave request list:

```typescript
// Load leave requests for this employee (already loaded in the Leave tab)
// Calculate balances

const ANNUAL_DAYS_DEFAULTS: Record<string, number> = {
  annual: 15,
  sick: 30,
  family: 3,
  study: 5,
}

// Get payroll settings for configured annual days
// settings.annual_leave_days ?? 15, settings.sick_leave_days ?? 30, etc.

const yearStart = `${new Date().getFullYear()}-01-01`

const byType = leaveRequests
  .filter(r => r.status === 'approved' && r.start_date >= yearStart)
  .reduce((acc, r) => {
    acc[r.leave_type] = (acc[r.leave_type] ?? 0) + (r.total_days ?? 0)
    return acc
  }, {} as Record<string, number>)

const leaveTypes = [...new Set(leaveRequests.map(r => r.leave_type))]
```

Render as a summary table:

```
Leave Type     Annual    Used    Remaining
Annual Leave    15        5        10
Sick Leave      30        2        28
```

---

## Database Impact

None. `employee_documents` table confirmed to exist. All document storage uses the existing `workforce-media` bucket.

---

## Files to Change

| File | Change |
|---|---|
| `src/app/dashboard/employees/[id]/page.tsx` | Replace DocumentsTab placeholder + add leave balance summary |

---

## Important: Verify Before Implementing

Check `types/database.ts` for the `EmployeeDocument` type to confirm exact column names:
- `document_name` vs `file_name`
- `document_type` vs `doc_type`
- `storage_path` vs `file_path`
- `file_url` vs `url`

Adjust all insert/select queries to match the actual schema.

---

## Regression Risks

- The existing Leave tab request list must remain intact — only add the balance summary above it.
- The existing Overview and Payments tabs are unaffected.

---

## Testing Requirements

1. Upload a PDF document — appears in the list.
2. Click Open — signed URL opens in new tab within 5 minutes.
3. Delete a document — removed from list and storage.
4. Leave tab: balance row shows correct used/remaining for an employee with known leave history.

---

## Acceptance Criteria

- [ ] Documents tab lists all `employee_documents` for the employee
- [ ] Upload stores file in `workforce-media` and inserts record in `employee_documents`
- [ ] Open generates a signed URL and opens the file
- [ ] Delete removes from storage and DB
- [ ] Leave tab shows annual / used / remaining per leave type
- [ ] No TypeScript errors

---

## Definition of Done

- Documents fully functional (upload, view, delete)
- Leave balances accurate for at least one test employee
- No TypeScript errors
