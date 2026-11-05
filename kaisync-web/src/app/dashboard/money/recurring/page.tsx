'use client'

/**
 * Recurring invoices: set an invoice up once (client, lines, how often) and it is created — and emailed
 * with the client's View & pay link — by itself on the day it is due. Or keep each one as a draft to check.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { LineItemsEditor } from '@/components/money/LineItemsEditor'
import {
  formatRand, linesSubtotal, loadPickItems, lineQty, meaningfulLines,
  type EditorLine, type PickItem,
} from '@/lib/line-items'
import { localISODate } from '@/lib/utils'

type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'
type Recurring = {
  id: string; client_id: string; title: string; frequency: Frequency; next_run: string; end_date: string | null
  vat_rate: number; auto_send: boolean; active: boolean; notes: string | null; payment_terms_days: number | null
  runs: number; last_run_at: string | null; last_invoice_id: string | null; last_error: string | null
  lines: { description: string; quantity: number; unit_price: number; item_type: string; source_id: string | null; unit: string | null }[]
  clients?: { name: string } | null
}
type ClientOpt = { id: string; name: string; email: string | null }

const FREQ_LABEL: Record<Frequency, string> = { weekly: 'Every week', monthly: 'Every month', quarterly: 'Every 3 months', yearly: 'Every year' }
const day = (d: string | null | undefined) => d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function RecurringInvoicesPage() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [rows, setRows] = useState<Recurring[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)
    const { data } = await supabase.from('recurring_invoices').select('*, clients(name)').eq('company_id', member.companyId)
      .order('active', { ascending: false }).order('next_run')
    setRows((data ?? []) as Recurring[])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  async function runNow(r: Recurring) {
    if (!window.confirm(`Create this period's invoice for ${r.clients?.name ?? 'the client'} now?`)) return
    setBusyId(r.id); setMsg(null)
    const { data, error } = await createClient().rpc('recurring_run_now', { p_id: r.id })
    setBusyId(null)
    if (error) { setMsg({ ok: false, text: error.message }); return }
    // Sent ones open with the email window ready; drafts open for checking.
    router.push(`/dashboard/money/invoices/${data as string}${r.auto_send ? '?email=1' : ''}`)
  }

  async function setActive(r: Recurring, active: boolean) {
    setBusyId(r.id); setMsg(null)
    const { error } = await createClient().from('recurring_invoices').update({ active, updated_at: new Date().toISOString() }).eq('id', r.id)
    setBusyId(null)
    if (error) setMsg({ ok: false, text: error.message })
    else await load()
  }

  if (editing && companyId) {
    return <RecurringEditor companyId={companyId} row={editing === 'new' ? null : editing}
      onDone={async saved => { setEditing(null); if (saved) { setMsg({ ok: true, text: 'Saved.' }); await load() } }} />
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Money</p>
            <h1 className="text-[22px] font-semibold text-text-primary">Recurring invoices</h1>
            <p className="text-[13px] text-text-secondary mt-0.5">Monthly service contracts, retainers and rentals: set once, invoiced and emailed by themselves.</p>
          </div>
          <button type="button" onClick={() => setEditing('new')} className="h-10 px-4 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark flex items-center gap-1.5">
            <span className="material-icons text-[18px]">add</span>New recurring invoice
          </button>
        </div>
        {msg && <p className={`text-[13px] ${msg.ok ? 'text-emerald-700' : 'text-error'}`}>{msg.text}</p>}
        {loading ? <p className="text-[13px] text-text-secondary">Loading…</p> : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-divider p-10 text-center">
            <span className="material-icons text-[40px] text-text-disabled">event_repeat</span>
            <p className="mt-2 text-[14px] font-medium text-text-primary">No recurring invoices yet</p>
            <p className="text-[12.5px] text-text-secondary">Create one for a client you bill the same amount every month.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-divider bg-surface-card overflow-x-auto">
            <table className="w-full text-[13px]" style={{ minWidth: 820 }}>
              <thead className="bg-surface-elevated text-[11.5px] uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Client</th>
                  <th className="px-4 py-2.5 text-left font-semibold">How often</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Next invoice</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Sending</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const sub = r.lines.reduce((s, l) => s + Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100, 0)
                  const total = sub + Math.round(sub * Number(r.vat_rate) * 100) / 100
                  return (
                    <tr key={r.id} className={`border-t border-divider/70 ${r.active ? '' : 'opacity-60'}`}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-text-primary">{r.clients?.name ?? '—'}</span>
                        <span className="block text-[11.5px] text-text-secondary">{r.title}{r.runs > 0 ? ` · ${r.runs} sent so far` : ''}</span>
                        {r.last_error && <span className="block text-[11.5px] text-error">Last try failed: {r.last_error}</span>}
                      </td>
                      <td className="px-4 py-3">{FREQ_LABEL[r.frequency]}{r.end_date ? <span className="block text-[11.5px] text-text-secondary">until {day(r.end_date)}</span> : null}</td>
                      <td className="px-4 py-3">{r.active ? day(r.next_run) : <span className="text-text-secondary">Stopped</span>}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatRand(total)}</td>
                      <td className="px-4 py-3 text-[12px]">{r.auto_send ? 'Emailed automatically' : 'Draft for you to check'}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5 whitespace-nowrap">
                          {r.last_invoice_id && <Link href={`/dashboard/money/invoices/${r.last_invoice_id}`} className="h-8 px-2.5 rounded-lg text-[12px] text-primary hover:bg-primary/10 inline-flex items-center">Last invoice</Link>}
                          {r.active && <button type="button" disabled={busyId === r.id} onClick={() => void runNow(r)} className="h-8 px-2.5 rounded-lg border border-divider text-[12px] hover:bg-surface-elevated disabled:opacity-50">Create now</button>}
                          <button type="button" onClick={() => setEditing(r)} className="h-8 px-2.5 rounded-lg border border-divider text-[12px] hover:bg-surface-elevated">Edit</button>
                          <button type="button" disabled={busyId === r.id} onClick={() => void setActive(r, !r.active)} className="h-8 px-2.5 rounded-lg border border-divider text-[12px] hover:bg-surface-elevated disabled:opacity-50">{r.active ? 'Stop' : 'Restart'}</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function RecurringEditor({ companyId, row, onDone }: { companyId: string; row: Recurring | null; onDone: (saved: boolean) => void }) {
  const [clients, setClients] = useState<ClientOpt[]>([])
  const [vatRegistered, setVatRegistered] = useState(false)
  const [clientId, setClientId] = useState(row?.client_id ?? '')
  const [title, setTitle] = useState(row?.title ?? '')
  const [frequency, setFrequency] = useState<Frequency>(row?.frequency ?? 'monthly')
  const [nextRun, setNextRun] = useState(row?.next_run ?? localISODate())
  const [endDate, setEndDate] = useState(row?.end_date ?? '')
  const [vatOn, setVatOn] = useState(row ? Number(row.vat_rate) > 0 : true)
  const [autoSend, setAutoSend] = useState(row?.auto_send ?? true)
  const [notes, setNotes] = useState(row?.notes ?? '')
  const [lines, setLines] = useState<EditorLine[]>(() => row?.lines.length
    ? row.lines.map((l, i) => ({ key: `r${i}`, type: (['service', 'catalogue', 'inventory'].includes(l.item_type) ? l.item_type : 'custom') as EditorLine['type'],
        sourceId: l.source_id, description: l.description, qty: Number(l.quantity), unitPrice: Number(l.unit_price), unit: l.unit ?? '' }))
    : [])
  const [items, setItems] = useState<PickItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    void Promise.all([
      supabase.from('clients').select('id, name, email').eq('company_id', companyId).order('name'),
      supabase.from('companies').select('is_vat_registered').eq('id', companyId).maybeSingle(),
    ]).then(([{ data: cs }, { data: co }]) => {
      setClients((cs ?? []) as ClientOpt[])
      const reg = Boolean((co as { is_vat_registered?: boolean } | null)?.is_vat_registered)
      setVatRegistered(reg)
      if (!reg) setVatOn(false)
    })
  }, [companyId])

  useEffect(() => {
    let off = false
    void loadPickItems(createClient(), companyId, clientId || null).then(p => { if (!off) { setItems(p); setItemsLoading(false) } })
    return () => { off = true }
  }, [companyId, clientId])

  const rate = vatRegistered && vatOn ? 0.15 : 0
  const sub = linesSubtotal(meaningfulLines(lines))
  const total = sub + Math.round(sub * rate * 100) / 100
  const client = clients.find(c => c.id === clientId)

  async function save() {
    setErr(null)
    const ls = meaningfulLines(lines)
    if (!clientId) { setErr('Choose the client.'); return }
    if (ls.length === 0) { setErr('Add at least one line.'); return }
    if (ls.some(l => !l.description.trim())) { setErr('Every line needs a description.'); return }
    if (!nextRun) { setErr('Choose the date of the first invoice.'); return }
    if (endDate && endDate < nextRun) { setErr('The end date must be after the first invoice.'); return }
    setBusy(true)
    const payload = {
      company_id: companyId, client_id: clientId, title: title.trim() || ls[0].description.trim().slice(0, 80),
      frequency, next_run: nextRun, end_date: endDate || null, vat_rate: rate, auto_send: autoSend, notes: notes.trim() || null,
      lines: ls.map(l => ({ description: l.description.trim(), quantity: lineQty(l), unit_price: Number(l.unitPrice) || 0,
        item_type: l.type, source_id: l.sourceId, unit: l.unit || null })),
      updated_at: new Date().toISOString(),
    }
    const supabase = createClient()
    const { error } = row
      ? await supabase.from('recurring_invoices').update(payload).eq('id', row.id)
      : await supabase.from('recurring_invoices').insert({ ...payload, active: true })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onDone(true)
  }

  const field = 'h-10 rounded-xl border border-divider px-3 text-[14px] bg-background text-text-primary w-full'
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-4">
        <button type="button" onClick={() => onDone(false)} className="self-start text-[13px] text-primary hover:underline flex items-center gap-1">
          <span className="material-icons text-[16px]">arrow_back</span>Recurring invoices
        </button>
        <h1 className="text-[20px] font-semibold text-text-primary">{row ? 'Edit recurring invoice' : 'New recurring invoice'}</h1>

        <div className="bg-surface-card border border-divider rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary sm:col-span-2">Client
            <select value={clientId} onChange={e => setClientId(e.target.value)} className={field}>
              <option value="">Choose a client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {client && !client.email && autoSend && <span className="text-[12px] text-amber-700">This client has no email address, so the invoice will be created but not emailed. Add one on the client.</span>}
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary sm:col-span-2">What it&apos;s for (shown in the email)
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Monthly maintenance contract" className={field} />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary">How often
            <select value={frequency} onChange={e => setFrequency(e.target.value as Frequency)} className={field}>
              {(Object.keys(FREQ_LABEL) as Frequency[]).map(f => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary">{row ? 'Next invoice on' : 'First invoice on'}
            <input type="date" value={nextRun} onChange={e => setNextRun(e.target.value)} className={field} />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary">Stop after (optional)
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={field} />
          </label>
          <div className="flex flex-col gap-2 justify-end text-[13px] text-text-primary">
            <label className="flex items-center gap-2"><input type="checkbox" checked={autoSend} onChange={e => setAutoSend(e.target.checked)} />Email it to the client automatically</label>
            {vatRegistered && <label className="flex items-center gap-2"><input type="checkbox" checked={vatOn} onChange={e => setVatOn(e.target.checked)} />Charge VAT (15%)</label>}
          </div>
          {!autoSend && <p className="sm:col-span-2 text-[12px] text-text-secondary">Each invoice is made as a draft on the day; you check it and send it yourself.</p>}
        </div>

        <LineItemsEditor lines={lines} onChange={setLines} items={items} itemsLoading={itemsLoading} startOpen={!row} />

        <div className="bg-surface-card border border-divider rounded-2xl p-5 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary">Notes on each invoice (optional)
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className="rounded-xl border border-divider px-3 py-2 text-[14px] bg-background text-text-primary resize-none" />
          </label>
          <div className="flex justify-between text-[14px] font-semibold text-text-primary">
            <span>Each invoice{rate > 0 ? ' (incl. VAT)' : ''}</span><span className="tabular-nums">{formatRand(total)}</span>
          </div>
          {err && <p className="text-[13px] text-error">{err}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onDone(false)} className="h-10 px-4 rounded-xl border border-divider text-[13px] text-text-primary hover:bg-surface-elevated">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void save()} className="h-10 px-5 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
