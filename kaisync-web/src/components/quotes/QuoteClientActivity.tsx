'use client'

/**
 * On a sent quotation: when the client opened it, and their questions with your answers (piece 8). Answers show on
 * the client's quotation page; you can also send the answer by WhatsApp.
 */

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { whatsAppUrl } from '@/lib/whatsapp'

type Msg = { id: string; from_client: boolean; author_name: string | null; body: string; created_at: string; read_at: string | null }
type Seen = { first_viewed_at: string | null; last_viewed_at: string | null; views: number }

const when = (d: string) => new Date(d).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function QuoteClientActivity({ companyId, quoteId, employeeId, employeeName, clientPhone, quoteNumber, readOnly }: {
  companyId: string; quoteId: string; employeeId: string | null; employeeName: string
  clientPhone: string | null; quoteNumber: string | null; readOnly?: boolean
}) {
  const supabase = createClient()
  const [seen, setSeen] = useState<Seen | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const sb = createClient()
    const [{ data: s }, { data: m }] = await Promise.all([
      sb.rpc('document_link_status', { p_doc_id: quoteId }),
      sb.from('document_messages').select('id, from_client, author_name, body, created_at, read_at')
        .eq('doc_id', quoteId).eq('company_id', companyId).order('created_at'),
    ])
    return { seen: (s as Seen | null) ?? null, msgs: (m ?? []) as Msg[] }
  }, [quoteId, companyId])

  useEffect(() => {
    let live = true
    load().then(r => {
      if (!live) return
      setSeen(r.seen); setMsgs(r.msgs)
      const unread = r.msgs.filter(x => x.from_client && !x.read_at).map(x => x.id)
      if (unread.length) void createClient().from('document_messages').update({ read_at: new Date().toISOString() }).in('id', unread)
    }).catch(() => {})
    return () => { live = false }
  }, [load])

  async function send(alsoWhatsApp: boolean) {
    const text = reply.trim()
    if (text.length < 1 || !employeeId) return
    setBusy(true); setError(null)
    // Opened straight away so the phone doesn't block it as a pop-up.
    const w = alsoWhatsApp ? window.open('', '_blank') : null
    const { error: e } = await supabase.from('document_messages').insert({
      company_id: companyId, kind: 'quote', doc_id: quoteId, from_client: false, author_name: employeeName || null,
      author_employee_id: employeeId, body: text,
    })
    setBusy(false)
    if (e) { w?.close(); setError(/row-level security/i.test(e.message) ? 'You don’t have permission to answer on quotations.' : e.message); return }
    if (w) w.location.href = whatsAppUrl(clientPhone, `${text}\n\n(About quotation ${quoteNumber ?? ''}. You can also see this on the quotation link.)`)
    setReply('')
    const r = await load(); setSeen(r.seen); setMsgs(r.msgs)
  }

  const views = Number(seen?.views ?? 0)
  return (
    <div className="rounded-xl border border-divider bg-surface px-4 py-3 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[13px]">
        <span className={`material-icons text-[18px] ${views > 0 ? 'text-purple-600' : 'text-text-secondary'}`}>{views > 0 ? 'visibility' : 'visibility_off'}</span>
        {views > 0
          ? <span className="text-text-primary">Seen {views}× by the client{seen?.last_viewed_at ? ` · last ${when(seen.last_viewed_at)}` : ''}</span>
          : <span className="text-text-secondary">Not opened by the client yet</span>}
      </div>
      {msgs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {msgs.map(m => (
            <li key={m.id} className={`rounded-2xl px-3 py-2 text-[13.5px] max-w-[88%] ${m.from_client ? 'bg-amber-50 border border-amber-200' : 'bg-primary/10 ml-auto'}`}>
              <p className="text-[11px] text-text-secondary">{m.from_client ? `${m.author_name || 'Client'} asked` : (m.author_name || 'You')} · {when(m.created_at)}</p>
              <p className="whitespace-pre-line text-text-primary">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (msgs.some(m => m.from_client) || msgs.length > 0) && (
        <div className="flex flex-col gap-2">
          <textarea rows={2} value={reply} maxLength={2000} onChange={e => setReply(e.target.value)} placeholder="Answer the client (shows on their quotation page)"
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-[14px]" />
          {error && <p className="text-[12px] text-error">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !reply.trim()} onClick={() => void send(false)} className="btn-primary h-10 px-4 text-[13.5px]">{busy ? 'Sending…' : 'Answer'}</button>
            <button type="button" disabled={busy || !reply.trim()} onClick={() => void send(true)} className="btn-outlined h-10 px-4 text-[13.5px]">Answer + WhatsApp</button>
          </div>
        </div>
      )}
    </div>
  )
}
