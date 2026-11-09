'use client'

/**
 * Recurring invoices: set an invoice up once (client, lines, how often) and it is created — and emailed
 * with the client's View & pay link — by itself on the day it is due. Or keep each one as a draft to check.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { LineItemsEditor } from '@/components/money/LineItemsEditor'
import {
  StatusFilterTabs,
  TAB_ALL,
  MONEY_TH,
  MONEY_TD,
  countByStatusTab,
  filterByStatusTab,
} from '@/components/ui/StatusFilterTabs'
import {
  TextHeaderFilter,
  MoneyHeaderFilter,
  DateHeaderFilter,
  ResetFiltersButton,
  matchText,
  matchMoney,
  inDateRange,
  statusTab,
} from '@/components/ui/MoneyListFilters'
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

/** recurring_invoices has a boolean `active` — tabs use this derived status (active / paused). */
type RecurringRow = Recurring & { status: 'active' | 'paused'; total: number }

const STATUS_TABS = [
  TAB_ALL,
  statusTab('active', 'Active', ['active'], 'green'),
  statusTab('paused', 'Paused', ['paused'], 'amber'),
]

type Cols = {
  client: string
  title: string
  nextFrom: string
  nextTo: string
  amountMin: string
  amountMax: string
}

const EMPTY_COLS: Cols = { client: '', title: '', nextFrom: '', nextTo: '', amountMin: '', amountMax: '' }

function colsActive(c: Cols): boolean {
  return !!(c.client || c.title || c.nextFrom || c.nextTo || c.amountMin || c.amountMax)
}

export default function RecurringInvoicesPage() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [rows, setRows] = useState<Recurring[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [statusTabId, setStatusTabId] = useState('all')
  const [search, setSearch] = useState('')
  const [cols, setCols] = useState<Cols>(EMPTY_COLS)

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

  function patchCols(p: Partial<Cols>) { setCols(prev => ({ ...prev, ...p })) }

  const base = useMemo<RecurringRow[]>(() => {
    const q = search.trim().toLowerCase()
    return rows
      .map<RecurringRow>(r => {
        const sub = r.lines.reduce((s, l) => s + Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100, 0)
        const total = sub + Math.round(sub * Number(r.vat_rate) * 100) / 100
        return { ...r, status: r.active ? 'active' : 'paused', total }
      })
      .filter(r => {
        const client = r.clients?.name ?? ''
        if (!matchText(client, cols.client)) return false
        if (!matchText(r.title, cols.title)) return false
        if (!matchMoney(r.total, cols.amountMin, cols.amountMax)) return false
        if (!inDateRange(r.next_run, cols.nextFrom, cols.nextTo)) return false
        if (!q) return true
        return client.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)
      })
  }, [rows, cols, search])

  const counts = useMemo(() => countByStatusTab(base, STATUS_TABS), [base])
  const filtered = useMemo(() => filterByStatusTab(base, STATUS_TABS, statusTabId), [base, statusTabId])

  if (editing && companyId) {
    return <RecurringEditor companyId={companyId} row={editing === 'new' ? null : editing}
      onDone={async saved => { setEditing(null); if (saved) { setMsg({ ok: true, text: 'Saved.' }); await load() } }} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary leading-tight">Recurring invoices</h1>
          <p className="text-[11px] text-text-secondary mt-0.5">Monthly service contracts, retainers and rentals: set once, invoiced and emailed by themselves.</p>
        </div>
        <button type="button" onClick={() => setEditing('new')} className="btn-primary h-8 px-3 text-[12px] flex items-center gap-1">
          <span className="material-icons text-[16px]">add</span>New recurring invoice
        </button>
      </div>

      <div className="flex gap-2 px-4 py-2 border-b border-divider bg-surface shrink-0 flex-wrap items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search client or title…"
          className="form-input h-8 flex-1 min-w-[180px] text-[12px]"
        />
        <ResetFiltersButton
          disabled={!colsActive(cols) && !search}
          onReset={() => { setCols(EMPTY_COLS); setSearch('') }}
        />
        <StatusFilterTabs tabs={STATUS_TABS} value={statusTabId} counts={counts} onChange={setStatusTabId} />
      </div>

      {msg && <p className={`px-4 pt-2 text-[12px] ${msg.ok ? 'text-emerald-700' : 'text-error'}`}>{msg.text}</p>}

      <div className="flex-1 overflow-auto">
        {loading ? <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p> : rows.length === 0 ? (
          <div className="m-4 rounded-2xl border border-dashed border-divider p-10 text-center">
            <span className="material-icons text-[40px] text-text-disabled">event_repeat</span>
            <p className="mt-2 text-[14px] font-medium text-text-primary">No recurring invoices yet</p>
            <p className="text-[12.5px] text-text-secondary">Create one for a client you bill the same amount every month.</p>
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 720 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Client" value={cols.client} onChange={v => patchCols({ client: v })} placeholder="Client name…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Title" value={cols.title} onChange={v => patchCols({ title: v })} placeholder="Title…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>How often</th>
                <th className={`${MONEY_TH} text-left`}>
                  <DateHeaderFilter
                    label="Next invoice"
                    from={cols.nextFrom}
                    to={cols.nextTo}
                    onChange={p => patchCols({ nextFrom: p.from, nextTo: p.to })}
                  />
                </th>
                <th className={`${MONEY_TH} text-right`}>
                  <MoneyHeaderFilter
                    label="Amount"
                    min={cols.amountMin}
                    max={cols.amountMax}
                    onChange={p => patchCols({ amountMin: p.min, amountMax: p.max })}
                  />
                </th>
                <th className={`${MONEY_TH} text-left`}>Sending</th>
                <th className={MONEY_TH} />
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className={`border-b border-divider hover:bg-surface-elevated transition-colors ${r.active ? '' : 'opacity-60'}`}>
                  <td className={`${MONEY_TD} font-medium text-text-primary`}>{r.clients?.name ?? '—'}</td>
                  <td className={`${MONEY_TD} text-text-primary`}>
                    {r.title}{r.runs > 0 ? <span className="text-text-secondary"> · {r.runs} sent so far</span> : null}
                    {r.last_error && <span className="block text-[11px] text-error">Last try failed: {r.last_error}</span>}
                  </td>
                  <td className={MONEY_TD}>{FREQ_LABEL[r.frequency]}{r.end_date ? <span className="block text-[11px] text-text-secondary">until {day(r.end_date)}</span> : null}</td>
                  <td className={`${MONEY_TD} whitespace-nowrap`}>{r.active ? day(r.next_run) : <span className="text-text-secondary">Stopped</span>}</td>
                  <td className={`${MONEY_TD} text-right font-semibold tabular-nums`}>{formatRand(r.total)}</td>
                  <td className={MONEY_TD}>{r.auto_send ? 'Emailed automatically' : 'Draft for you to check'}</td>
                  <td className={MONEY_TD}>
                    <div className="flex justify-end gap-1.5 whitespace-nowrap">
                      {r.last_invoice_id && <Link href={`/dashboard/money/invoices/${r.last_invoice_id}`} className="h-7 px-2 rounded-md text-[11px] text-primary hover:bg-primary/10 inline-flex items-center">Last invoice</Link>}
                      {r.active && <button type="button" disabled={busyId === r.id} onClick={() => void runNow(r)} className="h-7 px-2 rounded-md border border-divider text-[11px] hover:bg-surface-elevated disabled:opacity-50">Create now</button>}
                      <button type="button" onClick={() => setEditing(r)} className="h-7 px-2 rounded-md border border-divider text-[11px] hover:bg-surface-elevated">Edit</button>
                      <button type="button" disabled={busyId === r.id} onClick={() => void setActive(r, !r.active)} className="h-7 px-2 rounded-md border border-divider text-[11px] hover:bg-surface-elevated disabled:opacity-50">{r.active ? 'Stop' : 'Restart'}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-[13px] text-text-secondary py-14">
                    No recurring invoices match these filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
