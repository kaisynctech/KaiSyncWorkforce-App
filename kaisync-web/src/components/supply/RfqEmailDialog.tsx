'use client'

/**
 * Email an RFQ to its suppliers. Each supplier gets its own email (they never see each other), with the
 * items, dates and our RFQ number; replies come to the person sending it. Optional CC goes on every email.
 * A supplier is marked "sent" when its email goes out (send_document_email, kind 'rfq').
 */

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sendDocumentEmail } from '@/lib/money/document-email'
import { emptyRecipients, isEmail, RecipientsInput, type Recipients } from '@/components/email/RecipientsInput'
import { SenderNote } from '@/components/email/SenderNote'

export type RfqEmailTarget = { id: string; supplierName: string; email: string | null; status: string }
type Row = RfqEmailTarget & { to: string; on: boolean; result?: { ok: boolean; text: string } }

export function RfqEmailDialog({ companyId, rfqLabel, targets, onClose, onOpenMailApp }: {
  companyId: string
  rfqLabel: string
  targets: RfqEmailTarget[]
  onClose: (sentAny: boolean) => void
  /** The old way: open the user's own mail app with everyone in BCC. */
  onOpenMailApp: () => void
}) {
  const [rows, setRows] = useState<Row[]>(() => targets.map(t => ({
    ...t, to: (t.email ?? '').trim(),
    // Suppliers who already got it are left unticked; tick to send again.
    on: Boolean(t.email) && (t.status === 'pending' || t.status === 'draft'),
  })))
  const [cc, setCc] = useState<Recipients>(emptyRecipients())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [sentAny, setSentAny] = useState(false)

  const chosen = rows.filter(r => r.on)
  const ready = chosen.length > 0 && chosen.every(r => isEmail(r.to))
  const done = rows.length > 0 && rows.every(r => !r.on || r.result?.ok)

  async function send() {
    setBusy(true)
    const supabase = createClient()
    for (const r of rows) {
      if (!r.on || r.result?.ok) continue
      const res = await sendDocumentEmail(supabase, { kind: 'rfq', docId: r.id, recipient: r.to.trim(), cc: cc.cc, message })
      if (res.ok) setSentAny(true)
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, result: res.ok ? { ok: true, text: 'Sent' } : { ok: false, text: res.message } } : x))
    }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 whitespace-normal" role="dialog" aria-modal="true" aria-label="Email RFQ to suppliers">
      <div className="bg-surface-card rounded-2xl shadow-2xl w-full max-w-lg p-6 flex flex-col gap-4 text-left max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-semibold text-text-primary">Email {rfqLabel}</h3>
            <p className="text-[12.5px] text-text-secondary mt-0.5">Each supplier gets their own email with the items and dates, so they don&apos;t see each other.</p>
          </div>
          <button type="button" aria-label="Close" onClick={() => onClose(sentAny)} className="w-8 h-8 rounded-lg text-text-secondary hover:bg-surface-elevated flex items-center justify-center shrink-0">
            <span className="material-icons text-[18px]">close</span>
          </button>
        </div>
        <SenderNote companyId={companyId} mode="personal" />

        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-medium text-text-secondary">Suppliers</span>
          {rows.map(r => (
            <div key={r.id} className="flex flex-col gap-1 rounded-xl border border-divider p-2.5">
              <label className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
                <input type="checkbox" checked={r.on} disabled={busy || r.result?.ok}
                  onChange={e => setRows(rs => rs.map(x => x.id === r.id ? { ...x, on: e.target.checked } : x))}
                  className="w-4 h-4 accent-[var(--color-primary,#1E3A5F)]" />
                <span className="flex-1 truncate">{r.supplierName}</span>
                {r.status !== 'pending' && !r.result && <span className="text-[11px] font-normal text-text-secondary capitalize">already {r.status.replace(/_/g, ' ')}</span>}
                {r.result && <span className={`text-[11.5px] font-medium ${r.result.ok ? 'text-emerald-700' : 'text-error'}`}>{r.result.ok ? 'Sent' : 'Failed'}</span>}
              </label>
              {r.on && !r.result?.ok && (
                <input value={r.to} disabled={busy} onChange={e => setRows(rs => rs.map(x => x.id === r.id ? { ...x, to: e.target.value.trim() } : x))}
                  type="email" placeholder="Supplier's email"
                  className={`h-9 rounded-lg border px-3 text-[13px] bg-background text-text-primary focus:outline-none focus:border-primary/60 ${r.to && !isEmail(r.to) ? 'border-error/60' : 'border-divider'}`} />
              )}
              {r.on && !r.to && <span className="text-[11.5px] text-amber-800">No email on file for this supplier. Type one in.</span>}
              {r.result && !r.result.ok && <span className="text-[12px] text-error">{r.result.text}</span>}
            </div>
          ))}
        </div>

        <RecipientsInput value={cc} onChange={setCc} companyId={companyId} ccOnly disabled={busy || done} />
        <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary">Add a note (optional)
          <textarea rows={3} value={message} disabled={busy || done} onChange={e => setMessage(e.target.value)}
            className="rounded-xl border border-divider px-3 py-2 text-[14px] bg-background text-text-primary resize-none focus:outline-none focus:border-primary/60" />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={onOpenMailApp} disabled={busy} className="text-[12px] text-text-secondary underline hover:text-text-primary disabled:opacity-50">
            Open in my email app instead
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={() => onClose(sentAny)} className="h-10 px-4 rounded-xl border border-divider text-[13px] text-text-primary hover:bg-surface-elevated">
              {done ? 'Close' : 'Cancel'}
            </button>
            {!done && (
              <button type="button" disabled={busy || !ready} onClick={() => void send()}
                className="h-10 px-5 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50 flex items-center gap-2">
                <span className="material-icons text-[16px]">send</span>
                {busy ? 'Sending…' : `Send to ${chosen.length} supplier${chosen.length === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
