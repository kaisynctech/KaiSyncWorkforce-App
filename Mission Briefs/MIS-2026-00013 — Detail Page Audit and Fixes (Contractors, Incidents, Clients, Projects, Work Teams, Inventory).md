# MIS-2026-00013 — Detail Page Audit and Fixes

**Mission ID:** MIS-2026-00013  
**Priority:** Medium  
**Affects:** kaisync-web — six [id] detail routes not fully audited  
**Gap reference:** MIS-Q from Discovery Report  

---

## Summary

Six detail pages were not fully audited in the Discovery phase. This Mission requires the engineer to read each page against its MAUI ViewModel counterpart, identify any gaps, and fix them. This is a discovery-and-fix Mission combined.

---

## Pages to Audit and Fix

| Route | MAUI ViewModel |
|---|---|
| `/dashboard/contractors/[id]` | `HrContractorDetailsViewModel.cs` |
| `/dashboard/incidents/[id]` | `HrIncidentDetailsViewModel.cs` |
| `/dashboard/clients/[id]` | `ClientDetailViewModel.cs` |
| `/dashboard/projects/[id]` | `HrProjectDetailViewModel.cs` |
| `/dashboard/work-teams/[id]` | `HrWorkTeamDetailsViewModel.cs` |
| `/dashboard/inventory/[id]` | `HrInventoryDetailViewModel.cs` |

---

## Process for Each Page

For each page above:

1. Read the kaisync-web `page.tsx` in full
2. Read the corresponding MAUI ViewModel in full (location: `KaiFlow.Timesheets.Maui/ViewModels/Hr/`)
3. List every feature in the ViewModel that is missing or broken in the web page
4. Fix each gap inline in the page.tsx

---

## Known Likely Gaps (based on patterns seen across other pages)

### Contractors/[id] — likely gaps:
- Contractor activity feed (calls `get_contractor_activity_feed` RPC — check if it exists)
- Banking approval/rejection workflow
- Compliance pack assignment
- Document list with upload/view

### Incidents/[id] — likely gaps:
- Status history timeline
- Comments/notes section
- Photo gallery
- Assignee change
- Close/reopen actions

### Clients/[id] — likely gaps:
- Site list linked to client
- Deal/project pipeline view
- Contact details editing
- Invoice list

### Projects/[id] — likely gaps:
- Kanban board (`ProjectKanbanColumn` in MAUI) — may be the biggest gap
- Job list linked to project
- Document list

### Work Teams/[id] — likely gaps:
- Member add/remove
- Team activation/deactivation
- Member list with remove action

### Inventory/[id] — likely gaps:
- Stock adjustment
- Usage history
- Supplier link
- Reorder point setting

---

## Architecture Notes

### Kanban Board (Projects/[id]) — if missing

If the project detail page has no Kanban board, implement a simple column-based view:

```typescript
type KanbanColumn = {
  status: string
  label: string
  jobs: Job[]
}

const COLUMNS: { status: string; label: string }[] = [
  { status: 'open', label: 'Open' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'completed', label: 'Completed' },
]

// Load jobs for this project
const { data: projectJobs } = await supabase
  .from('jobs')
  .select('id, title, status, priority, assigned_employee_id, employees(name)')
  .eq('project_id', projectId)
  .eq('company_id', companyId)
  .order('created_at')

const columns: KanbanColumn[] = COLUMNS.map(col => ({
  ...col,
  jobs: projectJobs?.filter(j => j.status === col.status) ?? [],
}))
```

Render as 3 side-by-side columns (horizontal scroll on mobile). No drag-and-drop for MVP — jobs can be moved by clicking a job and changing its status.

### Work Teams/[id] — add/remove members

```typescript
async function addMember(employeeId: string) {
  await supabase.from('work_team_members').insert({
    work_team_id: teamId,
    employee_id: employeeId,
    company_id: companyId,
  })
  await loadTeam()
}

async function removeMember(memberId: string) {
  await supabase.from('work_team_members').delete().eq('id', memberId)
  await loadTeam()
}
```

---

## Database Impact

No migrations expected — all data for these pages should already exist in the DB. If any RPCs are found to be missing during the audit (similar to the pattern in MIS-2026-00002), document them and add migrations.

---

## Files to Change

All files under their respective `[id]/page.tsx` routes — changes depend on what the audit finds.

---

## Deliverable

After completing this Mission, the engineer should produce a short **Audit Report** comment at the top of each modified file listing what was found and fixed. Format:

```typescript
// AUDIT MIS-2026-00013: Found [N] gaps vs HrXxxViewModel.
// Fixed: [list of fixes]
// Deferred: [anything too large for this Mission]
```

---

## Acceptance Criteria

- [ ] Each of the 6 detail pages has been read against its MAUI ViewModel
- [ ] All critical and high gaps found are fixed
- [ ] Medium/low gaps are documented in the audit comment
- [ ] No TypeScript errors

---

## Definition of Done

- 6 pages audited
- All critical gaps fixed
- Audit comment written in each file
