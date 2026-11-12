'use client'

/**
 * "Email this" dialog for invoices, credit notes, receipts, purchase orders, RFQs and remittance advice.
 * To and CC (prefilled from the client's contacts), who it comes from, an optional note, and the history.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { emailedLabel, loadDocumentEmails, previewDocumentEmail, sendDocumentEmail, SEND_MODE, type DocumentEmailKind, type DocumentEmailLog } from '@/lib/money/document-email'
import { emptyRecipients, isEmail, RecipientsInput, saveNewContacts, type Recipients } from '@/components/email/RecipientsInput'
import { SenderNote } from '@/components/email/SenderNote'
import { EmailComposer } from '@/components/email/EmailComposer'
import { draftEdits, type EmailDraft } from '@/lib/email-preview'

export type EmailPdf = { base64: string; filename: string }

export function EmailDocumentDialog({
  open, onClose, kind, docId, companyId, title, description, defaultTo, clientId, getPdf, onSent, attachmentLabel, beforeSend,
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
  /** The client this goes to: its contacts fill in To/CC. Leave out for suppliers and contractors. */
  clientId?: string | null
  /** Builds the PDF to attach. Leave out for emails without an attachment (receipts, remittance). */
  getPdf?: () => Promise<EmailPdf | null>
  onSent?: (recipient: string) => void
  /** Shown under the note, e.g. "INV0001.pdf". */
  attachmentLabel?: string
  /** Runs just before sending (e.g. a draft invoice is marked sent and numbered). Return an error message to stop. */
  beforeSend?: () => Promise<string | null>
}) {
  // The dialog is mounted when it opens, so the address starts from defaultTo.
  const [rcpt, setRcpt] = useState<Recipients>(() => emptyRecipients(defaultTo))
  const [draft, setDraft] = useState<EmailDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [history, setHistory] = useState<DocumentEmailLog[]>([])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const supabase = createClient()
    void loadDocumentEmails(supabase, docId, [kind]).then(logs => { if (!cancelled) setHistory(logs) })
    return () => { cancelled = true }
  }, [open, companyId, docId, kind])

  async function send() {
    setBusy(true); setResult(null)
    try {
      const stop = beforeSend ? await beforeSend() : null
      if (stop) throw new Error(stop)
      const pdf = getPdf ? await getPdf() : null
      if (getPdf && !pdf) throw new Error('Could not make the PDF.')
      const supabase = createClient()
      const r = await sendDocumentEmail(supabase, {
        kind, docId, recipient: rcpt.to.trim(), cc: rcpt.cc, edits: draftEdits(draft), pdfBase64: pdf?.base64 ?? null, filename: pdf?.filename ?? null,
      })
      if (r.ok) {
        const saved = rcpt.saveNew && clientId
          ? await saveNewContacts(supabase, { companyId, clientId, clientEmail: defaultTo, emails: [rcpt.to, ...rcpt.cc] })
          : 0
        setResult({ ok: true, text: `Sent to ${r.recipient}${rcpt.cc.length ? ` and ${rcpt.cc.length} in CC` : ''}.${saved ? ` ${saved} new contact${saved === 1 ? '' : 's'} saved.` : ''}` })
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
      <div className="bg-surface-card rounded-2xl shadow-2xl w-full max-w-xl p-6 flex flex-col gap-4 text-left max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-semibold text-text-primary">{title}</h3>
            <p className="text-[12.5px] text-text-secondary mt-0.5">{description}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="w-8 h-8 rounded-lg text-text-secondary hover:bg-surface-elevated flex items-center justify-center shrink-0">
            <span className="material-icons text-[18px]">close</span>
          </button>
        </div>
        <SenderNote companyId={companyId} mode={SEND_MODE[kind]} />
        <RecipientsInput value={rcpt} onChange={setRcpt} companyId={companyId} clientId={clientId} clientEmail={defaultTo} disabled={busy || !!result?.ok} />
        {!rcpt.to.trim() && !result && (
          <p className="text-[12px] text-amber-800 -mt-1">No email address on file. Type one in.</p>
        )}
        <EmailComposer draft={draft} onDraft={setDraft} disabled={busy || !!result?.ok}
          load={edits => previewDocumentEmail(createClient(), { kind, docId, recipient: rcpt.to.trim(), cc: rcpt.cc, edits })} />
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
            <button type="button" disabled={busy || !isEmail(rcpt.to)} onClick={() => void send()}
              className="h-10 px-5 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50 flex items-center gap-2">
              <span className="material-icons text-[16px]">send</span>{busy ? 'Sending…' : 'Send email'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
