'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ClientPortalShell } from '@/components/ClientPortalShell'
import { useRequireClientPortalSession } from '@/lib/client-portal/use-session'
import {
  addDocumentLink,
  getProject,
  sendMessage,
  uploadDocument,
} from '@/lib/client-portal/api'
import { markDealMessagesRead } from '@/lib/client-portal/session'
import { fmtDate, fmtDateTime, isDateSet, projectStatusLabel } from '@/lib/client-portal/format'
import {
  clientQuotationLines,
  clientQuotationTotal,
  lineTotal,
  moneyZAR,
} from '@/lib/client-portal/quotation'
import type { ClientPortalProject, ProjectDocument } from '@/lib/client-portal/types'

export default function ClientPortalProjectDetailPage() {
  const { session, ready } = useRequireClientPortalSession()
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const dealId = params.id as string
  const openMessages = searchParams.get('messages') === '1'

  const [project, setProject] = useState<ClientPortalProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msgText, setMsgText] = useState('')
  const [sending, setSending] = useState(false)
  const [docBusy, setDocBusy] = useState(false)
  const [linkName, setLinkName] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [showLinkForm, setShowLinkForm] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!session || !dealId) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, dealId])

  useEffect(() => {
    if (!openMessages || !project || loading) return
    messagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [openMessages, project, loading])

  async function load() {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      const deal = await getProject(session.company_code, session.client_code, dealId)
      if (!deal) {
        setError('This project is not available or may be private.')
        setProject(null)
        setLoading(false)
        return
      }
      setProject(deal)
      const lastHr = [...deal.messages]
        .filter(m => m.author === 'hr')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
      if (lastHr) markDealMessagesRead(dealId, lastHr.created_at)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load project.')
    }
    setLoading(false)
  }

  const quoteLines = useMemo(
    () => (project ? clientQuotationLines(project.quotation_lines) : []),
    [project],
  )
  const quoteTotal = useMemo(
    () => (project ? clientQuotationTotal(project.offer_amount, project.quotation_lines) : 0),
    [project],
  )

  async function onSendMessage() {
    if (!session || !project || !msgText.trim()) return
    setSending(true)
    setError(null)
    try {
      await sendMessage(session.company_code, session.client_code, project.id, msgText)
      setMsgText('')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not send message.')
    }
    setSending(false)
  }

  async function onUpload() {
    if (!session || !project) return
    const file = selectedFile ?? fileRef.current?.files?.[0]
    if (!file) {
      setError('Choose a file to upload.')
      return
    }
    const name = (uploadName.trim() || file.name || 'My document').trim()
    setDocBusy(true)
    setError(null)
    try {
      const doc = await uploadDocument({
        companyCode: session.company_code,
        clientCode: session.client_code,
        companyId: project.company_id,
        dealId: project.id,
        file,
        documentName: name,
      })
      setProject(prev => prev ? { ...prev, documents: [doc, ...prev.documents] } : prev)
      setUploadName('')
      setSelectedFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    }
    setDocBusy(false)
  }

  async function onAddLink() {
    if (!session || !project) return
    const name = linkName.trim()
    const url = linkUrl.trim()
    if (!name || !url) {
      setError('Document name and link are required.')
      return
    }
    try {
      // Validate URL
      const u = new URL(url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('invalid')
    } catch {
      setError('Please enter a valid http or https link.')
      return
    }
    setDocBusy(true)
    setError(null)
    try {
      const id = await addDocumentLink(session.company_code, session.client_code, project.id, name, url)
      const doc: ProjectDocument = {
        id,
        document_name: name,
        document_type: 'client_upload',
        file_url: url,
        created_at: new Date().toISOString(),
      }
      setProject(prev => prev ? { ...prev, documents: [doc, ...prev.documents] } : prev)
      setLinkName('')
      setLinkUrl('')
      setShowLinkForm(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save document link.')
    }
    setDocBusy(false)
  }

  if (!ready || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a] text-slate-400 text-[14px]">
        Loading…
      </div>
    )
  }

  return (
    <ClientPortalShell session={session}>
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4 pb-16">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push('/client-portal/home')}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <span className="material-icons">arrow_back</span>
          </button>
          <div className="min-w-0">
            <h1 className="text-white text-[18px] font-bold truncate">
              {project?.title ?? 'Project'}
            </h1>
            {project?.project_code && (
              <p className="text-[12px] text-slate-500">{project.project_code}</p>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <p className="text-[13px] text-red-400 font-semibold">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-slate-400 text-[14px]">Loading…</div>
        ) : !project ? (
          <div className="py-16 text-center space-y-3">
            <p className="text-slate-400 text-[14px]">Project not found.</p>
            <Link href="/client-portal/home" className="text-blue-400 text-[13px] hover:underline">Back to portal</Link>
          </div>
        ) : (
          <>
            <Section title="Overview">
              <InfoRow label="Status" value={projectStatusLabel(project.status)} />
              <InfoRow label="Progress" value={`${project.progress_percent}%`} />
              <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, project.progress_percent))}%` }}
                />
              </div>
              <InfoRow label="Work order" value={project.job_id ? 'Work order linked' : 'Not started on site yet'} />
              <InfoRow label="Last update" value={fmtDateTime(project.last_update_at)} />
              <p className="text-[13px] text-slate-300 mt-2 leading-relaxed">
                {project.last_update_note?.trim() || 'No project updates yet.'}
              </p>
            </Section>

            {(isDateSet(project.site_start_date) || isDateSet(project.expected_completion_date)
              || isDateSet(project.next_visit_date) || isDateSet(project.expected_close_date)) && (
              <Section title="Key dates">
                {isDateSet(project.site_start_date) && <InfoRow label="Site start" value={fmtDate(project.site_start_date)} />}
                {isDateSet(project.expected_completion_date) && <InfoRow label="Expected completion" value={fmtDate(project.expected_completion_date)} />}
                {isDateSet(project.next_visit_date) && <InfoRow label="Next visit" value={fmtDate(project.next_visit_date)} />}
                {isDateSet(project.expected_close_date) && <InfoRow label="Expected close" value={fmtDate(project.expected_close_date)} />}
              </Section>
            )}

            <Section title="Payments">
              <InfoRow label="Agreed offer" value={moneyZAR(project.offer_amount)} />
              <InfoRow label="Deposit required" value={moneyZAR(project.deposit_required)} />
              <InfoRow label="Amount paid" value={moneyZAR(project.amount_paid)} />
              <InfoRow label="Balance" value={moneyZAR(Math.max(0, project.offer_amount - project.amount_paid))} />
              {project.payments.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase">Payment history</p>
                  {project.payments.map(pay => (
                    <div key={pay.id} className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div className="flex justify-between gap-2">
                        <p className="text-[13px] text-white font-semibold">{moneyZAR(pay.amount)}</p>
                        <p className="text-[12px] text-slate-500">{fmtDate(pay.paid_at)}</p>
                      </div>
                      {(pay.reference || pay.payment_method) && (
                        <p className="text-[12px] text-slate-400 mt-0.5">
                          {[pay.payment_method, pay.reference].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {pay.receipt_url && (
                        <a href={pay.receipt_url} target="_blank" rel="noreferrer" className="text-[12px] text-blue-400 hover:underline mt-1 inline-block">
                          View receipt
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Quotation">
              {project.quotation_notes && (
                <p className="text-[13px] text-slate-300 mb-3 leading-relaxed">{project.quotation_notes}</p>
              )}
              {quoteLines.length === 0 && !project.offer_amount && !project.quotation_notes ? (
                <p className="text-[13px] text-slate-500">No quotation shared yet.</p>
              ) : (
                <>
                  {quoteLines.length > 0 && (
                    <div className="space-y-1.5 mb-3">
                      {quoteLines.map(l => (
                        <div key={`${l.line_no}-${l.description}`} className="flex justify-between gap-3 text-[13px]">
                          <p className="text-slate-300">
                            <span className="text-slate-500 mr-1">{l.line_no}.</span>
                            {l.description}
                            <span className="text-slate-500 text-[11px] ml-1">×{l.quantity}</span>
                          </p>
                          <p className="text-slate-200 whitespace-nowrap">{moneyZAR(lineTotal(l))}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                    <p className="text-[12px] font-semibold text-slate-400 uppercase">Total</p>
                    <p className="text-[16px] font-bold text-white">{moneyZAR(quoteTotal)}</p>
                  </div>
                  {isDateSet(project.quotation_valid_until) && (
                    <p className="text-[12px] text-slate-500 mt-2">Valid until {fmtDate(project.quotation_valid_until)}</p>
                  )}
                </>
              )}
            </Section>

            <Section title="Agreement">
              <p className="text-[13px] text-slate-300 leading-relaxed whitespace-pre-wrap">
                {project.agreement_notes?.trim()
                  || project.quotation_notes?.trim()
                  || 'No agreement or contract notes have been shared yet. Your project manager can add these from the HR project screen.'}
              </p>
            </Section>

            <Section title="Documentation">
              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={docBusy}
                  className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  Upload file
                </button>
                <button
                  type="button"
                  onClick={() => setShowLinkForm(v => !v)}
                  className="text-[12px] font-semibold px-3 py-1.5 rounded-lg text-slate-300 border hover:border-blue-400 hover:text-blue-300"
                  style={{ borderColor: 'rgba(255,255,255,0.12)' }}
                >
                  Share link
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={() => {
                  const f = fileRef.current?.files?.[0] ?? null
                  setSelectedFile(f)
                  if (f && !uploadName) setUploadName(f.name)
                }}
              />
              {selectedFile && (
                <div className="flex gap-2 mb-3 items-center">
                  <input
                    className="flex-1 h-10 px-3 rounded-lg text-[13px] text-white"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    placeholder="Document name"
                    value={uploadName}
                    onChange={e => setUploadName(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => void onUpload()}
                    disabled={docBusy}
                    className="text-[12px] font-semibold px-3 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-50"
                  >
                    {docBusy ? '…' : 'Upload'}
                  </button>
                </div>
              )}
              {showLinkForm && (
                <div className="space-y-2 mb-3 p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <input
                    className="w-full h-10 px-3 rounded-lg text-[13px] text-white"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    placeholder="Document name"
                    value={linkName}
                    onChange={e => setLinkName(e.target.value)}
                  />
                  <input
                    className="w-full h-10 px-3 rounded-lg text-[13px] text-white"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    placeholder="https://…"
                    value={linkUrl}
                    onChange={e => setLinkUrl(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => void onAddLink()}
                    disabled={docBusy}
                    className="text-[12px] font-semibold px-3 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-50"
                  >
                    Save link
                  </button>
                </div>
              )}
              {project.documents.length === 0 ? (
                <p className="text-[13px] text-slate-500">No documents yet.</p>
              ) : (
                <div className="space-y-2">
                  {project.documents.map(doc => (
                    <a
                      key={doc.id || doc.file_url}
                      href={doc.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/[0.04]"
                    >
                      <span className="material-icons text-blue-400 text-[18px]">description</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-white truncate">{doc.document_name}</p>
                        <p className="text-[11px] text-slate-500">{fmtDate(doc.created_at)}</p>
                      </div>
                      <span className="material-icons text-slate-500 text-[16px]">open_in_new</span>
                    </a>
                  ))}
                </div>
              )}
            </Section>

            {project.progress_photos.length > 0 && (
              <Section title="Progress photos">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {project.progress_photos.map((photo, i) => (
                    <a
                      key={`${photo.url}-${i}`}
                      href={photo.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg overflow-hidden border"
                      style={{ borderColor: 'rgba(255,255,255,0.08)' }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.url} alt={photo.job_title || photo.phase} className="w-full h-28 object-cover" />
                      <p className="text-[11px] text-slate-400 px-2 py-1 truncate capitalize">
                        {photo.phase}{photo.job_title ? ` · ${photo.job_title}` : ''}
                      </p>
                    </a>
                  ))}
                </div>
              </Section>
            )}

            {project.activity_updates.length > 0 && (
              <Section title="Project updates">
                <div className="space-y-3">
                  {project.activity_updates.map((a, i) => (
                    <div key={`${a.created_at}-${i}`} className="border-l-2 pl-3" style={{ borderColor: 'rgba(59,130,246,0.5)' }}>
                      <p className="text-[13px] text-slate-200 leading-relaxed">{a.body}</p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {fmtDateTime(a.created_at)}
                        {(a.status_from || a.status_to) && (
                          <span> · {[a.status_from, a.status_to].filter(Boolean).join(' → ')}</span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <div ref={messagesRef}>
              <Section title="Ask a question">
                <div className="space-y-3 mb-3 max-h-80 overflow-y-auto">
                  {project.messages.length === 0 ? (
                    <p className="text-[13px] text-slate-500">No messages yet. Send a question to your project team.</p>
                  ) : (
                    project.messages.map(m => (
                      <div
                        key={m.id || `${m.created_at}-${m.body.slice(0, 12)}`}
                        className={`rounded-xl px-3 py-2 max-w-[90%] ${
                          m.author === 'client' ? 'ml-auto bg-blue-600/30' : 'mr-auto'
                        }`}
                        style={m.author === 'hr' ? { background: 'rgba(255,255,255,0.06)' } : undefined}
                      >
                        <p className="text-[11px] font-semibold text-slate-400 mb-0.5">
                          {m.author === 'client' ? 'You' : 'Team'} · {fmtDateTime(m.created_at)}
                        </p>
                        <p className="text-[13px] text-white whitespace-pre-wrap">{m.body}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex gap-2">
                  <textarea
                    className="flex-1 min-h-[44px] max-h-32 px-3 py-2 rounded-xl text-[13px] text-white resize-y"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    placeholder="Type your message…"
                    value={msgText}
                    onChange={e => setMsgText(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => void onSendMessage()}
                    disabled={sending || !msgText.trim()}
                    className="h-11 px-4 rounded-xl bg-blue-600 text-white font-semibold text-[13px] disabled:opacity-50 shrink-0"
                  >
                    {sending ? '…' : 'Send'}
                  </button>
                </div>
              </Section>
            </div>
          </>
        )}
      </div>
    </ClientPortalShell>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-xl overflow-hidden border"
      style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
    >
      <div className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{title}</p>
      </div>
      <div className="px-4 py-3 space-y-1.5">{children}</div>
    </section>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 text-right">{value}</span>
    </div>
  )
}
