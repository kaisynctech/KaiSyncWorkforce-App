'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { buildComplianceView, checklistStatusLabel, documentTypeLabel } from '@/lib/contractor-portal/compliance'
import { CLIENT_DOC_TYPES, type ContractorDocument } from '@/lib/contractor-portal/types'
import {
  assignClientPack,
  getClientCompliance,
  reviewClientDocument,
  uploadClientDocument,
  type ClientComplianceData,
} from '@/lib/compliance/party'
import { SectionCard } from '@/components/SectionCard'
import { FormSelect } from '@/components/FormSelect'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { KpiTile } from '@/components/ui/KpiTile'
import { DocFilterChip } from '@/components/ui/DocFilterChip'
import { ComplianceGradeBox } from '@/components/ComplianceGradeBox'

// Same colours and layout as the contractor Compliance tab — one system, one look.
const CHECKLIST_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  complete: { bg: '#DCFCE7', fg: '#166534' },
  expiring: { bg: '#FEF3C7', fg: '#92400E' },
  expired:  { bg: '#FEE2E2', fg: '#991B1B' },
  pending:  { bg: '#E5E7EB', fg: '#6B7280' },
  rejected: { bg: '#FEE2E2', fg: '#991B1B' },
  missing:  { bg: '#1E293B', fg: '#94A3B8' },
}

const DOC_APPROVAL_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  approved: { bg: '#DCFCE7', fg: '#166534', label: 'Approved' },
  pending:  { bg: '#1E293B', fg: '#94A3B8', label: 'Pending' },
  rejected: { bg: '#FEE2E2', fg: '#991B1B', label: 'Rejected' },
  expired:  { bg: '#450A0A', fg: '#FCA5A5', label: 'Expired' },
  expiring: { bg: '#FEF3C7', fg: '#92400E', label: 'Expiring' },
}

type DocFilterType = 'all' | 'approved' | 'pending' | 'rejected' | 'expired'
type Doc = ClientComplianceData['documents'][number]

function docDisplayStatus(doc: ContractorDocument): keyof typeof DOC_APPROVAL_COLORS {
  if (doc.approval_status === 'rejected') return 'rejected'
  if (doc.approval_status === 'pending') return 'pending'
  if (doc.expiry_date) {
    const days = (new Date(doc.expiry_date).getTime() - Date.now()) / 86400000
    if (days < 0) return 'expired'
    if (days <= 30) return 'expiring'
  }
  return 'approved'
}

const daysUntil = (d: string) => (new Date(d).getTime() - Date.now()) / 86400000

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

const FROM_US = new Set(CLIENT_DOC_TYPES.filter(t => t.fromUs).map(t => t.value))

/** HR Compliance tab on a client record. Same tables, rules and layout as contractors. */
export function ClientComplianceTab({ companyId, clientId, focusDocId }: { companyId: string; clientId: string; focusDocId?: string | null }) {
  const [data, setData] = useState<ClientComplianceData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploadDocType, setUploadDocType] = useState('tax_clearance')
  const [uploadExpiry, setUploadExpiry] = useState('')
  const [docFilter, setDocFilter] = useState<DocFilterType>('all')
  const [documentSearch, setDocumentSearch] = useState('')
  const [docSort, setDocSort] = useState<'newest' | 'name' | 'expiry'>('newest')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try { setData(await getClientCompliance(createClient(), companyId, clientId)) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Could not load compliance.') }
  }, [companyId, clientId])

  // Loads from the server on mount; setState happens after the await.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!focusDocId || !data) return
    document.getElementById(`compliance-doc-${focusDocId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusDocId, data])

  const theirDocs = useMemo(() => (data?.documents ?? []).filter(d => d.direction === 'from_party'), [data])
  const ourDocs = useMemo(() => (data?.documents ?? []).filter(d => d.direction === 'to_party'), [data])
  const theirItems = useMemo(() => (data?.items ?? []).filter(i => (i.direction ?? 'from_party') === 'from_party'), [data])
  const ourItems = useMemo(() => (data?.items ?? []).filter(i => i.direction === 'to_party'), [data])

  const complianceView = useMemo(() => buildComplianceView(theirDocs, theirItems), [theirDocs, theirItems])
  const obligationsView = useMemo(() => buildComplianceView(ourDocs, ourItems), [ourDocs, ourItems])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null)
    try { await fn(); await load() }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Something went wrong.') }
    setBusy(false)
  }

  async function viewDocument(doc: Doc) {
    const path = doc.storage_path?.trim()
    const supabase = createClient()
    if (!path) { if (doc.file_url) window.open(doc.file_url, '_blank', 'noopener,noreferrer'); return }
    const { data: signed, error: signErr } = await supabase.storage.from('workforce-media').createSignedUrl(path, 3600)
    if (signErr || !signed?.signedUrl) { setError(signErr?.message ?? 'Could not open the file.'); return }
    window.open(signed.signedUrl, '_blank', 'noopener,noreferrer')
  }

  function approve(doc: Doc) { void run(() => reviewClientDocument(createClient(), doc.id, 'approve')) }
  function reject(doc: Doc) {
    const reason = window.prompt('Rejection reason:')
    if (reason == null || !reason.trim()) return
    void run(() => reviewClientDocument(createClient(), doc.id, 'reject', reason.trim()))
  }
  function remove(doc: Doc) {
    if (!window.confirm(`Remove "${doc.document_name}"? It stays in the history but is no longer current.`)) return
    void run(() => reviewClientDocument(createClient(), doc.id, 'remove'))
  }
  function upload(file: File, documentType = uploadDocType) {
    if (!data) return
    void run(async () => {
      await uploadClientDocument(createClient(), {
        companyId, clientId, uploadPrefix: data.upload_prefix, file, documentType,
        direction: FROM_US.has(documentType) ? 'to_party' : 'from_party',
        expiryDate: uploadExpiry || null,
      })
      setUploadExpiry('')
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  if (!data) {
    return (
      <div className="flex-1 overflow-y-auto p-4 w-full">
        {error ? <p className="text-error text-[13px]">{error}</p> : <p className="text-text-secondary text-[13px]">Loading compliance…</p>}
      </div>
    )
  }

  const canEdit = data.can_edit
  const canReview = data.can_review
  const requiredDocsCount = complianceView.required_count
  const validRequired = complianceView.complete_count
  const expiringRequired = complianceView.checklist.filter(r => r.is_required && r.status === 'expiring').length
  const expiredRequired = complianceView.checklist.filter(r => r.is_required && r.status === 'expired').length
  const pendingRequired = complianceView.checklist.filter(r => r.is_required && r.status === 'pending').length
  const rejectedRequired = complianceView.checklist.filter(r => r.is_required && r.status === 'rejected').length
  const missingRequired = complianceView.missing_count
  const compScore = complianceView.score_percent
  const compScoreColor = compScore >= 80 ? '#22C55E' : compScore >= 50 ? '#F59E0B' : '#EF4444'
  const compStatusLabel = complianceView.status_label === 'Not Configured' ? 'Not Configured'
    : complianceView.status_label === 'Compliant' ? 'Compliant'
      : complianceView.status_label === 'Near Compliant' || complianceView.status_label === 'Partial' ? 'At Risk'
        : 'Non-Compliant'
  const expiringDocs = theirDocs.filter(d => docDisplayStatus(d) === 'expiring')

  const totalDocuments = theirDocs.length
  const approvedDocCount = theirDocs.filter(d => docDisplayStatus(d) === 'approved').length
  const pendingDocCount = theirDocs.filter(d => d.approval_status === 'pending').length
  const rejectedDocCount = theirDocs.filter(d => d.approval_status === 'rejected').length
  const expiredDocCount = theirDocs.filter(d => docDisplayStatus(d) === 'expired').length

  const filteredDocuments = theirDocs
    .filter(d => {
      const status = docDisplayStatus(d)
      if (docFilter === 'approved') return status === 'approved'
      if (docFilter === 'pending') return status === 'pending'
      if (docFilter === 'rejected') return status === 'rejected'
      if (docFilter === 'expired') return status === 'expired'
      return true
    })
    .filter(d => !documentSearch
      || d.document_type.toLowerCase().includes(documentSearch.toLowerCase())
      || d.document_name.toLowerCase().includes(documentSearch.toLowerCase()))
    .sort((a, b) => {
      if (docSort === 'name') return a.document_name.localeCompare(b.document_name)
      if (docSort === 'expiry') {
        if (!a.expiry_date && !b.expiry_date) return 0
        if (!a.expiry_date) return 1
        if (!b.expiry_date) return -1
        return a.expiry_date.localeCompare(b.expiry_date)
      }
      return b.created_at.localeCompare(a.created_at)
    })

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 w-full">
      {error && <div className="rounded-lg bg-error-dark text-error px-3 py-2 text-[12px]">{error}</div>}

      <SectionCard title="COMPLIANCE PACK">
        <FormSelect
          label="Select compliance pack"
          value={data.pack_id ?? ''}
          disabled={!canEdit || busy}
          onChange={e => { const v = e.target.value; void run(() => assignClientPack(createClient(), companyId, clientId, v || null)) }}
        >
          <option value="">None</option>
          {data.packs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </FormSelect>
        {data.pack_id ? (
          <div className="grid grid-cols-3 gap-2">
            <KpiTile value={requiredDocsCount} label="Required" bg="#1E293B" valueFg="#94A3B8" labelFg="#94A3B8" />
            <KpiTile value={validRequired} label="Complete" bg="#14532D" valueFg="#22C55E" labelFg="#4ADE80" />
            <KpiTile value={missingRequired + rejectedRequired + expiredRequired} label="Missing" bg="#2D0A0A" valueFg="#FCA5A5" labelFg="#FCA5A5" />
          </div>
        ) : (
          <p className="text-text-secondary text-[12px]">
            Assign a compliance pack to enable pack-based scoring and a required document checklist.
            {data.packs.length === 0 && ' Client packs are set up under Compliance Packs → Clients.'}
          </p>
        )}
      </SectionCard>

      <ComplianceGradeBox companyId={companyId} kind="client" partyId={clientId} />

      {complianceView.has_pack && complianceView.checklist.length > 0 && (
        <SectionCard title="REQUIRED DOCUMENTS CHECKLIST">
          <p className="text-[11px] text-text-secondary">
            Based on the assigned compliance pack. Required rows (Req.) count toward the compliance score.
            Missing types appear here even before a file is uploaded.
          </p>
          <div className="border-t border-divider mt-1 divide-y divide-divider/40">
            {complianceView.checklist.map(row => {
              const sc = CHECKLIST_STATUS_COLORS[row.status] ?? CHECKLIST_STATUS_COLORS.missing
              return (
                <div key={row.document_type} className="flex items-center gap-3 py-2">
                  <span className="rounded-[6px] px-[6px] py-[3px] text-[9px] font-medium shrink-0"
                    style={{ backgroundColor: row.is_required ? '#450A0A' : '#1E293B', color: row.is_required ? '#FCA5A5' : '#94A3B8' }}>
                    {row.is_required ? 'Req.' : 'Opt.'}
                  </span>
                  <span className="text-text-primary text-[12px] flex-1">{row.type_label}</span>
                  {row.expiry_display && <span className="text-text-secondary text-[11px] shrink-0">{row.expiry_display}</span>}
                  <span className="rounded-lg px-2 py-[3px] text-[10px] font-medium shrink-0" style={{ backgroundColor: sc.bg, color: sc.fg }}>
                    {checklistStatusLabel(row.status)}
                  </span>
                </div>
              )
            })}
          </div>
        </SectionCard>
      )}

      <SectionCard title="COMPLIANCE OVERVIEW">
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center shrink-0">
            <span className="text-[30px] font-bold" style={{ color: compScoreColor }}>{compScore}%</span>
            <span className="text-[10px] text-text-secondary">({validRequired}/{requiredDocsCount} required)</span>
          </div>
          <div className="flex-1 space-y-1">
            <div className="h-[10px] rounded-full overflow-hidden bg-surface-elevated">
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${compScore}%`, backgroundColor: compScoreColor }} />
            </div>
            <p className="text-[10px] text-text-secondary">Required pack types with approved, non-expired documents</p>
          </div>
          <span className="rounded-lg px-[10px] py-[6px] text-[12px] font-medium shrink-0"
            style={{
              backgroundColor: compScore >= 80 ? '#DCFCE7' : compScore >= 50 ? '#FEF3C7' : '#FEE2E2',
              color: compScore >= 80 ? '#166534' : compScore >= 50 ? '#92400E' : '#991B1B',
            }}>
            {compStatusLabel}
          </span>
        </div>

        <div className="grid grid-cols-5 gap-1.5 py-2">
          <KpiTile value={validRequired}    label="Valid"    bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
          <KpiTile value={expiringRequired} label="Expiring" bg="#292012" valueFg="#FCD34D" labelFg="#FCD34D" />
          <KpiTile value={expiredRequired}  label="Expired"  bg="#2D0A0A" valueFg="#FCA5A5" labelFg="#FCA5A5" />
          <KpiTile value={pendingRequired}  label="Pending"  bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
          <KpiTile value={rejectedRequired} label="Rejected" bg="#2D0F0F" valueFg="#F87171" labelFg="#F87171" />
        </div>

        {requiredDocsCount === 0 && (
          <Alert icon="info" tone="muted">No required documents configured. Assign a compliance pack first.</Alert>
        )}
        {missingRequired > 0 && (
          <Alert icon="description" tone="muted">{missingRequired} required type{missingRequired > 1 ? 's' : ''} still missing an upload.</Alert>
        )}
        {expiredRequired > 0 && (
          <Alert icon="warning" tone="error">{expiredRequired} required document{expiredRequired > 1 ? 's' : ''} have expired.</Alert>
        )}
        {pendingRequired > 0 && (
          <Alert icon="info" tone="warning">{pendingRequired} required document{pendingRequired > 1 ? 's' : ''} pending review.</Alert>
        )}
        {rejectedRequired > 0 && (
          <Alert icon="cancel" tone="error">{rejectedRequired} required document{rejectedRequired > 1 ? 's' : ''} rejected.</Alert>
        )}
        {expiringDocs.length > 0 && (
          <div className="border-t border-divider pt-3 space-y-2">
            <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase">Expiring Within 30 Days</p>
            {expiringDocs.map(doc => (
              <div key={doc.id} className="flex items-center gap-2">
                <span className="text-text-primary text-[12px] flex-1">{documentTypeLabel(doc.document_type)}</span>
                {doc.expiry_date && <span className="text-[11px] shrink-0" style={{ color: '#F59E0B' }}>{fmtDate(doc.expiry_date)}</span>}
                <span className="material-icons text-[14px]" style={{ color: '#F59E0B' }}>warning</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {(ourItems.length > 0 || ourDocs.length > 0) && (
        <SectionCard title="OUR DOCUMENTS FOR THIS CLIENT">
          <p className="text-[11px] text-text-secondary">
            Documents we owe this client (safety file, COIDA letter, our insurance…). Approved files show in their portal.
          </p>
          <div className="border-t border-divider mt-1 divide-y divide-divider/40">
            {obligationsView.checklist.map(row => {
              const sc = CHECKLIST_STATUS_COLORS[row.status] ?? CHECKLIST_STATUS_COLORS.missing
              const doc = ourDocs.find(d => d.document_type === row.document_type)
              return (
                <div key={row.document_type} className="flex items-center gap-3 py-2">
                  <span className="text-text-primary text-[12px] flex-1">{row.type_label}</span>
                  {row.expiry_display && <span className="text-text-secondary text-[11px] shrink-0">{row.expiry_display}</span>}
                  <span className="rounded-lg px-2 py-[3px] text-[10px] font-medium shrink-0" style={{ backgroundColor: sc.bg, color: sc.fg }}>
                    {row.status === 'missing' ? 'Not sent' : checklistStatusLabel(row.status)}
                  </span>
                  {doc && <button type="button" onClick={() => void viewDocument(doc)} className="text-primary text-[11px] font-medium">View</button>}
                  {canEdit && (
                    <label className="text-primary text-[11px] font-medium cursor-pointer">
                      {doc ? 'Replace' : 'Upload'}
                      <input type="file" className="hidden" disabled={busy}
                        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f, row.document_type); e.target.value = '' }} />
                    </label>
                  )}
                </div>
              )
            })}
            {ourDocs.filter(d => !ourItems.some(i => i.document_type === d.document_type)).map(doc => (
              <div key={doc.id} className="flex items-center gap-3 py-2">
                <span className="text-text-primary text-[12px] flex-1">{documentTypeLabel(doc.document_type)}</span>
                {doc.expiry_date && <span className="text-text-secondary text-[11px] shrink-0">{fmtDate(doc.expiry_date)}</span>}
                <button type="button" onClick={() => void viewDocument(doc)} className="text-primary text-[11px] font-medium">View</button>
                {canEdit && <button type="button" onClick={() => remove(doc)} className="text-error text-[11px] font-medium">Remove</button>}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="section-label">COMPLIANCE DOCUMENTS</p>
          {canEdit && (
            <div className="flex items-center gap-2 flex-wrap">
              <select value={uploadDocType} onChange={e => setUploadDocType(e.target.value)}
                className="text-[11px] h-[34px] px-2 rounded-lg border border-border bg-surface text-text-secondary">
                {CLIENT_DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input type="date" value={uploadExpiry} onChange={e => setUploadExpiry(e.target.value)} title="Expiry date (optional)"
                className="text-[11px] h-[34px] px-2 rounded-lg border border-border bg-surface text-text-secondary" />
              <input ref={fileRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} />
              <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
                className="btn-primary h-[34px] px-[14px] text-[12px] disabled:opacity-50">
                {busy ? 'Working…' : '+ Upload'}
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-1.5 flex-wrap">
          <DocFilterChip count={totalDocuments}   label="Total"    active={docFilter === 'all'}      bg="#1E293B" valueFg="#CBD5E1" labelFg="#64748B" onClick={() => setDocFilter('all')} />
          <DocFilterChip count={approvedDocCount} label="Approved" active={docFilter === 'approved'} bg="#14532D" valueFg="#22C55E" labelFg="#22C55E" onClick={() => setDocFilter('approved')} />
          <DocFilterChip count={pendingDocCount}  label="Pending"  active={docFilter === 'pending'}  bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" onClick={() => setDocFilter('pending')} />
          <DocFilterChip count={rejectedDocCount} label="Rejected" active={docFilter === 'rejected'} bg="#7F1D1D" valueFg="#FCA5A5" labelFg="#FCA5A5" onClick={() => setDocFilter('rejected')} />
          <DocFilterChip count={expiredDocCount}  label="Expired"  active={docFilter === 'expired'}  bg="#450A0A" valueFg="#FCA5A5" labelFg="#FCA5A5" onClick={() => setDocFilter('expired')} />
        </div>

        <div className="grid grid-cols-[1fr_180px] gap-2">
          <div className="flex items-center gap-1 bg-surface border border-border rounded-lg px-2">
            <span className="material-icons text-text-secondary text-[16px]">search</span>
            <input placeholder="Search documents…" value={documentSearch} onChange={e => setDocumentSearch(e.target.value)}
              className="flex-1 bg-transparent text-text-primary text-[13px] h-[38px] outline-none placeholder:text-text-disabled" />
          </div>
          <FormSelect value={docSort} onChange={e => setDocSort(e.target.value as 'newest' | 'name' | 'expiry')}>
            <option value="newest">Sort: Newest first</option>
            <option value="name">Sort: Name A–Z</option>
            <option value="expiry">Sort: Expiry</option>
          </FormSelect>
        </div>

        <div className="overflow-x-auto bg-surface rounded-lg border border-divider">
          <table style={{ minWidth: 925 }} className="w-full">
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th style={{ width: 160 }} className="data-th">Type</th>
                <th style={{ width: 175 }} className="data-th">Document Name</th>
                <th style={{ width: 120 }} className="data-th">Status</th>
                <th style={{ width: 115 }} className="data-th">Expires</th>
                <th style={{ width:  65 }} className="data-th text-center">Req.</th>
                <th style={{ width:  90 }} className="data-th text-center">Uploaded</th>
                <th style={{ width: 185 }} className="data-th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocuments.map(doc => {
                const status = docDisplayStatus(doc)
                const approval = DOC_APPROVAL_COLORS[status] ?? DOC_APPROVAL_COLORS.pending
                const daysToExpiry = doc.expiry_date ? daysUntil(doc.expiry_date) : Infinity
                const showWarn = daysToExpiry <= 30 && daysToExpiry >= 0
                const expiryColor = daysToExpiry < 0 ? '#FCA5A5' : showWarn ? '#F59E0B' : 'var(--color-text-secondary)'
                const required = theirItems.some(i => i.document_type === doc.document_type && i.requirement === 'required')
                return (
                  <tr id={`compliance-doc-${doc.id}`} key={doc.id}
                    className={`bg-surface border-b border-divider last:border-0 ${focusDocId === doc.id ? 'ring-2 ring-primary/60 ring-inset' : ''}`}>
                    <td className="data-td text-[12px] truncate text-text-secondary">{documentTypeLabel(doc.document_type)}</td>
                    <td className="data-td">
                      <p className="text-[12px] text-text-primary truncate">{doc.document_name}</p>
                      {doc.approval_status === 'rejected' && doc.rejected_reason && (
                        <p className="text-[10px] truncate" style={{ color: '#FCA5A5' }}>↳ {doc.rejected_reason}</p>
                      )}
                    </td>
                    <td className="data-td"><StatusBadge label={approval.label} bg={approval.bg} fg={approval.fg} /></td>
                    <td className="data-td text-[11px]">
                      <div className="flex items-center gap-1">
                        {showWarn && <span className="material-icons text-[13px]" style={{ color: expiryColor }}>warning</span>}
                        <span style={{ color: expiryColor }}>{doc.expiry_date ? fmtDate(doc.expiry_date) : '—'}</span>
                      </div>
                    </td>
                    <td className="data-td text-center">
                      {required
                        ? <span className="inline-block rounded-[6px] px-[6px] py-[3px] bg-[#450A0A] text-[#FCA5A5] text-[10px] font-medium">Req.</span>
                        : <span className="inline-block rounded-[6px] px-[6px] py-[3px] bg-[#1E293B] text-[#64748B] text-[10px] font-medium">Opt.</span>}
                    </td>
                    <td className="data-td text-[11px] text-center text-text-secondary">{fmtDate(doc.created_at)}</td>
                    <td className="data-td text-right">
                      <button type="button" onClick={() => void viewDocument(doc)} className="text-primary text-[11px] font-medium px-[5px] h-[30px]">View</button>
                      {canReview && doc.approval_status !== 'approved' && (
                        <button type="button" disabled={busy} onClick={() => approve(doc)} className="text-[11px] font-medium px-[5px] h-[30px]" style={{ color: '#22C55E' }}>Approve</button>
                      )}
                      {canReview && doc.approval_status !== 'rejected' && (
                        <button type="button" disabled={busy} onClick={() => reject(doc)} className="text-[11px] font-medium px-[5px] h-[30px]" style={{ color: '#FCD34D' }}>Reject</button>
                      )}
                      {canEdit && (
                        <button type="button" disabled={busy} onClick={() => remove(doc)} className="text-error text-[11px] font-medium px-[5px] h-[30px]">Remove</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filteredDocuments.length === 0 && (
            <p className="text-text-secondary text-center py-6 text-[13px]">
              {totalDocuments === 0 ? 'No documents yet.' : 'No documents match this filter.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Alert({ icon, tone, children }: { icon: string; tone: 'muted' | 'error' | 'warning'; children: React.ReactNode }) {
  const box = tone === 'error' ? 'border-error/30 bg-error-dark' : tone === 'warning' ? 'border-warning/30 bg-warning-dark' : 'border-divider bg-surface-elevated'
  const fg = tone === 'error' ? 'text-error' : tone === 'warning' ? 'text-[#92400E]' : 'text-text-secondary'
  return (
    <div className={`rounded-lg border px-3 py-[10px] flex items-center gap-2 ${box}`}>
      <span className={`material-icons text-[16px] ${fg}`}>{icon}</span>
      <p className={`text-[12px] flex-1 ${fg}`}>{children}</p>
    </div>
  )
}
