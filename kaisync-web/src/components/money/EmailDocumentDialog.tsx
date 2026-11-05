'use client'

/**
 * "Email this" dialog for invoices, credit notes, receipts, purchase orders and remittance advice.
 * Same look as the statement Remind dialog: To (prefilled), optional note, company reply-to, history.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { emailedLabel, loadDocumentEmails, sendDocumentEmail, type DocumentEmailKind, type DocumentEmailLog } from '@/lib/money/document-email'

export type EmailPdf = { base64: string; filename: string }

export function EmailDocumentDialog({
  open, onClose, kind, docId, companyId, title, description, defaultTo, getPdf, onSent, attachmentLabel,
}: {
  open: boolean
  onClose: () => void
  kind: DocumentEmailKind
  docId: string
  companyId: string
  title: string
  /** One line saying who gets what, e.g. "Bluewater gets invoice INV0001 with the PDF attached." */
  description: string
  defaultTo: string | null | undefined
  /** Builds the PDF to attach. Leave out for emails without an attachment (receipts, remittance). */
  getPdf?: () => Promise<EmailPdf | null>
  onSent?: (recipient: string) => void
  /** Shown under the note, e.g. "INV0001.pdf". */
  attachmentLabel?: string
}) {
  // The dialog is mounted when it opens, so the address starts from defaultTo.
  const [email, setEmail] = useState((defaultTo ?? '').trim())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [companyEmail, setCompanyEmail] = useState<string | null>(null)
  const [history, setHistory] = useState<DocumentEmailLog[]>([])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const supabase = createClient()
    void (async () => {
      const [{ data: co }, logs] = await Promise.all([
        supabase.from('companies').select('contact_email').eq('id', companyId).maybeSingle(),
        loadDocumentEmails(supabase, docId, [kind]),
      ])
      if (cancelled) return
      setCompanyEmail(((co as { contact_email?: string | null } | null)?.contact_email ?? '').trim())
      setHistory(logs)
    })()
    return () => { cancelled = true }
  }, [open, companyId, docId, kind])

  async function send() {
    setBusy(true); setResult(null)
    try {
      const pdf = getPdf ? await getPdf() : null
      if (getPdf && !pdf) throw new Error('Could not make the PDF.')
      const r = await sendDocumentEmail(createClient(), {
        kind, docId, recipient: email.trim(), message, pdfBase64: pdf?.base64 ?? null, filename: pdf?.filename ?? null,
      })
      if (r.ok) {
        setResult({ ok: true, text: `Sent to ${r.recipient}.` })
        onSent?.(r.recipient)
        setHistory(await loadDocumentEmails(createClient(), docId, [kind]))
      } else setResult({ ok: false, text: r.message })
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'The email could not be sent.' })
    }
    setBusy(false)
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 whitespace-normal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-surface-card rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4 text-left max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-semibold text-text-primary">{title}</h3>
            <p className="text-[12.5px] text-text-secondary mt-0.5">
              {description}
              {companyEmail ? <> Replies go to <span className="font-medium text-text-primary">{companyEmail}</span>.</> : companyEmail === '' ? ' Replies go to your own login email.' : null}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="w-8 h-8 rounded-lg text-text-secondary hover:bg-surface-elevated flex items-center justify-center shrink-0">
            <span className="material-icons text-[18px]">close</span>
          </button>
        </div>
        {companyEmail === '' && (
          <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Your company has no email address yet. Add one in <a href="/dashboard/settings?tab=general" className="font-semibold underline">Settings → General</a> so replies go to the company, not to you.
          </p>
        )}
        <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary">Send to
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="name@company.co.za"
            className="h-10 rounded-xl border border-divider px-3 text-[14px] bg-background text-text-primary focus:outline-none focus:border-primary/60" />
        </label>
        {!email.trim() && !result && (
          <p className="text-[12px] text-amber-800 -mt-2">No email address on file. Type one in — it will only be used for this email.</p>
        )}
        <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary">Add a note (optional)
          <textarea rows={3} value={message} onChange={e => setMessage(e.target.value)}
            className="rounded-xl border border-divider px-3 py-2 text-[14px] bg-background text-text-primary resize-none focus:outline-none focus:border-primary/60" />
        </label>
        {attachmentLabel && (
          <p className="text-[12px] text-text-secondary flex items-center gap-1.5 -mt-1">
            <span className="material-icons text-[16px]">attach_file</span>{attachmentLabel}
          </p>
        )}
        {result && <p className={`text-[13px] ${result.ok ? 'text-emerald-700' : 'text-error'}`}>{result.text}</p>}
        {history.length > 0 && (
          <div className="text-[12px] text-text-secondary border-t border-divider pt-3 flex flex-col gap-1">
            {history.slice(0, 4).map(h => (
              <span key={h.id} className={h.status === 'failed' ? 'text-error' : ''}>{emailedLabel(h)}</span>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-xl border border-divider text-[13px] text-text-primary hover:bg-surface-elevated">
            {result?.ok ? 'Close' : 'Not now'}
          </button>
          {!result?.ok && (
            <button type="button" disabled={busy || !email.trim()} onClick={() => void send()}
              className="h-10 px-5 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50 flex items-center gap-2">
              <span className="material-icons text-[16px]">send</span>{busy ? 'Sending…' : 'Send email'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
