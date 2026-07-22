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
    return <div className="py-16 text-center text-slate-400 text-[14px]">Loading compliance…</div>
  }

  const scoreColor = view.required_count === 0
    ? 'text-slate-400'
    : view.score_percent >= 80
      ? 'text-green-400'
      : view.score_percent >= 50
        ? 'text-amber-300'
        : 'text-red-400'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-white text-[18px] font-bold">Compliance</h2>
        <button
          type="button"
          onClick={() => openUpload({ mode: 'additional' })}
          className="h-9 px-3 rounded-lg bg-blue-600 text-white text-[12px] font-semibold"
        >
          + Upload document
        </button>
      </div>

      {/* Score card */}
      <section className="rounded-xl border px-4 py-4 space-y-3" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
        <div className="flex items-center gap-4">
          <div>
            <p className={`text-[32px] font-bold leading-none ${scoreColor}`}>{view.score_percent}%</p>
            <p className="text-[10px] text-slate-500 mt-1">Compliance score</p>
          </div>
          <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, view.score_percent)}%`,
                background: view.score_percent >= 80 ? '#22c55e' : view.score_percent >= 50 ? '#fcd34d' : '#ef4444',
              }}
            />
          </div>
          <span className="text-[12px] font-semibold px-2.5 py-1 rounded-md text-slate-300" style={{ background: 'rgba(255,255,255,0.06)' }}>
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
          <p className="text-[12px] text-slate-500">No compliance pack assigned. Uploaded documents still appear below.</p>
        )}
      </section>

      {view.missing_rows.length > 0 && (
        <Section title="Missing required documents">
          <p className="text-[12px] text-slate-500 mb-2">
            Required by your compliance pack. Upload for HR review.
          </p>
          <div className="space-y-1">
            {view.missing_rows.map(row => (
              <div key={`${row.document_type}-${row.status}`} className="flex items-center gap-2 py-2 border-b last:border-0" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <ReqBadge required={row.is_required} />
                <p className="flex-1 text-[13px] text-white truncate">{row.type_label}</p>
                <button
                  type="button"
                  onClick={() => openUpload({ mode: 'missing', documentType: row.document_type, typeLabel: row.type_label })}
                  className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md bg-blue-600 text-white"
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
              <div key={doc.id} className="flex items-start gap-2 py-2 border-b last:border-0" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-white truncate">{doc.document_name}</p>
                  {doc.rejected_reason && (
                    <p className="text-[11px] text-red-300 mt-0.5">Reason: {doc.rejected_reason}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => openUpload({ mode: 'replace', doc })}
                  className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md text-red-200 shrink-0"
                  style={{ background: 'rgba(127,29,29,0.5)' }}
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
          <p className="text-[13px] text-slate-500">No documents submitted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[640px]">
              <thead>
                <tr className="text-[11px] uppercase text-slate-500 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
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
                  <tr key={doc.id} className="border-b last:border-0" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                    <td className="py-2.5 pr-2 text-slate-300 whitespace-nowrap">{documentTypeLabel(doc.document_type)}</td>
                    <td className="py-2.5 pr-2 text-white">{doc.document_name}</td>
                    <td className="py-2.5 pr-2">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        {statusTableLabel(doc)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-2 text-slate-400 whitespace-nowrap">{uploadedDisplay(doc.created_at)}</td>
                    <td className="py-2.5 pr-2 text-slate-400 whitespace-nowrap">{expiryDisplay(doc)}</td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      {doc.file_url && (
                        <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline mr-2">
                          View
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => openUpload({ mode: 'replace', doc })}
                        className="text-slate-400 hover:text-white"
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
              <div key={row.document_type} className="flex items-center gap-2 py-2 border-b last:border-0" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <ReqBadge required={row.is_required} />
                <p className="flex-1 text-[13px] text-white truncate">{row.type_label}</p>
                {row.expiry_display && (
                  <p className="text-[11px] text-slate-500 whitespace-nowrap">{row.expiry_display}</p>
                )}
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded text-slate-300" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {checklistStatusLabel(row.status)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {uploadTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }}>
          <div className="w-full max-w-md rounded-2xl border p-4 space-y-3" style={{ background: '#0f172a', borderColor: 'rgba(255,255,255,0.12)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-white text-[15px] font-bold">
                {uploadTarget.mode === 'replace' ? 'Replace document' : 'Upload document'}
              </h3>
              <button type="button" onClick={closeUpload} className="text-slate-400 hover:text-white text-[13px]">Cancel</button>
            </div>

            {uploadTarget.mode === 'additional' ? (
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-500 uppercase">Document type</label>
                <select
                  className="w-full h-10 px-3 rounded-lg text-[13px] text-white"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                  value={docType}
                  onChange={e => setDocType(e.target.value)}
                >
                  {CONTRACTOR_DOC_TYPES.map(t => (
                    <option key={t.value} value={t.value} className="bg-slate-900">{t.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-[12px] text-slate-400">
                Type: <span className="text-slate-200">{documentTypeLabel(docType)}</span>
              </p>
            )}

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase">Document name *</label>
              <input
                className="w-full h-10 px-3 rounded-lg text-[13px] text-white"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                value={docName}
                onChange={e => setDocName(e.target.value)}
                placeholder="e.g. SARS TCS Certificate 2026"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase">Expiry date (optional)</label>
              <input
                type="date"
                className="w-full h-10 px-3 rounded-lg text-[13px] text-white"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                value={expiryDate}
                onChange={e => setExpiryDate(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase">File *</label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,application/pdf,image/*"
                className="w-full text-[12px] text-slate-300"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void submitUpload()}
              className="w-full h-11 rounded-xl bg-blue-600 text-white font-semibold text-[13px] disabled:opacity-50"
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
    <section className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
      <div className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{title}</p>
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'green' | 'red' | 'amber' | 'slate' }) {
  const colors = {
    green: 'text-green-400',
    red: 'text-red-300',
    amber: 'text-amber-300',
    slate: 'text-slate-400',
  }
  return (
    <div className="rounded-lg px-1 py-2 text-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
      <p className={`text-[16px] font-bold ${colors[tone]}`}>{value}</p>
      <p className="text-[9px] text-slate-500 uppercase">{label}</p>
    </div>
  )
}

function ReqBadge({ required }: { required: boolean }) {
  return (
    <span
      className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${required ? 'text-red-300' : 'text-slate-500'}`}
      style={{ background: required ? 'rgba(127,29,29,0.5)' : 'rgba(255,255,255,0.06)' }}
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
        <div key={doc.id} className="flex items-center gap-2 py-2 border-b last:border-0" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-white truncate">{doc.document_name}</p>
            <p className="text-[11px] text-slate-500">{documentTypeLabel(doc.document_type)}</p>
          </div>
          <p className={`text-[12px] font-medium whitespace-nowrap ${actionTone === 'amber' ? 'text-amber-300' : 'text-red-300'}`}>
            {expiryDisplay(doc)}
          </p>
          <button
            type="button"
            onClick={() => onAction(doc)}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md text-amber-200"
            style={{ background: 'rgba(120,53,15,0.55)' }}
          >
            {actionLabel}
          </button>
        </div>
      ))}
    </div>
  )
}
