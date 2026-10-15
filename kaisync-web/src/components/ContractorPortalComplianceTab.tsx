'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getCompliancePack,
  getDocuments,
  uploadComplianceDocument,
} from '@/lib/contractor-portal/api'
import {
  buildComplianceView,
  checklistStatusLabel,
  documentTypeLabel,
  expiryDisplay,
  statusTableLabel,
  uploadedDisplay,
} from '@/lib/contractor-portal/compliance'
import type { ContractorPortalSession } from '@/lib/contractor-portal/session'
import {
  CONTRACTOR_DOC_TYPES,
  type ContractorDocument,
  type PackChecklistRow,
} from '@/lib/contractor-portal/types'

type UploadTarget =
  | { mode: 'missing'; documentType: string; typeLabel: string }
  | { mode: 'replace'; doc: ContractorDocument }
  | { mode: 'additional' }

export function ContractorPortalComplianceTab({
  session,
  onError,
}: {
  session: ContractorPortalSession
  onError: (msg: string | null) => void
}) {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [docs, setDocs] = useState<ContractorDocument[]>([])
  const [packItems, setPackItems] = useState<{ document_type: string; requirement: string; sort_order: number }[]>([])
  const [uploadTarget, setUploadTarget] = useState<UploadTarget | null>(null)
  const [docName, setDocName] = useState('')
  const [docType, setDocType] = useState('other')
  const [expiryDate, setExpiryDate] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.contractor_id, session.company_id])

  async function load() {
    setLoading(true)
    onError(null)
    try {
      const [d, p] = await Promise.all([
        getDocuments(session.contractor_id, session.company_id),
        getCompliancePack(session.contractor_id, session.company_id).catch(() => []),
      ])
      setDocs(d)
      setPackItems(p)
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Could not load compliance.')
    }
    setLoading(false)
  }

  const view = useMemo(() => buildComplianceView(docs, packItems), [docs, packItems])

  function openUpload(target: UploadTarget) {
    setUploadTarget(target)
    setDocName('')
    setExpiryDate('')
    setFile(null)
    if (target.mode === 'missing') {
      setDocType(target.documentType)
      setDocName(target.typeLabel)
    } else if (target.mode === 'replace') {
      setDocType(target.doc.document_type)
      setDocName(target.doc.document_name || documentTypeLabel(target.doc.document_type))
    } else {
      setDocType('other')
      setDocName('')
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  function closeUpload() {
    setUploadTarget(null)
    setFile(null)
    setDocName('')
    setExpiryDate('')
  }

  async function submitUpload() {
    if (!uploadTarget) return
    if (!file) {
      onError('Choose a file to upload.')
      return
    }
    if (!docName.trim()) {
      onError('Document name is required.')
      return
    }

    const documentType = uploadTarget.mode === 'additional'
      ? docType
      : uploadTarget.mode === 'missing'
        ? uploadTarget.documentType
        : uploadTarget.doc.document_type

    const oldDocumentId = uploadTarget.mode === 'replace' ? uploadTarget.doc.id : null

    setBusy(true)
    onError(null)
    try {
      await uploadComplianceDocument({
        contractorId: session.contractor_id,
        companyId: session.company_id,
        file,
        documentType,
        documentName: docName.trim(),
        expiryDate: expiryDate.trim() || null,
        oldDocumentId,
      })
      closeUpload()
      await load()
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Upload failed.')
    }
    setBusy(false)
  }

  if (loading) {
    return <div className="py-16 text-center text-text-secondary text-[14px]">Loading compliance…</div>
  }

  const scoreColor = view.required_count === 0
    ? 'text-text-secondary'
    : view.score_percent >= 80
      ? 'text-success'
      : view.score_percent >= 50
        ? 'text-warning'
        : 'text-error'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-text-primary text-[18px] font-bold">Compliance</h2>
        <button
          type="button"
          onClick={() => openUpload({ mode: 'additional' })}
          className="h-9 px-3 rounded-lg bg-primary text-white text-[12px] font-semibold"
        >
          + Upload document
        </button>
      </div>

      {/* Score card */}
      <section className="border-divider bg-surface rounded-xl border px-4 py-4 space-y-3">
        <div className="flex items-center gap-4">
          <div>
            <p className={`text-[32px] font-bold leading-none ${scoreColor}`}>{view.score_percent}%</p>
            <p className="text-[10px] text-text-secondary mt-1">Compliance score</p>
          </div>
          <div className="bg-surface-elevated flex-1 h-2.5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, view.score_percent)}%`,
                background: view.score_percent >= 80 ? '#22c55e' : view.score_percent >= 50 ? '#fcd34d' : '#ef4444',
              }}
            />
          </div>
          <span className="bg-surface-elevated text-[12px] font-semibold px-2.5 py-1 rounded-md text-text-primary">
            {view.status_label}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          <Stat label="Approved" value={view.approved_count} tone="green" />
          <Stat label="Missing" value={view.missing_count} tone="red" />
          <Stat label="Expiring" value={view.expiring_count} tone="amber" />
          <Stat label="Rejected" value={view.rejected_count} tone="red" />
          <Stat label="Required" value={view.required_count} tone="slate" />
        </div>
        {!view.has_pack && (
          <p className="text-[12px] text-text-secondary">No compliance pack assigned. Uploaded documents still appear below.</p>
        )}
      </section>

      {view.missing_rows.length > 0 && (
        <Section title="Missing required documents">
          <p className="text-[12px] text-text-secondary mb-2">
            Required by your compliance pack. Upload for HR review.
          </p>
          <div className="space-y-1">
            {view.missing_rows.map(row => (
              <div key={`${row.document_type}-${row.status}`} className="border-divider flex items-center gap-2 py-2 border-b last:border-0">
                <ReqBadge required={row.is_required} />
                <p className="flex-1 text-[13px] text-text-primary truncate">{row.type_label}</p>
                <button
                  type="button"
                  onClick={() => openUpload({ mode: 'missing', documentType: row.document_type, typeLabel: row.type_label })}
                  className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md bg-primary text-white"
                >
                  Upload
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {view.expiring_docs.length > 0 && (
        <Section title="Expiring within 30 days">
          <DocActionList
            docs={view.expiring_docs}
            actionLabel="Replace"
            actionTone="amber"
            onAction={doc => openUpload({ mode: 'replace', doc })}
          />
        </Section>
      )}

      {view.rejected_docs.length > 0 && (
        <Section title="Rejected documents">
          <div className="space-y-2">
            {view.rejected_docs.map(doc => (
              <div key={doc.id} className="border-divider flex items-start gap-2 py-2 border-b last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-text-primary truncate">{doc.document_name}</p>
                  {doc.rejected_reason && (
                    <p className="text-[11px] text-error mt-0.5">Reason: {doc.rejected_reason}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => openUpload({ mode: 'replace', doc })}
                  className="bg-error-dark text-[11px] font-semibold px-2.5 py-1.5 rounded-md text-red-200 shrink-0"
                 
                >
                  Re-upload
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Submitted documents">
        {docs.length === 0 ? (
          <p className="text-[13px] text-text-secondary">No documents submitted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[640px]">
              <thead>
                <tr className="border-divider text-[11px] uppercase text-text-secondary border-b">
                  <th className="text-left py-2 pr-2 font-semibold">Type</th>
                  <th className="text-left py-2 pr-2 font-semibold">Document</th>
                  <th className="text-left py-2 pr-2 font-semibold">Status</th>
                  <th className="text-left py-2 pr-2 font-semibold">Uploaded</th>
                  <th className="text-left py-2 pr-2 font-semibold">Expires</th>
                  <th className="text-right py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {docs.map(doc => (
                  <tr key={doc.id} className="border-divider border-b last:border-0">
                    <td className="py-2.5 pr-2 text-text-primary whitespace-nowrap">{documentTypeLabel(doc.document_type)}</td>
                    <td className="py-2.5 pr-2 text-text-primary">{doc.document_name}</td>
                    <td className="py-2.5 pr-2">
                      <span className="bg-surface-elevated text-[11px] font-semibold px-2 py-0.5 rounded">
                        {statusTableLabel(doc)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-2 text-text-secondary whitespace-nowrap">{uploadedDisplay(doc.created_at)}</td>
                    <td className="py-2.5 pr-2 text-text-secondary whitespace-nowrap">{expiryDisplay(doc)}</td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      {doc.file_url && (
                        <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-primary hover:underline mr-2">
                          View
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => openUpload({ mode: 'replace', doc })}
                        className="text-text-secondary hover:text-text-primary"
                      >
                        Replace
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {view.checklist.length > 0 && (
        <Section title="Compliance progress">
          <div className="space-y-1">
            {view.checklist.map((row: PackChecklistRow) => (
              <div key={row.document_type} className="border-divider flex items-center gap-2 py-2 border-b last:border-0">
                <ReqBadge required={row.is_required} />
                <p className="flex-1 text-[13px] text-text-primary truncate">{row.type_label}</p>
                {row.expiry_display && (
                  <p className="text-[11px] text-text-secondary whitespace-nowrap">{row.expiry_display}</p>
                )}
                <span className="bg-surface-elevated text-[11px] font-semibold px-2 py-0.5 rounded text-text-primary">
                  {checklistStatusLabel(row.status)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {uploadTarget && (
        <div className="bg-black/60 fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface border-divider w-full max-w-md rounded-2xl border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-text-primary text-[15px] font-bold">
                {uploadTarget.mode === 'replace' ? 'Replace document' : 'Upload document'}
              </h3>
              <button type="button" onClick={closeUpload} className="text-text-secondary hover:text-text-primary text-[13px]">Cancel</button>
            </div>

            {uploadTarget.mode === 'additional' ? (
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-text-secondary uppercase">Document type</label>
                <select
                  className="bg-surface border border-divider text-text-primary w-full h-10 px-3 rounded-lg text-[13px] text-text-primary"
                 
                  value={docType}
                  onChange={e => setDocType(e.target.value)}
                >
                  {CONTRACTOR_DOC_TYPES.map(t => (
                    <option key={t.value} value={t.value} className="bg-surface">{t.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-[12px] text-text-secondary">
                Type: <span className="text-text-primary">{documentTypeLabel(docType)}</span>
              </p>
            )}

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-text-secondary uppercase">Document name *</label>
              <input
                className="bg-surface border border-divider text-text-primary w-full h-10 px-3 rounded-lg text-[13px] text-text-primary"
               
                value={docName}
                onChange={e => setDocName(e.target.value)}
                placeholder="e.g. SARS TCS Certificate 2026"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-text-secondary uppercase">Expiry date (optional)</label>
              <input
                type="date"
                className="bg-surface border border-divider text-text-primary w-full h-10 px-3 rounded-lg text-[13px] text-text-primary"
               
                value={expiryDate}
                onChange={e => setExpiryDate(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-text-secondary uppercase">File *</label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,application/pdf,image/*"
                className="w-full text-[12px] text-text-primary"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void submitUpload()}
              className="w-full h-11 rounded-xl bg-primary text-white font-semibold text-[13px] disabled:opacity-50"
            >
              {busy ? 'Uploading…' : 'Upload for HR review'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-divider bg-surface rounded-xl border overflow-hidden">
      <div className="border-divider px-4 py-2.5 border-b">
        <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">{title}</p>
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'green' | 'red' | 'amber' | 'slate' }) {
  const colors = {
    green: 'text-success',
    red: 'text-error',
    amber: 'text-warning',
    slate: 'text-text-secondary',
  }
  return (
    <div className="bg-surface-elevated rounded-lg px-1 py-2 text-center">
      <p className={`text-[16px] font-bold ${colors[tone]}`}>{value}</p>
      <p className="text-[9px] text-text-secondary uppercase">{label}</p>
    </div>
  )
}

function ReqBadge({ required }: { required: boolean }) {
  return (
    <span
      className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${required ? 'text-error bg-error-dark' : 'text-text-secondary bg-surface-elevated'}`}
    >
      {required ? 'Req.' : 'Opt.'}
    </span>
  )
}

function DocActionList({
  docs,
  actionLabel,
  actionTone,
  onAction,
}: {
  docs: ContractorDocument[]
  actionLabel: string
  actionTone: 'amber' | 'red'
  onAction: (doc: ContractorDocument) => void
}) {
  return (
    <div className="space-y-1">
      {docs.map(doc => (
        <div key={doc.id} className="border-divider flex items-center gap-2 py-2 border-b last:border-0">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-text-primary truncate">{doc.document_name}</p>
            <p className="text-[11px] text-text-secondary">{documentTypeLabel(doc.document_type)}</p>
          </div>
          <p className={`text-[12px] font-medium whitespace-nowrap ${actionTone === 'amber' ? 'text-warning' : 'text-error'}`}>
            {expiryDisplay(doc)}
          </p>
          <button
            type="button"
            onClick={() => onAction(doc)}
            className="bg-warning-dark text-[11px] font-semibold px-2.5 py-1.5 rounded-md text-warning"
           
          >
            {actionLabel}
          </button>
        </div>
      ))}
    </div>
  )
}
