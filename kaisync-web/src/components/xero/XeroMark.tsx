'use client'

/**
 * The little Xero mark next to a document number or name in the lists.
 *   ✓ green  in Xero          ⏳ grey  on its way          ⚠ red  Xero refused it          – grey  not sent (with why)
 *   (faint upload icon)  not sent yet: click to send it now.
 * Clicking the mark opens a small box with the reason, "Try again" / "Send to Xero", and "Open in Xero".
 * Nothing shows for companies that don't use Xero.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type XeroKind = 'invoice' | 'credit_note' | 'po' | 'supplier_invoice' | 'client' | 'supplier'
export type XeroState = { s: 'synced' | 'waiting' | 'error' | 'skipped'; err?: string; job?: string; xid?: string; xst?: string; at?: string }
type StatusMap = Record<string, XeroState>

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
const rpc = () => { const s = createClient(); return s.rpc.bind(s) as unknown as Rpc }

/** The queue entity "Send to Xero" uses for each kind of record. */
const SEND_ENTITY: Record<XeroKind, string> = {
  invoice: 'invoice', credit_note: 'credit_note', po: 'po_bill', supplier_invoice: 'supplier_bill', client: 'client', supplier: 'supplier',
}

/** Where "Open in Xero" goes (Xero opens it in the organisation that is currently selected there). */
export function xeroUrl(kind: XeroKind, xid: string): string {
  switch (kind) {
    case 'invoice': return `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${xid}`
    case 'credit_note': return `https://go.xero.com/AccountsReceivable/ViewCreditNote.aspx?creditNoteID=${xid}`
    case 'po':
    case 'supplier_invoice': return `https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=${xid}`
    default: return `https://go.xero.com/Contacts/View/${xid}`
  }
}

/** Statuses for the rows on screen, refreshed every 20 seconds while something is on its way. */
export function useXeroStatuses(companyId: string | null | undefined, kind: XeroKind, ids: string[]) {
  const [map, setMap] = useState<StatusMap | null>(null)   // null = company has no Xero
  const key = ids.join(',')
  const load = useCallback(async () => {
    if (!companyId || !ids.length) return
    const { data, error } = await rpc()('xero_doc_statuses', { p_company_id: companyId, p_kind: kind, p_ids: ids })
    if (!error) setMap((data as StatusMap | null) ?? null)
  }, [companyId, kind, key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(t)
  }, [load])
  const waiting = map ? Object.values(map).some(v => v.s === 'waiting') : false
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => { void load() }, 20000)
    return () => clearInterval(t)
  }, [waiting, load])
  return { statuses: map, connected: map !== null, reload: load }
}

const LOOK: Record<XeroState['s'] | 'none', { icon: string; cls: string; label: string }> = {
  synced: { icon: 'check_circle', cls: 'text-emerald-600', label: 'In Xero' },
  waiting: { icon: 'schedule', cls: 'text-text-secondary', label: 'On its way to Xero' },
  error: { icon: 'error', cls: 'text-error', label: 'Not in Xero: needs attention' },
  skipped: { icon: 'remove_circle_outline', cls: 'text-text-disabled', label: 'Not sent to Xero' },
  none: { icon: 'cloud_upload', cls: 'text-text-disabled opacity-50 hover:opacity-100', label: 'Not in Xero yet' },
}

export function XeroMark({ companyId, kind, id, state, connected, canSend = true, onChanged }: {
  companyId: string | null | undefined
  kind: XeroKind
  id: string
  state: XeroState | undefined
  connected: boolean
  canSend?: boolean
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (!connected || !companyId) return null
  const s = state?.s ?? 'none'
  const look = LOOK[s]

  async function send() {
    setBusy(true); setMsg(null)
    const { error } = state?.s === 'error' && state.job
      ? await rpc()('xero_retry', { p_company_id: companyId, p_job_id: state.job })
      : await rpc()('xero_send_now', { p_company_id: companyId, p_entity: SEND_ENTITY[kind], p_record_id: id })
    setBusy(false)
    if (error) {
      setMsg(error.message.includes('NOT_ALLOWED') ? 'Only the owner, HR, finance and admins can send to Xero.'
        : error.message.includes('XERO_NOT_CONNECTED') ? 'Xero is not connected. See Settings → Integrations.' : error.message)
      return
    }
    setMsg('Sending… this updates within a minute.')
    onChanged()
  }

  const when = state?.at ? new Date(state.at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null

  return (
    <span ref={box} className="relative inline-flex align-middle" onClick={e => e.stopPropagation()}>
      <button type="button" title={look.label} aria-label={look.label} onClick={e => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o) }}
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${look.cls}`}>
        <span className="material-icons text-[16px] leading-none">{look.icon}</span>
      </button>
      {open && (
        <span role="dialog" className="absolute z-30 left-0 top-6 w-[260px] rounded-xl border border-divider bg-surface-card shadow-xl p-3 flex flex-col gap-2 text-left whitespace-normal cursor-default">
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-text-primary">
            <span className={`material-icons text-[16px] ${look.cls}`}>{look.icon}</span>{look.label}
          </span>
          {s === 'synced' && <span className="text-[12px] text-text-secondary">{state?.xst ? `Status in Xero: ${state.xst.toLowerCase()}.` : 'Linked to Xero.'}{when ? ` Last sent ${when}.` : ''}</span>}
          {s === 'waiting' && <span className="text-[12px] text-text-secondary">Queued. Xero is updated within a minute.</span>}
          {(s === 'error' || s === 'skipped') && state?.err && <span className={`text-[12px] break-words ${s === 'error' ? 'text-error' : 'text-text-secondary'}`}>{state.err}</span>}
          {s === 'none' && <span className="text-[12px] text-text-secondary">This hasn&apos;t been sent to Xero.</span>}
          <span className="flex flex-wrap items-center gap-2 pt-0.5">
            {canSend && s !== 'waiting' && (
              <button type="button" disabled={busy} onClick={() => void send()}
                className="h-8 px-3 rounded-lg bg-primary text-white text-[12px] font-semibold hover:bg-primary-dark disabled:opacity-50">
                {busy ? 'Sending…' : s === 'error' ? 'Try again' : s === 'synced' ? 'Send again' : 'Send to Xero'}
              </button>
            )}
            {state?.xid && (
              <a href={xeroUrl(kind, state.xid)} target="_blank" rel="noopener noreferrer" className="text-[12px] text-primary hover:underline">Open in Xero</a>
            )}
          </span>
          {msg && <span className="text-[11.5px] text-text-secondary">{msg}</span>}
        </span>
      )}
    </span>
  )
}
