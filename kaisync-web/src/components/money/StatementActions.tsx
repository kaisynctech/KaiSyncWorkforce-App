'use client'

/** Statement (PDF download) and Remind (email the statement to the client) buttons for the Money accounts tabs. */

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sendStatementReminder, statementPdf, type StatementKind } from '@/lib/money/statements'
import { emptyRecipients, isEmail, RecipientsInput, saveNewContacts, type Recipients } from '@/components/email/RecipientsInput'
import { SenderNote } from '@/components/email/SenderNote'

export function StatementButton({ kind, id, name, companyId }: { kind: StatementKind; id: string; name: string; companyId: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function go() {
    setBusy(true); setErr(null)
    try {
      const { doc, fileName } = await statementPdf(createClient(), { kind, id, name, companyId })
      doc.save(fileName)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not make the statement.')
    }
    setBusy(false)
  }
  return (
    <button type="button" onClick={() => void go()} disabled={busy} title={err ?? undefined}
      className={`inline-flex items-center h-8 px-3 rounded-lg border text-[12px] font-medium disabled:opacity-60 ${err ? 'border-error/40 text-error' : 'border-divider text-text-primary hover:bg-surface-elevated'}`}>
      {busy ? 'Preparing…' : err ? 'Try again' : 'Statement'}
    </button>
  )
}

export function RemindButton({ clientId, clientName, companyId, lastReminded, onSent }: {
  clientId: string; clientName: string; companyId: string; lastReminded?: string | null; onSent?: () => void
}) {
  const [open, setOpen] = useState(false)
  // null until the client's email has loaded, so To/CC fill in from the right starting point.
  const [rcpt, setRcpt] = useState<Recipients | null>(null)
  const [clientEmail, setClientEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [autoOff, setAutoOff] = useState(false)

  async function openDialog() {
    setResult(null); setMessage(''); setRcpt(null); setOpen(true)
    const { data } = await createClient().from('clients').select('email, auto_reminders_off').eq('id', clientId).maybeSingle()
    const e = ((data as { email?: string | null } | null)?.email ?? '').trim()
    setClientEmail(e)
    setRcpt(emptyRecipients(e))
    setAutoOff(Boolean((data as { auto_reminders_off?: boolean } | null)?.auto_reminders_off))
  }

  async function send() {
    if (!rcpt) return
    setBusy(true); setResult(null)
    try {
      const supabase = createClient()
      const r = await sendStatementReminder(supabase, { clientId, clientName, companyId, recipient: rcpt.to.trim(), cc: rcpt.cc, message })
      if (r.ok) {
        const saved = rcpt.saveNew ? await saveNewContacts(supabase, { companyId, clientId, clientEmail, emails: [rcpt.to, ...rcpt.cc] }) : 0
        setResult({ ok: true, text: `Sent to ${r.recipient}${rcpt.cc.length ? ` and ${rcpt.cc.length} in CC` : ''}.${saved ? ` ${saved} new contact${saved === 1 ? '' : 's'} saved.` : ''}` })
        onSent?.()
      }
      else setResult({ ok: false, text: r.message })
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'The email could not be sent.' })
    }
    setBusy(false)
  }

  return (
    <>
      <button type="button" onClick={() => void openDialog()} title={lastReminded ? `Last reminded ${lastReminded}` : undefined}
        className="inline-flex items-center h-8 px-3 rounded-lg bg-primary/10 text-primary text-[12px] font-semibold hover:bg-primary/15">
        Remind
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 whitespace-normal" role="dialog" aria-modal="true" aria-label="Send statement reminder">
          <div className="bg-surface-card rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4 text-left max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[16px] font-semibold text-text-primary">Send a reminder</h3>
                <p className="text-[12.5px] text-text-secondary mt-0.5">{clientName} gets a friendly email with their statement attached.</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="w-8 h-8 rounded-lg text-text-secondary hover:bg-surface-elevated flex items-center justify-center shrink-0">
                <span className="material-icons text-[18px]">close</span>
              </button>
            </div>
            <SenderNote companyId={companyId} mode="personal" />
            {lastReminded && <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Last reminder sent {lastReminded}.</p>}
            {rcpt
              ? <RecipientsInput value={rcpt} onChange={setRcpt} companyId={companyId} clientId={clientId} clientEmail={clientEmail} disabled={busy || !!result?.ok} />
              : <p className="text-[12.5px] text-text-secondary">Loading…</p>}
            <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary">Add a note (optional)
              <textarea rows={3} value={message} onChange={e => setMessage(e.target.value)} placeholder="e.g. Please use your account number as the payment reference."
                className="rounded-xl border border-divider px-3 py-2 text-[14px] bg-background text-text-primary resize-none focus:outline-none focus:border-primary/60" />
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-text-secondary">
              <input type="checkbox" checked={autoOff} onChange={async e => {
                const v = e.target.checked
                setAutoOff(v)
                const { error } = await createClient().from('clients').update({ auto_reminders_off: v }).eq('id', clientId)
                if (error) { setAutoOff(!v); setResult({ ok: false, text: error.message }) }
              }} />
              No automatic reminders for {clientName}
            </label>
            {result && <p className={`text-[13px] ${result.ok ? 'text-emerald-700' : 'text-error'}`}>{result.text}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="h-10 px-4 rounded-xl border border-divider text-[13px] text-text-primary hover:bg-surface-elevated">
                {result?.ok ? 'Close' : 'Cancel'}
              </button>
              {!result?.ok && (
                <button type="button" disabled={busy || !rcpt || !isEmail(rcpt.to)} onClick={() => void send()}
                  className="h-10 px-5 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50 flex items-center gap-2">
                  <span className="material-icons text-[16px]">send</span>{busy ? 'Sending…' : 'Send statement'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
