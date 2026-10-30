'use client'

import { useCallback, useEffect, useState } from 'react'
import { listDocumentRequests, signPortalMedia, submitDocumentRequest } from '@/lib/client-portal/api'
import { fmtDate } from '@/lib/client-portal/format'
import type { ClientPortalSession } from '@/lib/client-portal/session'
import { usePortalCanAct } from '@/lib/client-portal/portal-mode'
import type { ClientDocumentRequest } from '@/lib/client-portal/types'

function statusLabel(status: string): string {
  if (status === 'submitted') return 'Sent'
  if (status === 'accepted') return 'Accepted'
  if (status === 'changes_requested') return 'Send again'
  return 'Requested'
}

export function ClientPortalDocuments({ session }: { session: ClientPortalSession }) {
  const canAct = usePortalCanAct()
  const [rows, setRows] = useState<ClientDocumentRequest[]>([])
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<Record<string, File | null>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await listDocumentRequests(session.company_code, session.client_code)
      setRows(next)
      const paths = next.map(row => row.storage_path).filter((path): path is string => Boolean(path))
      setSigned(await signPortalMedia(paths))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load documents.')
    }
    setLoading(false)
  }, [session.client_code, session.company_code])

  useEffect(() => {
    void load()
  }, [load])

  async function send(row: ClientDocumentRequest) {
    const file = files[row.id]
    if (!file) {
      setError('Choose a file to send.')
      return
    }
    setBusyId(row.id)
    setError(null)
    try {
      await submitDocumentRequest({
        companyCode: session.company_code,
        clientCode: session.client_code,
        companyId: session.company_id,
        clientId: session.client_id,
        requestId: row.id,
        file,
      })
      setFiles(prev => ({ ...prev, [row.id]: null }))
      await load()
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send the file.')
    }
    setBusyId(null)
  }

  if (loading) return <div className="py-16 text-center text-text-secondary text-[14px]">Loading…</div>

  return (
    <div className="space-y-3">
      {error && <p className="text-[13px] text-error">{error}</p>}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
          <span className="material-icons text-[48px] text-text-secondary">description</span>
          <p className="text-[15px] font-semibold text-text-primary">No documents requested</p>
          <p className="text-[13px] text-text-secondary max-w-sm">When the office asks for a document, it will show here so you can send it.</p>
        </div>
      ) : rows.map(row => {
        const open = row.status === 'requested' || row.status === 'changes_requested'
        const href = row.storage_path ? signed[row.storage_path] : null
        return (
          <div key={row.id} className="bg-surface border border-divider rounded-xl px-4 py-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[14px] font-semibold text-text-primary">{row.document_name}</p>
                <p className="text-[12px] text-text-secondary">{statusLabel(row.status)} · {fmtDate(row.created_at)}</p>
              </div>
              {href && (
                <a href={href} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-primary hover:underline">
                  Open
                </a>
              )}
            </div>
            {row.request_note && <p className="text-[13px] text-text-primary">{row.request_note}</p>}
            {row.review_note && <p className="text-[13px] text-text-primary">Please send again: {row.review_note}</p>}
            {open && canAct && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  onChange={e => setFiles(prev => ({ ...prev, [row.id]: e.target.files?.[0] ?? null }))}
                  className="text-[12px] text-text-secondary"
                />
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => void send(row)}
                  className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-primary text-white disabled:opacity-50"
                >
                  {busyId === row.id ? 'Sending…' : 'Send'}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
