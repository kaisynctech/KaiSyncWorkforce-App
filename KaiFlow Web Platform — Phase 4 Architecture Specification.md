# KaiFlow Web Platform — Phase 4 Architecture Specification

**Date:** 2026-07-09  
**Baseline:** Phase 3 complete (23/23 pages, 0 errors)  
**Stack:** Next.js 16 · React 19 · Tailwind v4 · Supabase SSR  
**Design mandate:** Pixel-perfect parity with MAUI. No layout deviations.

---

## §0 Phase 4 Scope

| Route | MAUI Source | Note |
|---|---|---|
| `/dashboard/contractors/[id]` | `HrContractorDetailsPage.xaml` | Extend Phase 3 — complete remaining 6 tabs |
| `/dashboard/projects` | `HrProjectsPage.xaml` + `HrProjectsTableView.xaml` | New |
| `/dashboard/projects/[id]` | `HrProjectDetailPage.xaml` | New |
| `/dashboard/clients` | `HrClientsPage.xaml` | New |
| `/dashboard/clients/[id]` | `ClientDetailPage.xaml` | New |
| `/dashboard/incidents` | `HrIncidentsPage.xaml` | New |
| `/dashboard/incidents/[id]` | `HrIncidentDetailsPage.xaml` | New |

---

## §1 `/dashboard/contractors/[id]` — Contractor Detail, Remaining Tabs

Phase 3 built Information and Compliance tabs. Phase 4 completes the remaining 8, of which 5 are fully built here and 3 remain `<ComingSoon />`.

### 1.1 Tab status after Phase 4

| # | Tab | Phase 4 status |
|---|---|---|
| 1 | Information | ✅ Phase 3 |
| 2 | Compliance | ✅ Phase 3 (+ complete document table below) |
| 3 | Payments | ✅ Phase 4 |
| 4 | Team | ✅ Phase 4 |
| 5 | Jobs | ✅ Phase 4 |
| 6 | Projects | ✅ Phase 4 |
| 7 | Incidents | ✅ Phase 4 |
| 8 | Activity | `<ComingSoon />` |
| 9 | Quotes | `<ComingSoon />` |
| 10 | Invoices | `<ComingSoon />` |

### 1.2 Compliance tab — complete document table section (extends Phase 3)

Append after the Compliance Overview card. This section is only visible when `showDocumentsSection`.

#### 1.2.1 Header + filter chips

```tsx
<div className="flex items-center justify-between">
  <p className="section-label">COMPLIANCE DOCUMENTS</p>
  <button onClick={uploadDocument} className="btn-primary h-[34px] px-[14px] text-[12px]">
    + Upload
  </button>
</div>

{/* Filter chips row */}
<div className="flex gap-1.5 flex-wrap mt-2">
  <DocFilterChip count={totalDocuments}   label="Total"    filter="all"      active={docFilter === 'all'}      borderColor={filterBorderAll} bg="#1E293B" valueFg="#CBD5E1" labelFg="#64748B" />
  <DocFilterChip count={approvedDocCount} label="Approved" filter="approved" active={docFilter === 'approved'} borderColor={filterBorderApproved} bg="#14532D" valueFg="#22C55E" labelFg="#22C55E" />
  <DocFilterChip count={pendingDocCount}  label="Pending"  filter="pending"  active={docFilter === 'pending'}  borderColor={filterBorderPending} bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
  <DocFilterChip count={rejectedDocCount} label="Rejected" filter="rejected" active={docFilter === 'rejected'} borderColor={filterBorderRejected} bg="#7F1D1D" valueFg="#FCA5A5" labelFg="#FCA5A5" />
  <DocFilterChip count={expiredDocCount}  label="Expired"  filter="expired"  active={docFilter === 'expired'}  borderColor={filterBorderExpired} bg="#450A0A" valueFg="#FCA5A5" labelFg="#FCA5A5" />
</div>
```

`DocFilterChip` — `rounded-lg px-[10px] py-[5px] text-[11px] font-medium cursor-pointer border` using the filter's bg/colours. Active state: `border-primary`; inactive: `border-transparent`.

#### 1.2.2 Search + sort row

```tsx
<div className="grid grid-cols-[1fr_180px] gap-2 mt-1">
  <div className="flex items-center gap-1 bg-surface-card border border-divider rounded-lg px-2">
    <span className="material-icons text-secondary text-[16px]">search</span>
    <input
      placeholder="Search documents…"
      value={documentSearch}
      onChange={e => setDocumentSearch(e.target.value)}
      className="flex-1 bg-transparent text-primary text-[13px] h-[38px] outline-none placeholder:text-secondary"
    />
  </div>
  <FormSelect options={docSortOptions} value={selectedDocSort} onChange={setSelectedDocSort} placeholder="Sort by" />
</div>
```

#### 1.2.3 Document table

Horizontally scrollable. Total width: 925px.

```
Columns (px): Type(160) / Document Name(175) / Status(120) / Expires(115) / Req.(65) / Uploaded(90) / Actions(185)
```

```tsx
<div className="overflow-x-auto mt-2">
  <table style={{ minWidth: 925 }} className="w-full">
    <thead>
      <tr className="bg-surface-elevated">
        <th style={{width:160}} className="data-th">Type</th>
        <th style={{width:175}} className="data-th">Document Name</th>
        <th style={{width:120}} className="data-th">Status</th>
        <th style={{width:115}} className="data-th">Expires</th>
        <th style={{width: 65}} className="data-th text-center">Req.</th>
        <th style={{width: 90}} className="data-th text-center">Uploaded</th>
        <th style={{width:185}} className="data-th text-right">Actions</th>
      </tr>
    </thead>
    <tbody>
      {filteredDocuments.map(doc => (
        <tr key={doc.id} className="bg-surface-card border-b border-divider">
          <td className="data-td text-[12px] truncate">{doc.typeLabel}</td>
          <td className="data-td">
            <p className="text-[12px] text-primary truncate">{doc.documentName}</p>
            {doc.isRejected && (
              <p className="text-[10px] text-[#FCA5A5] truncate">↳ {doc.rejectedReason}</p>
            )}
          </td>
          <td className="data-td">
            <StatusBadge label={doc.statusTableLabel} bg={doc.approvalBadgeBg} fg={doc.approvalBadgeFg} />
          </td>
          <td className="data-td text-[11px]">
            {doc.showExpiryWarning && (
              <span className="material-icons text-[13px] mr-1" style={{color: doc.expiryWarningFg}}>warning</span>
            )}
            <span style={{color: doc.expiryDateColor}}>{doc.expiryDisplay}</span>
          </td>
          <td className="data-td text-center">
            {doc.isRequired
              ? <span className="inline-block rounded-[6px] px-[6px] py-[3px] bg-[#450A0A] text-[#FCA5A5] text-[10px] font-medium">Req.</span>
              : <span className="inline-block rounded-[6px] px-[6px] py-[3px] bg-[#1E293B] text-[#64748B] text-[10px] font-medium">Opt.</span>
            }
          </td>
          <td className="data-td text-[11px] text-center text-secondary">{doc.uploadedDateDisplay}</td>
          <td className="data-td text-right">
            <button onClick={() => viewDocument(doc)} className="text-primary text-[11px] font-medium px-[5px] h-[30px]">View</button>
            {!doc.isApproved  && <button onClick={() => approveDocument(doc)} className="text-[#22C55E] text-[11px] font-medium px-[5px] h-[30px]">Approve</button>}
            {!doc.isRejected  && <button onClick={() => rejectDocument(doc)} className="text-[#FCD34D] text-[11px] font-medium px-[5px] h-[30px]">Reject</button>}
            <button onClick={() => deleteDocument(doc)} className="text-error text-[11px] font-medium px-[5px] h-[30px]">Delete</button>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
  {filteredDocuments.length === 0 && (
    <p className="text-secondary text-center py-6 text-[13px]">{docEmptyMessage}</p>
  )}
</div>
```

**Approval status badge colours:**

| status | bg | fg |
|---|---|---|
| approved | `#DCFCE7` | `#166534` |
| pending | `#1E293B` | `#94A3B8` |
| rejected | `#FEE2E2` | `#991B1B` |
| expired | `#450A0A` | `#FCA5A5` |

### 1.3 Tab 3: Payments

```tsx
<div className="p-4 space-y-4 overflow-y-auto">

  {/* Pending Banking Update alert — amber, shown when hasPendingBankingUpdate */}
  {hasPendingBankingUpdate && (
    <div className="rounded-[10px] border border-[#78350F] bg-[#1A1200] p-[14px] space-y-[10px]">
      <div className="flex items-center gap-2">
        <span className="material-icons text-[#FCD34D] text-[18px]">info</span>
        <div>
          <p className="text-[#FCD34D] font-semibold text-[13px]">Pending Banking Update — Requires Review</p>
          <p className="text-[#FDE68A] text-[11px]">Submitted by contractor: {pendingBankingUpdate.submittedAtDisplay}</p>
        </div>
      </div>
      {/* Key-value grid: 100px labels / * values */}
      <div className="grid grid-cols-[100px_1fr] gap-y-1.5 mt-1">
        <span className="text-[#FDE68A] text-[11px]">Account Holder</span>
        <span className="text-white font-medium text-[12px]">{pendingBankingUpdate.accountHolderName ?? '—'}</span>
        <span className="text-[#FDE68A] text-[11px]">Bank</span>
        <span className="text-white font-medium text-[12px]">{pendingBankingUpdate.bankName ?? '—'}</span>
        <span className="text-[#FDE68A] text-[11px]">Account No.</span>
        <span className="text-white font-medium text-[12px]">{pendingBankingUpdate.maskedAccount}</span>
        <span className="text-[#FDE68A] text-[11px]">Account Type</span>
        <span className="text-[#FDE8A0] text-[12px]">{pendingBankingUpdate.accountTypeLabel}</span>
      </div>
      <div className="border-t border-[#78350F] my-1.5" />
      <div className="flex items-center gap-[10px]">
        <p className="flex-1 text-[#FDE68A] text-[11px]">
          Approving copies these details to the contractor record. Banking verification will be reset.
        </p>
        <button onClick={rejectBanking} disabled={isBusy}
                className="bg-[#450A0A] text-[#FCA5A5] rounded-lg px-4 h-9 text-[12px] font-medium">
          Reject
        </button>
        <button onClick={approveBanking} disabled={isBusy}
                className="bg-[#14532D] text-[#22C55E] rounded-lg px-4 h-9 text-[12px] font-semibold">
          Approve Banking
        </button>
      </div>
    </div>
  )}

  {/* Banking Details card */}
  <div className="card p-4 space-y-3">
    <p className="section-label">BANKING DETAILS</p>
    <input placeholder="Account holder name (legal name) *" className="dark-entry w-full" />
    <input placeholder="Bank name" className="dark-entry w-full" />
    <input placeholder="Account number" className="dark-entry w-full" />
    <input placeholder="Branch code (6-digit)" className="dark-entry w-full" inputMode="numeric" />
    <FormSelect options={accountTypeItems} value={selectedAccountType} onChange={setSelectedAccountType} placeholder="Account type" />
    <input placeholder="SWIFT / BIC (international transfers)" className="dark-entry w-full" />
  </div>

  {/* Payment Settings card */}
  <div className="card p-4 space-y-3">
    <p className="section-label">PAYMENT SETTINGS</p>
    <FormSelect options={paymentTermsItems} value={selectedPaymentTerms} onChange={setSelectedPaymentTerms} placeholder="Payment terms" />
    <FormSelect options={paymentMethodItems} value={selectedPaymentMethod} onChange={setSelectedPaymentMethod} placeholder="Preferred payment method" />

    {/* Banking Verified toggle */}
    <div className="flex items-center justify-between">
      <div>
        <p className="text-primary text-[14px]">Banking Verified</p>
        <p className="text-secondary text-[11px]">Bank details confirmed against proof of banking.</p>
      </div>
      <Toggle isOn={bankingVerified} onChange={setBankingVerified} activeColor="#16A34A" />
    </div>
    <div className="h-px bg-divider" />

    {/* Payment Hold toggle */}
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[14px]" style={{color: paymentHold ? '#F59E0B' : 'var(--color-text-primary)'}}>Payment Hold</p>
        <p className="text-secondary text-[11px]">Blocks all payouts to this contractor.</p>
      </div>
      <Toggle isOn={paymentHold} onChange={setPaymentHold} activeColor="#D97706" />
    </div>

    {/* Compliance Hold toggle */}
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[14px]" style={{color: complianceHold ? '#EF4444' : 'var(--color-text-primary)'}}>Compliance Hold</p>
        <p className="text-secondary text-[11px]">Compliance documents missing or expired — blocks payments.</p>
      </div>
      <Toggle isOn={complianceHold} onChange={setComplianceHold} activeColor="#DC2626" />
    </div>
  </div>

</div>
```

### 1.4 Tab 4: Team

```tsx
<div className="p-4 space-y-4 overflow-y-auto">

  {/* New-contractor guard */}
  {isNew && <InfoBanner icon="info" text="Save the contractor on the Information tab first to manage team members." />}

  {/* Supplier notice */}
  {isSupplierMode && <InfoBanner text="Team member management is not applicable for supplier partners." />}

  {/* Members section */}
  {showMembersSection && (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="section-label flex-1">TEAM MEMBERS</p>
        <button onClick={inviteMember} className="text-primary text-[13px] px-2">Invite</button>
        <button onClick={addMember} className="btn-outlined h-9 px-3 text-[12px]">+ Add</button>
      </div>
      <table className="w-full">
        <thead>
          <tr className="bg-surface-elevated">
            <th className="data-th text-left">Employee</th>
            <th style={{width:120}} className="data-th">Role</th>
            <th style={{width: 80}} className="data-th text-right">Primary</th>
          </tr>
        </thead>
        <tbody>
          {members.length === 0 && (
            <tr><td colSpan={3} className="text-secondary text-center py-4 text-[13px]">No members linked.</td></tr>
          )}
          {members.map(m => (
            <tr key={m.id} className="bg-surface-card border-b border-divider">
              <td className="data-td text-primary">{m.employeeName}</td>
              <td className="data-td text-secondary text-center">{m.link.role}</td>
              <td className="data-td text-secondary text-right">{m.link.isPrimary ? 'Yes' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )}

</div>
```

`InfoBanner` — `card flex items-center gap-3 p-4`: `<span className="material-icons text-secondary">{icon}</span>` + `<p className="text-secondary text-[13px]">{text}</p>`

### 1.5 Tab 5: Jobs

Full-height layout: header row + scrollable table.

```
Header row: "JOBS" label + spinner (when jobsLoading)

Table — horizontal scroll, cols:
  Code(80) / Title(*) / Role(90) / Status(90) / Scheduled(80) / Agreed(80) / Project(90) / 📄(50) / Open →(70)
```

```tsx
<div className="flex flex-col h-full">
  <div className="flex items-center justify-between px-4 py-[10px]">
    <p className="section-label">JOBS</p>
    {jobsLoading && <LoadingSpinner size={18} />}
  </div>
  <div className="flex-1 overflow-y-auto">
    <div className="overflow-x-auto mx-4">
      <table style={{ minWidth: 700 }} className="w-full">
        <thead>
          <tr className="bg-surface-elevated">
            <th style={{width: 80}} className="data-th">Code</th>
            <th className="data-th">Title</th>
            <th style={{width: 90}} className="data-th text-center">Role</th>
            <th style={{width: 90}} className="data-th text-center">Status</th>
            <th style={{width: 80}} className="data-th text-right">Scheduled</th>
            <th style={{width: 80}} className="data-th text-right">Agreed</th>
            <th style={{width: 90}} className="data-th">Project</th>
            <th style={{width: 50}} className="data-th text-center">📄</th>
            <th style={{width: 70}} className="data-th"></th>
          </tr>
        </thead>
        <tbody>
          {contractorJobs.length === 0 && (
            <tr><td colSpan={9} className="text-secondary text-center py-6 text-[13px]">No jobs linked to this contractor yet.</td></tr>
          )}
          {contractorJobs.map(j => (
            <tr key={j.id} className="bg-surface-card border-b border-divider">
              <td className="data-td text-secondary font-medium">{j.jobCodeDisplay}</td>
              <td className="data-td text-primary truncate">{j.jobTitle}</td>
              <td className="data-td text-secondary text-center">{j.roleDisplay}</td>
              <td className="data-td text-center">
                <StatusBadge label={j.jobStatusLabel} bg={j.jobStatusBadgeBg} fg={j.jobStatusBadgeFg} />
              </td>
              <td className="data-td text-secondary text-right">{j.jobScheduledDisplay}</td>
              <td className="data-td text-secondary text-right">{j.agreedAmountDisplay}</td>
              <td className="data-td text-secondary truncate">{j.jobProjectDisplay}</td>
              <td className="data-td text-center">
                <button onClick={() => openJobDocs(j)}
                        className="bg-[#1A2A1A] text-[#4ADE80] rounded w-[50px] h-8 text-[11px]">📄</button>
              </td>
              <td className="data-td">
                <button onClick={() => openJob(j)}
                        className="text-primary text-[11px] font-medium h-[30px]">Open →</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Financial sub-rows are rendered as additional <tr> below each job row when hasFinancialSummary */}
    </div>
  </div>
</div>
```

**Financial sub-row** (when `hasFinancialSummary`):

```tsx
<tr className="bg-surface-card border-b border-divider">
  <td colSpan={2} className="px-[10px] pb-[6px] pt-0">
    <div className="flex gap-2 text-[10px]">
      <span className="text-secondary">Finance:</span>
      <span className="text-[#22C55E]">Paid {paidAmountDisplay}</span>
      <span className="text-[#0EA5E9]">Approved {approvedAmountDisplay}</span>
      <span style={{color: varianceColor}}>{varianceSummary}</span>
    </div>
  </td>
</tr>
```

### 1.6 Tab 6: Projects

Full-height layout: header row + scrollable table.

```
Header row: "PROJECTS" label + spinner

Table cols: Code(90) / Project(*) / Role(100) / Status(90) / Open →(70)
```

```tsx
<table style={{ minWidth: 450 }} className="w-full">
  <thead>
    <tr className="bg-surface-elevated">
      <th style={{width:90}} className="data-th">Code</th>
      <th className="data-th">Project</th>
      <th style={{width:100}} className="data-th text-center">Role</th>
      <th style={{width:90}} className="data-th text-center">Status</th>
      <th style={{width:70}} className="data-th"></th>
    </tr>
  </thead>
  <tbody>
    {contractorProjects.length === 0 && (
      <tr><td colSpan={5} className="text-secondary text-center py-6 text-[13px]">No projects linked to this contractor yet.</td></tr>
    )}
    {contractorProjects.map(p => (
      <tr key={p.id} className="bg-surface-card border-b border-divider">
        <td className="data-td text-secondary font-medium">{p.projectCodeDisplay}</td>
        <td className="data-td text-primary truncate">{p.projectTitle}</td>
        <td className="data-td text-secondary text-center">{p.roleDisplay}</td>
        <td className="data-td text-center">
          <StatusBadge label={p.statusLabel} bg={p.statusBadgeBg} fg={p.statusBadgeFg} />
        </td>
        <td className="data-td">
          <button onClick={() => openProject(p)} className="text-primary text-[11px] font-medium h-[30px]">Open →</button>
        </td>
      </tr>
    ))}
  </tbody>
</table>
```

### 1.7 Tab 7: Incidents

Full-height layout: header row + scrollable table.

```
Header row: "INCIDENTS" label + spinner

Table cols: Date(90) / Incident(*) / Severity(90) / Status(90) / Job(40) / Proj(40) / Open →(70)
```

```tsx
<table style={{ minWidth: 530 }} className="w-full">
  <thead>
    <tr className="bg-surface-elevated">
      <th style={{width:90}}  className="data-th">Date</th>
      <th                     className="data-th">Incident</th>
      <th style={{width:90}}  className="data-th text-center">Severity</th>
      <th style={{width:90}}  className="data-th text-center">Status</th>
      <th style={{width:40}}  className="data-th text-center">Job</th>
      <th style={{width:40}}  className="data-th text-center">Proj</th>
      <th style={{width:70}}  className="data-th"></th>
    </tr>
  </thead>
  <tbody>
    {contractorIncidents.length === 0 && (
      <tr><td colSpan={7} className="text-secondary text-center py-6 text-[13px]">No incidents linked to this contractor.</td></tr>
    )}
    {contractorIncidents.map(i => (
      <tr key={i.id} className="bg-surface-card border-b border-divider">
        <td className="data-td text-secondary text-[11px]">{format(i.createdAt, 'dd MMM yyyy')}</td>
        <td className="data-td text-primary truncate">{i.description}</td>
        <td className="data-td text-center">
          <StatusBadge label={i.severityRaw} bg={severityBg(i.severityRaw)} fg={severityFg(i.severityRaw)} />
        </td>
        <td className="data-td text-center">
          <StatusBadge label={i.statusRaw} bg={incidentStatusBg(i.statusRaw)} fg={incidentStatusFg(i.statusRaw)} />
        </td>
        <td className="data-td text-center text-secondary text-[11px]">{i.jobId ? '●' : '—'}</td>
        <td className="data-td text-center text-secondary text-[11px]">{i.dealId ? '●' : '—'}</td>
        <td className="data-td">
          <button onClick={() => openIncident(i)} className="text-primary text-[11px] font-medium h-[30px]">Open →</button>
        </td>
      </tr>
    ))}
  </tbody>
</table>
```

**Severity badge colours** — same as Notifications page (Phase 3 §5.5).

---

## §2 `/dashboard/projects` — Projects List

### 2.1 Page layout

```
<div className="h-full flex flex-col">
  {/* Scope toggle */}
  {/* Summary caption */}
  {/* Search bar */}
  {/* Status filter chips */}
  {/* Projects table — flex-1 overflow-y-auto */}
</div>
```

### 2.2 Scope toggle

Two-button toggle row (full width, equal columns).

```tsx
<div className="grid grid-cols-2 gap-2 mx-4 mt-2">
  <button
    onClick={() => setScope('all')}
    className="h-[34px] rounded-[10px] text-[12px] font-medium"
    style={{ backgroundColor: scope === 'all' ? '#3B82F6' : '#FFFFFF', color: scope === 'all' ? '#FFFFFF' : '#6B7280' }}
  >
    {scopeAllLabel}
  </button>
  <button
    onClick={() => setScope('mine')}
    className="h-[34px] rounded-[10px] text-[12px] font-medium"
    style={{ backgroundColor: scope === 'mine' ? '#3B82F6' : '#FFFFFF', color: scope === 'mine' ? '#FFFFFF' : '#6B7280' }}
  >
    {scopeMineLabel}
  </button>
</div>
```

### 2.3 Summary caption

```tsx
<p className="text-secondary text-[12px] mx-4 mt-1.5">{listSummary}</p>
```

### 2.4 Search bar

```tsx
<input
  type="search"
  placeholder="Search code, title, client…"
  className="w-full bg-surface-dark text-primary placeholder:text-secondary rounded-lg px-3 py-2 text-[14px] mx-2 mt-1"
  value={searchText}
  onChange={e => setSearchText(e.target.value)}
/>
```

### 2.5 Status filter chips

Horizontally scrollable row, `height: 30px` chips.

```tsx
const statusFilters = ['all', 'draft', 'sent', 'in_progress', 'won', 'lost']
const statusLabels  = { all: 'All', draft: 'Draft', sent: 'Sent', in_progress: 'In progress', won: 'Won', lost: 'Lost' }

<div className="overflow-x-auto">
  <div className="flex gap-2 px-2 py-1">
    {statusFilters.map(f => (
      <button key={f} onClick={() => setStatusFilter(f)}
              className="h-[30px] rounded-2xl px-3 text-[11px] whitespace-nowrap"
              style={{
                backgroundColor: statusFilter === f ? '#3B82F6' : '#FFFFFF',
                color: statusFilter === f ? '#FFFFFF' : '#6B7280',
              }}>
        {statusLabels[f]}
      </button>
    ))}
  </div>
</div>
```

### 2.6 Projects table

Horizontally scrollable. Matches `HrProjectsTableView.xaml` exactly. Total column widths ~780px (with gaps).

```
Cols: Code(72) / Project(*) / Client(88) / Manager(108) / Status(128) / Offer(92) / Paid(84) / Progress(56) / Jobs(80) / Pay(72)
```

```tsx
<div className="flex-1 overflow-y-auto">
  <div className="overflow-x-auto mx-4">
    <table style={{ minWidth: 800 }} className="w-full">
      <thead>
        <tr className="bg-[#1E293B]">
          <th style={{width: 72}} className="data-th pl-2">Code</th>
          <th className="data-th">Project</th>
          <th style={{width: 88}} className="data-th">Client</th>
          <th style={{width:108}} className="data-th">Manager</th>
          <th style={{width:128}} className="data-th">Status</th>
          <th style={{width: 92}} className="data-th text-right">Offer</th>
          <th style={{width: 84}} className="data-th text-right">Paid</th>
          <th style={{width: 56}} className="data-th text-right">Progress</th>
          <th style={{width: 80}} className="data-th">Jobs</th>
          <th style={{width: 72}} className="data-th text-center pr-2">Pay</th>
        </tr>
      </thead>
      <tbody>
        {filteredProjects.length === 0 && (
          <tr><td colSpan={10} className="text-secondary text-center py-6 text-[13px]">
            No projects match this view. Try All projects or adjust filters.
          </td></tr>
        )}
        {filteredProjects.map(p => (
          <tr key={p.id} className="bg-surface-card border-b border-divider">
            <td className="data-td pl-2">
              <button onClick={() => openProject(p)} className="text-primary text-[12px] font-medium">
                {p.projectCodeDisplay}
              </button>
            </td>
            <td className="data-td">
              <button onClick={() => openProject(p)} className="text-left text-primary text-[13px] font-medium truncate w-full">
                {p.title}
              </button>
            </td>
            <td className="data-td text-secondary text-[12px] truncate">{p.clientName}</td>
            <td className="data-td text-secondary text-[12px] truncate">{p.managerName}</td>
            <td className="data-td">
              {/* Inline status picker — matches MAUI Picker in row */}
              <FormSelect
                options={statusOptions}
                value={p.selectedStatusLabel}
                onChange={label => updateProjectStatus(p, label)}
                className="text-[11px] h-9"
              />
            </td>
            <td className="data-td text-secondary text-[12px] text-right">{p.offerDisplay}</td>
            <td className="data-td text-secondary text-[12px] text-right">{p.paidDisplay}</td>
            <td className="data-td text-primary font-semibold text-[12px] text-right">{p.progressDisplay}</td>
            <td className="data-td text-secondary text-[12px]">{p.jobCountLabel}</td>
            <td className="data-td text-center pr-2">
              <button onClick={() => addClientPayment(p)}
                      className="bg-primary text-white rounded-lg h-8 px-2 text-[10px] font-medium">
                + Pay
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</div>
```

### 2.7 Header actions

"+ Project" and "Export" buttons — render in the page's `<TopBar>` right slot (same pattern as Phase 1 top bar), or above the table:

```tsx
<div className="flex items-center justify-between px-4 py-2">
  <h1 className="text-lg font-semibold text-primary">Projects</h1>
  <div className="flex gap-2">
    <button onClick={exportProjects} className="btn-outlined h-9 px-3 text-[13px]">Export</button>
    <button onClick={() => router.push('/dashboard/projects/new')} className="btn-primary h-9 px-3 text-[13px]">+ Project</button>
  </div>
</div>
```

### 2.8 Data fetching

```ts
// app/dashboard/projects/page.tsx (Server Component)
const { data: projects } = await supabase
  .from('projects')
  .select('*, clients(name), employees(full_name)')
  .order('created_at', { ascending: false })
```

Scope filter (All/Mine), search, and status filter applied client-side.

---

## §3 `/dashboard/projects/[id]` — Project Detail

### 3.1 Page layout

```
<div className="h-full flex flex-col">
  {/* Header row — title + Save */}
  {/* Tab bar — 5 tabs in horizontal scroll */}
  {/* Tab panel — flex-1 overflow-y-auto */}
</div>
```

### 3.2 Header row

```tsx
<div className="flex items-center justify-between px-4 py-3">
  <h1 className="text-xl font-semibold text-primary">{title}</h1>
  <button onClick={save} className="btn-primary h-11 px-5 text-[16px] min-w-[96px]">Save</button>
</div>
```

### 3.3 Tab bar

```tsx
const tabs = ['details', 'docs', 'quotation', 'pipeline', 'payments']
const tabLabels = { details: 'Details', docs: 'Docs', quotation: 'Quotation', pipeline: 'Pipeline', payments: 'Payments' }
```

Active: `bg-[#3B82F6] text-white`; inactive: `bg-white text-[#6B7280]`. Chip: `rounded-lg h-9 px-3 text-[11px]`.

Pipeline and Payments render `<ComingSoon />` for Phase 4.

### 3.4 New-project guard

```tsx
{isNew && (
  <p className="text-secondary text-center py-4 text-[12px]">
    Save the project first to attach documents, record payments, and add jobs.
  </p>
)}
```

### 3.5 Tab: Details

Two sections: **PROJECT** form + **LINKED JOBS** table + **DATES & MILESTONES**.

#### 3.5.1 PROJECT form

Inline-table style (label col | vertical divider | value col), using `DataTableFrame` pattern.

```
Row 1: "Project name" | <input placeholder="Required"> required field
Row 2: "Project code" | <input P28xxxx> | <divider> | [Generate] button
Row 3: "Client (optional)" | <Select — clients — "No client — internal project">   (hidden if !canPickClient)
Row 3: "Client" | {clientDisplay} read-only label                                  (shown if !canPickClient)
Row 4: "Manager" | <Select — managerCandidates — "Project manager">
```

Table structure:
```tsx
<div className="border border-divider rounded-lg overflow-hidden">
  {[
    /* row 1 — project name */
    <div className="grid grid-cols-[132px_1px_1fr] bg-surface-card">
      <span className="data-th px-3 py-2 border-r border-divider">Project name</span>
      <span />
      <input placeholder="Required" value={projectTitle} onChange={...} className="dark-entry flex-1" />
    </div>,
    /* ... etc */
  ]}
</div>
```

Use `border-b border-divider` between rows. Each row: `grid grid-cols-[132px_1px_1fr]` (or `[132px_1px_1fr_1px_auto]` for rows with a trailing button/switch).

#### 3.5.2 LINKED JOBS section

Only visible when `!isNew`.

```
Header: "LINKED JOBS" + [+ Add job — primary button h-10 px-[14px] text-[12px]]
Caption: {projectJobsLabel}
Table (when projectJobs.length > 0):
  Cols: Job code(100) | |(divider)| Title(*) | |(divider)| Status(88) | |(divider)| Open(72)
```

Job code cell uses a text button that navigates to the job. Open cell uses an outlined button.

#### 3.5.3 DATES & MILESTONES section

```
Caption: "Shown on the client portal so they know what to expect."
Table rows (each: label col 160px | divider | date picker | divider | toggle):
  "Site start"             | DatePicker (visible when useSiteStartDate)          | <Toggle>
  "Expected completion"    | DatePicker (visible when useExpectedCompletionDate)  | <Toggle>
  "Next visit"             | DatePicker (visible when useNextVisitDate)           | <Toggle>
  "Expected close"         | DatePicker (visible when useExpectedCloseDate)       | <Toggle>
```

When the toggle is off, the date picker is hidden and the cell shows nothing. Use `<FormDateInput />` from Phase 2.

### 3.6 Tab: Docs

Two sub-sections: **PROJECT DOCUMENTS** + **AGREEMENTS**.

#### 3.6.1 PROJECT DOCUMENTS

```
Header row: "PROJECT DOCUMENTS" | [Type picker 140px] [+ Upload primary button h-10 px-3 text-[12px]]

Table (min-width, inline):
  Cols: Document(*) | |(div)| Type(100) | |(div)| Added(96) | |(div)| Open(64) | |(div)| Delete(48)
```

Document name in Primary colour, truncated. Open = text button, Delete = `✕` button in error colour.

#### 3.6.2 AGREEMENTS

```
Table rows:
  "Client-visible" | <textarea auto-grow min-h-[72px]> — AgreementNotes
  "Internal (HR)"  | <textarea auto-grow min-h-[56px]> — Notes
```

### 3.7 Tab: Quotation

```
Section: QUOTATION FOR CLIENT

Table header block (not scrollable):
  Status  | {quotationSentLabel}     — read-only
  Intro/terms | <textarea "For the client"> — QuotationNotes auto-grow min-h-[56px]
  Valid until | <DatePicker> | <Toggle isOn={useQuotationValidUntil}>

Line items table header:
  Description(*) | Detail(88) | Amount(88)
  (with vertical dividers)

Header + "[+ Line]" button

Line rows (swipe-delete on mobile; desktop: show delete button on hover/right):
  <input description> | <input detail> | <input amount numeric>
  Delete: ✕ button on right

Total row:
  "Total (excl. VAT)" | R{subtotal}
  "VAT (15%)"          | R{vatAmount}
  "Total (incl. VAT)"  | R{total}  ← font-semibold text-primary
```

Quotation send action — "[Send quotation]" primary button at bottom, disabled if no lines.

### 3.8 Data fetching

```ts
// app/dashboard/projects/[id]/page.tsx (Server Component)
const [projectRes, clientsRes, managersRes] = await Promise.all([
  supabase.from('projects').select('*, clients(*), employees(*), project_documents(*), project_quotation_lines(*)').eq('id', params.id).single(),
  supabase.from('clients').select('id, name'),
  supabase.from('employees').select('id, full_name'),
])
```

All mutations are `'use client'` — update project fields, add/remove jobs, upload documents, add quotation lines.

---

## §4 `/dashboard/clients` — Clients List

### 4.1 Page layout

```
<div className="h-full flex flex-col">
  {/* Search + header */}
  {/* Count row */}
  {/* Table — flex-1 overflow */}
</div>
```

### 4.2 Search bar + "+ Add Client" button

```tsx
<div className="flex items-center gap-2 mx-2 mt-2">
  <input type="search" placeholder="Search by name, code, email, phone…"
         className="flex-1 bg-surface-dark text-primary placeholder:text-secondary rounded-lg px-3 py-2 text-[14px]"
         value={searchText} onChange={e => setSearchText(e.target.value)} />
  <button onClick={() => router.push('/dashboard/clients/new')} className="btn-primary h-[42px] px-3 text-[13px] whitespace-nowrap">
    + Add Client
  </button>
</div>
```

### 4.3 Count + Refresh row

```tsx
<div className="flex items-center justify-between mx-4 my-2">
  <p className="text-secondary text-[12px]">{clients.length} clients</p>
  <button onClick={refresh} className="text-primary text-[13px] px-2">Refresh</button>
</div>
```

### 4.4 Clients table

Horizontally scrollable. Total width: 920px.

```
Cols: Client(160) / Code(90) / Type(100) / Contact(120) / Email(130) / Phone(110)
```

```tsx
<div className="flex-1 overflow-y-auto">
  <div className="overflow-x-auto mx-4">
    <table style={{ minWidth: 920 }} className="w-full">
      <thead>
        <tr className="bg-surface-elevated">
          <th style={{width:160}} className="data-th">Client</th>
          <th style={{width: 90}} className="data-th">Code</th>
          <th style={{width:100}} className="data-th">Type</th>
          <th style={{width:120}} className="data-th">Contact</th>
          <th style={{width:130}} className="data-th">Email</th>
          <th style={{width:110}} className="data-th">Phone</th>
        </tr>
      </thead>
      <tbody>
        {filteredClients.length === 0 && (
          <tr><td colSpan={6} className="text-secondary text-center py-6 text-[13px]">
            No clients yet. Click + Add Client to create one.
          </td></tr>
        )}
        {filteredClients.map(c => (
          <tr key={c.id} onClick={() => router.push(`/dashboard/clients/${c.id}`)}
              className="bg-surface-card hover:bg-surface-dark cursor-pointer border-b border-divider">
            <td className="data-td text-primary">{c.name}</td>
            <td className="data-td text-primary font-medium">{c.clientCodeDisplay}</td>
            <td className="data-td text-secondary">{c.typeLabel}</td>
            <td className="data-td text-secondary truncate">{c.contactPerson}</td>
            <td className="data-td text-secondary truncate">{c.email}</td>
            <td className="data-td text-secondary">{c.phone}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</div>
```

### 4.5 Data fetching

```ts
// app/dashboard/clients/page.tsx (Server Component)
const { data: clients } = await supabase
  .from('clients')
  .select('*')
  .order('name')
```

Search applied client-side.

---

## §5 `/dashboard/clients/[id]` — Client Detail

### 5.1 Page layout

```
<div className="h-full flex flex-col">
  {/* Header row */}
  {/* Tab bar — 3 tabs (visible only when showRelatedTabs) */}
  {/* Scrollable content */}
</div>
```

### 5.2 Header row

```tsx
<div className="flex items-center justify-between px-4 py-3">
  <h1 className="text-xl font-semibold text-primary">{title}</h1>
  <button onClick={save} disabled={!isNotBusy} className="btn-primary h-11 px-5 text-[16px] min-w-[96px]">Save</button>
</div>
```

### 5.3 Tab bar

Only rendered when `showRelatedTabs` (i.e. client has been saved).

```tsx
<div className="grid grid-cols-3 gap-2 mx-4 mb-2">
  {['info','projects','jobs'].map(t => (
    <button key={t} onClick={() => setTab(t)}
            className="h-[38px] rounded-[10px] text-[12px] font-medium"
            style={{ backgroundColor: tab === t ? '#3B82F6' : '#FFFFFF', color: tab === t ? '#FFFFFF' : '#6B7280' }}>
      {t === 'info' ? 'Information' : t === 'projects' ? 'Projects' : 'Jobs'}
    </button>
  ))}
</div>
```

Phase 4 implements **Information** tab fully. **Projects** tab implements Table view (Kanban board is Phase 5). **Jobs** tab renders `<ComingSoon />`.

### 5.4 Tab: Information

Three cards:

#### 5.4.1 CLIENT DETAILS card

```
Section label: CLIENT DETAILS

<input>   Client / company name *        ← Name required
<Select>  Client type                    ← TypeOptions
<input>   Primary contact               ← ContactPerson
[Phone  <input half-width>] [Email <input half-width>]  ← grid-cols-2 gap-3
<input>   Address
<textarea> Notes  auto-grow min-h-[72px]
```

#### 5.4.2 CLIENT PORTAL ACCESS card

```
Section label: CLIENT PORTAL ACCESS

<input>  {companyCode}  read-only  ← company's code (not editable)

[ClientCode <input>] [Generate — bg-surface-dark text-primary]  ← grid-cols-[1fr_auto] gap-2

[Copy portal login credentials]  ← bg-surface-dark text-primary h-[42px] full width; disabled if !hasClientCode
[Rotate portal code]             ← shown only when hasClientCode; bg-surface-dark text-[#F59E0B]

"Clients use Home → Client portal sign-in with company code + client code."  — text-secondary text-[11px]
```

#### 5.4.3 Sites section (when `showRelatedTabs`)

```
Header: "Sites" + [+ Site — text button]
List (max-h-[140px] overflow-y-auto):
  Each site: grid-cols-2 — Name (data-td text-primary) | Address (data-td text-secondary)
  Empty: "No sites."
```

### 5.5 Tab: Projects (Table view only)

```
Header: "Projects (CRM)"
View toggle: [Board] [Table]  — Board is disabled/ComingSoon in Phase 4
[+ Project — primary button h-9 px-[14px] text-[13px]]

Board view → <ComingSoon message="Kanban board coming soon" />

Table view → same projects table as §2.6 but filtered to this client
```

View toggle buttons: active `bg-[#3B82F6] text-white`, inactive `bg-white text-[#6B7280]`. Both: `rounded-lg h-8 px-[10px] text-[11px]`.

Caption: "Drag the ⋮⋮ handle between columns, or tap ⋮⋮ to pick a stage." only shown when board view active (hidden in Phase 4).

### 5.6 Data fetching

```ts
// app/dashboard/clients/[id]/page.tsx
const [clientRes, sitesRes, projectsRes] = await Promise.all([
  supabase.from('clients').select('*').eq('id', params.id).single(),
  supabase.from('sites').select('*').eq('client_id', params.id),
  supabase.from('projects').select('*, employees(full_name)').eq('client_id', params.id),
])
```

---

## §6 `/dashboard/incidents` — Incidents List

### 6.1 Page layout

```
<div className="h-full flex flex-col">
  {/* Header */}
  {/* Scope filter chips */}
  {/* Open/All filter bar */}
  {/* Search bar */}
  {/* Incident cards — flex-1 overflow-y-auto */}
</div>
```

### 6.2 Header + new incident

```tsx
<div className="flex items-center justify-between px-4 py-3 bg-surface-dark">
  <h1 className="text-lg font-semibold text-primary">Incident Reports</h1>
  <button onClick={() => router.push('/dashboard/incidents/new')} className="btn-primary h-9 px-3 text-[13px]">
    New
  </button>
</div>
```

### 6.3 Scope filter chips

Horizontally scrollable. Active: `bg-[#3B82F6] text-white`; inactive: `bg-white text-[#6B7280]`.

```tsx
const scopes = [
  { value: 'all', label: 'All' },
  { value: 'standalone', label: 'Standalone' },
  { value: 'job', label: 'Job-linked' },
]
```

Chip: `rounded-2xl h-8 px-3 text-[12px]`.

### 6.4 Open/All filter bar

Two chips in a `bg-surface-dark` row with `px-4 py-2` padding.

```tsx
<div className="flex gap-2 bg-surface-dark px-4 py-2">
  <button
    onClick={() => setShowOpenOnly(true)}
    className="rounded-2xl px-3 py-1.5 text-[13px]"
    style={{ backgroundColor: showOpenOnly ? '#3B82F6' : '#E5E7EB', color: showOpenOnly ? 'white' : '#6B7280' }}
  >
    Open
  </button>
  <button
    onClick={() => setShowOpenOnly(false)}
    className="rounded-2xl px-3 py-1.5 text-[13px]"
    style={{ backgroundColor: !showOpenOnly ? '#3B82F6' : '#E5E7EB', color: !showOpenOnly ? 'white' : '#6B7280' }}
  >
    All
  </button>
</div>
```

### 6.5 Search bar

```tsx
<input type="search" placeholder="Search incidents..."
       className="w-full bg-surface-dark text-primary placeholder:text-secondary mx-4 my-1 rounded-lg px-3 py-2 text-[14px]"
       value={searchText} onChange={e => setSearchText(e.target.value)} />
```

### 6.6 Incident cards list

```tsx
<div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
  {incidents.length === 0 && (
    <div className="flex flex-col items-center py-8 gap-3">
      <span className="text-[48px]">✅</span>
      <p className="text-secondary text-[14px]">No incidents found</p>
    </div>
  )}
  {incidents.map(inc => (
    <IncidentCard key={inc.id} incident={inc} onClose={closeIncident} onClick={viewIncident} />
  ))}
</div>
```

**IncidentCard:**

```tsx
function IncidentCard({ incident, onClose, onClick }) {
  return (
    <div className="card p-4 cursor-pointer hover:bg-surface-dark" onClick={() => onClick(incident)}>
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        {/* Row 0: title + severity badge */}
        <p className="font-semibold text-primary">{incident.report.displayTitle}</p>
        <StatusBadge label={incident.report.severityRaw} bg={severityBg(incident.report.severityRaw)} fg={severityFg(incident.report.severityRaw)} />
        {/* Row 1: status + date */}
        <p className="text-secondary text-[12px]">{incident.report.statusRaw}</p>
        <p className="text-secondary text-[11px] text-right">{format(incident.report.createdAt, 'dd MMM yyyy')}</p>
        {/* Row 2: linked job (if any) */}
        {incident.report.jobTitle && (
          <p className="text-secondary text-[11px] col-span-2">Job: {incident.report.jobTitle}</p>
        )}
        {/* Row 3: assignee */}
        {incident.report.assigneeName && (
          <p className="text-secondary text-[11px] col-span-2">Assigned: {incident.report.assigneeName}</p>
        )}
      </div>
      {/* Close button — right-aligned below card content */}
      {incident.canClose && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={e => { e.stopPropagation(); onClose(incident) }}
            className="bg-primary text-white rounded-lg px-3 h-8 text-[12px]"
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}
```

(MAUI uses SwipeView for the Close action; on web render as a button inside the card.)

### 6.7 Data fetching

```ts
// app/dashboard/incidents/page.tsx (Server Component)
const { data: incidents } = await supabase
  .from('incident_reports')
  .select('*, jobs(title), employees(full_name)')
  .order('created_at', { ascending: false })
```

Scope, open/all, and search filters applied client-side.

---

## §7 `/dashboard/incidents/[id]` — Incident Detail

### 7.1 Page layout

Scrollable stack of cards.

```tsx
<div className="p-4 space-y-4 overflow-y-auto">
  {/* Header card */}
  {/* Linked job card — optional */}
  {/* Reported by card */}
  {/* Description card */}
  {/* Photos card — optional */}
  {/* Resolution card — optional, when closed */}
  {/* Assigned to card */}
  {/* Action buttons row */}
  {/* Comments card */}
</div>
```

### 7.2 Header card

```tsx
<div className="card p-4 flex justify-between items-start">
  <div className="space-y-1">
    <h1 className="font-bold text-[18px] text-primary">{incident.displayTitle}</h1>
    <p className="text-primary text-[12px]">{incident.statusRaw}</p>
    <p className="text-secondary text-[12px]">
      Reported {format(incident.createdAt, 'dd MMM yyyy, HH:mm')}
    </p>
  </div>
  <StatusBadge label={incident.severityRaw} bg={severityBg(incident.severityRaw)} fg={severityFg(incident.severityRaw)} />
</div>
```

### 7.3 Linked job card

Only visible when `jobTitle` is non-null.

```tsx
<div className="card p-4">
  <p className="text-primary text-[14px]">Linked job: {jobTitle}</p>
</div>
```

Text in `text-primary` colour (matching MAUI `TextColor="{StaticResource Primary}"`).

### 7.4 Reported by card

```tsx
<div className="card p-4 flex items-center gap-3">
  <span className="text-secondary text-[13px] whitespace-nowrap">Reported by</span>
  <span className="text-primary text-[14px]">{reportedBy}</span>
</div>
```

### 7.5 Description card

```tsx
<div className="card p-4 space-y-2">
  <p className="section-label">DESCRIPTION</p>
  <p className="text-primary text-[14px] leading-relaxed">{incident.description}</p>
  <p className="text-secondary text-[12px]">Category: {incident.categoryRaw}</p>
</div>
```

### 7.6 Photos card

Only visible when `incident.hasPhotos`.

```tsx
<div className="card p-4 space-y-2">
  <p className="section-label">PHOTOS</p>
  <div className="flex gap-2 overflow-x-auto h-[120px]">
    {incident.photoUrls.map(url => (
      <img key={url} src={url} className="w-[110px] h-[110px] object-cover rounded flex-shrink-0" />
    ))}
  </div>
</div>
```

### 7.7 Resolution card

Only visible when `incident.isClosed`.

```tsx
<div className="card p-4 space-y-2">
  <p className="section-label">RESOLUTION</p>
  <p className="text-secondary text-[14px]">{incident.resolutionNotes || 'No notes.'}</p>
</div>
```

### 7.8 Assigned to card

```tsx
<div className="card p-4 flex items-center justify-between">
  <div>
    <p className="section-label">ASSIGNED TO</p>
    <p className="text-primary text-[14px]">{assigneeName}</p>
  </div>
  {canManage && (
    <button onClick={assign} className="bg-surface-dark text-primary rounded-lg px-3 py-1.5 text-[12px]">
      Assign
    </button>
  )}
</div>
```

### 7.9 Action buttons row

Only visible when `canManage`.

```tsx
<div className="flex gap-2">
  <button onClick={() => setStatus('investigating')} className="btn-outlined text-[11px] h-9 px-3">Investigating</button>
  <button onClick={() => setStatus('resolved')}      className="btn-outlined text-[11px] h-9 px-3">Resolved</button>
  <button onClick={closeIncident}                    className="btn-primary  text-[11px] h-9 px-3">Close</button>
</div>
```

### 7.10 Comments card

```tsx
<div className="card p-4 space-y-3">
  <p className="section-label">COMMENTS</p>
  {comments.length === 0 && <p className="text-secondary text-[13px]">No comments yet.</p>}
  {comments.map(c => (
    <div key={c.id} className="py-1.5 space-y-0.5 border-b border-divider last:border-0">
      <p className="text-primary text-[12px]">{c.authorDisplay}</p>
      <p className="text-primary text-[14px]">{c.body}</p>
      <p className="text-secondary text-[10px]">{format(c.createdAt, 'dd MMM HH:mm')}</p>
    </div>
  ))}
  {/* Add comment input */}
  <div className="flex gap-2 pt-1">
    <input placeholder="Add a comment…" value={newComment} onChange={e => setNewComment(e.target.value)}
           onKeyDown={e => e.key === 'Enter' && addComment()}
           className="flex-1 dark-entry" />
    <button onClick={addComment} className="btn-primary h-[42px] px-4 text-[13px]">Post</button>
  </div>
</div>
```

### 7.11 Data fetching

```ts
// app/dashboard/incidents/[id]/page.tsx (Server Component)
const [incidentRes, commentsRes] = await Promise.all([
  supabase.from('incident_reports').select('*, jobs(title), employees!assigned_to(full_name)').eq('id', params.id).single(),
  supabase.from('incident_comments').select('*, employees(full_name)').eq('incident_id', params.id).order('created_at'),
])
```

---

## §8 New shared components in Phase 4

### 8.1 `<InfoBanner />`

```tsx
// components/ui/InfoBanner.tsx
export function InfoBanner({ icon = 'info', text }: { icon?: string; text: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className="material-icons text-secondary text-[18px]">{icon}</span>
      <p className="text-secondary text-[13px] flex-1">{text}</p>
    </div>
  )
}
```

### 8.2 `<DocFilterChip />`

```tsx
// components/ui/DocFilterChip.tsx
export function DocFilterChip({ count, label, active, bg, valueFg, labelFg, borderColor, onClick }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg px-[10px] py-[5px] flex items-center gap-1.5 border text-[11px]"
      style={{ backgroundColor: bg, borderColor: active ? 'var(--color-primary)' : 'transparent' }}
    >
      <span style={{ color: valueFg }} className="font-semibold text-[13px]">{count}</span>
      <span style={{ color: labelFg }}>{label}</span>
    </button>
  )
}
```

---

## §9 Sidebar nav additions

```
| Nav item   | Icon         | Route                        |
|------------|--------------|------------------------------|
| Projects   | &#xE8EF; (work) | /dashboard/projects       |
| Clients    | &#xE7FB; (business) | /dashboard/clients    |
| Incidents  | &#xE002; (warning) | /dashboard/incidents   |
```

These items may already be present in the Phase 1 sidebar XAML. Verify nav items against `SidebarView.xaml` before adding duplicates. If already present, no sidebar changes needed.

---

## §10 New routes summary

```
app/
  dashboard/
    projects/
      page.tsx         ← §2
      [id]/
        page.tsx       ← §3
    clients/
      page.tsx         ← §4
      [id]/
        page.tsx       ← §5
    incidents/
      page.tsx         ← §6
      [id]/
        page.tsx       ← §7
```

Existing route extended: `app/dashboard/contractors/[id]/page.tsx` — adds Tabs 3–7 and complete Compliance document table.

Total new/extended pages: **7 new + 1 extended = 8**. Running total: 23 + 7 = **30 pages**.

---

## §11 Engineering handoff notes

1. **Contractor detail tab state** — `activeTab` is already managed in the existing Phase 3 `ContractorDetailClient` component. Add the 5 new tab panels following the same `activeTab === 'payments'` pattern.

2. **Projects table inline status picker** — The MAUI table embeds a `Picker` directly in the status cell so the user can change project status without opening the detail page. Replicate this with `<FormSelect>` in the table row. Fire an optimistic update + debounced RPC call on change.

3. **Quotation VAT calculation** — 15% fixed rate. Calculate client-side:
   ```ts
   const subtotal = lines.reduce((sum, l) => sum + parseFloat(l.amount || '0'), 0)
   const vat = subtotal * 0.15
   const total = subtotal + vat
   ```

4. **New incident route** — `/dashboard/incidents/new` creates a fresh incident form. Scope for Phase 5; render `<ComingSoon />` for now.

5. **Kanban board (Client Projects tab)** — The board view with `ProjectKanbanColumnView` is complex drag-and-drop. Keep as `<ComingSoon />` for Phase 4. Only the Table view is required.

6. **Date format consistency** — All incident dates: `'dd MMM yyyy'`. All job datetime: `'dd MMM yyyy HH:mm'`. Use `Intl.DateTimeFormat` consistently (not `.toLocaleDateString()`).

7. **`supabase.rpc()` — always `try/catch`** — same rule as all previous phases.

8. **Compliance document upload** — Uses the same Supabase Storage pattern as job photos:
   ```ts
   const path = `contractors/${contractorId}/compliance/${Date.now()}_${file.name}`
   await supabase.storage.from('workforce-media').upload(path, file)
   ```
   Insert a record to `contractor_documents` after successful upload.

9. **Photo URLs from Storage** — Incident photos are stored in `workforce-media`. Fetch signed URLs:
   ```ts
   const { data } = await supabase.storage.from('workforce-media').createSignedUrl(path, 3600)
   ```

10. **`/dashboard/contractors/new`** — The existing Phase 3 stub at this route should now navigate to the same `ContractorDetailPage` with `isNew = true` (no ID in URL). The `isNew` state gates portal code, compliance, and team tabs behind the save-first guard cards.
