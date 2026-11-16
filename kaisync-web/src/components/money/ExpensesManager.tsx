'use client'

/**
 * Subscriptions and regular costs (software, phones, rent, insurance, …) plus once-off expenses.
 * Each payment day counts as money out on the Money pages.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatRand } from '@/lib/line-items'
import { EXPENSE_CATEGORIES, FREQUENCY_LABEL, PAYMENT_LABEL, monthlyEquivalent, type ExpenseItem } from '@/lib/money/overview'
import { localISODate } from '@/lib/utils'
import { signWorkforceMedia } from '@/lib/media-read'
import { StatusFilterTabs, TAB_ALL, MONEY_TH, MONEY_TD, countByStatusTab, filterByStatusTab } from '@/components/ui/StatusFilterTabs'
import { TextHeaderFilter, MoneyHeaderFilter, StatusHeaderFilter, ResetFiltersButton, matchText, matchMoney, statusTab } from '@/components/ui/MoneyListFilters'

type Row = Omit<ExpenseItem, 'next_date' | 'in_period'> & { receipt_path?: string | null }

const FREQS: ExpenseItem['frequency'][] = ['monthly', 'yearly', 'quarterly', 'weekly', 'once']

function addMonths(iso: string, m: number): string {
  const [y, mo, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, mo - 1 + m, 1))
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}
function addDaysIso(iso: string, n: number): string {
  const t = new Date(`${iso}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

/** The next payment day on or after today (null once it has ended). */
export function nextPayment(e: Pick<Row, 'frequency' | 'start_date' | 'end_date'>, today: string): string | null {
  let d = e.start_date
  const step = (i: number) =>
    e.frequency === 'weekly' ? addDaysIso(e.start_date, 7 * i)
      : e.frequency === 'monthly' ? addMonths(e.start_date, i)
        : e.frequency === 'quarterly' ? addMonths(e.start_date, 3 * i)
          : e.frequency === 'yearly' ? addMonths(e.start_date, 12 * i) : e.start_date
  if (e.frequency !== 'once') {
    for (let i = 0; d < today && i < 2000; i++) d = step(i + 1)
  }
  if (d < today) return null
  if (e.end_date && d > e.end_date) return null
  return d
}

const day = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

type Draft = {
  id: string | null; name: string; category: string; amount: string; includesVat: boolean
  frequency: ExpenseItem['frequency']; start_date: string; end_date: string; payment_method: string; notes: string
  /** Receipt already saved, and a new photo / PDF chosen in this form. */
  receipt_path: string | null; receiptFile: File | null
}

const blank = (): Draft => ({
  id: null, name: '', category: 'Software', amount: '', includesVat: true, frequency: 'monthly',
  start_date: localISODate(), end_date: '', payment_method: 'debit_order', notes: '',
  receipt_path: null, receiptFile: null,
})

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024

type ExpenseStatus = 'due' | 'active' | 'ended'
const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = { due: 'Due soon', active: 'Active', ended: 'Ended' }
const EXPENSE_BADGE: Record<ExpenseStatus, string> = { due: 'bg-amber-100 text-amber-700', active: 'bg-green-100 text-green-700', ended: 'bg-gray-100 text-gray-500' }
const EXPENSE_TABS = [
  TAB_ALL,
  statusTab('due', 'Due in 14 days', ['due'], 'amber'),
  statusTab('active', 'Active', ['due', 'active'], 'green'),
  statusTab('ended', 'Ended', ['ended'], 'gray'),
]
type ExpenseCols = { name: string; categories: string[]; freqs: string[]; min: string; max: string }
const EMPTY_COLS: ExpenseCols = { name: '', categories: [], freqs: [], min: '', max: '' }

export function ExpensesManager({ companyId, vatRegistered, onChanged }: { companyId: string; vatRegistered: boolean; onChanged?: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = localISODate()

  const load = useCallback(async () => {
    const { data, error: e } = await createClient().from('company_expenses')
      .select('id, name, category, amount, vat_amount, frequency, start_date, end_date, payment_method, notes, receipt_path')
      .eq('company_id', companyId).is('archived_at', null).order('name')
    if (e) { setError(e.message); setRows([]); return }
    setRows(((data ?? []) as Row[]).map(r => ({ ...r, amount: Number(r.amount), vat_amount: Number(r.vat_amount) })))
  }, [companyId])

  useEffect(() => {
    let live = true
    void Promise.resolve().then(() => { if (live) void load() })
    return () => { live = false }
  }, [load])

  const list = useMemo(() => (rows ?? []).map(r => {
    const next = nextPayment(r, today)
    const status: ExpenseStatus = !next ? 'ended' : next <= addDaysIso(today, 14) ? 'due' : 'active'
    return { ...r, next, status }
  }).sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999')), [rows, today])
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')
  const [cols, setCols] = useState<ExpenseCols>(EMPTY_COLS)
  const active = list.filter(r => r.next)
  const monthly = active.reduce((s, r) => s + monthlyEquivalent(r), 0)
  const soon = active.filter(r => r.next && r.next <= addDaysIso(today, 14)).length

  async function save() {
    if (!draft) return
    const amount = parseFloat(draft.amount.replace(/\s/g, '').replace(',', '.'))
    if (!draft.name.trim()) { setError('Give it a name.'); return }
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter the amount you pay.'); return }
    if (draft.end_date && draft.end_date < draft.start_date) { setError('The last payment can’t be before the first.'); return }
    setBusy(true); setError(null)
    const vat = vatRegistered && draft.includesVat ? Math.round((amount * 15 / 115) * 100) / 100 : 0
    const payload = {
      company_id: companyId, name: draft.name.trim(), category: draft.category, amount: Math.round(amount * 100) / 100, vat_amount: vat,
      frequency: draft.frequency, start_date: draft.start_date, end_date: draft.frequency === 'once' ? null : (draft.end_date || null),
      payment_method: draft.payment_method || null, notes: draft.notes.trim() || null, updated_at: new Date().toISOString(),
    }
    if (draft.receiptFile && draft.receiptFile.size > MAX_RECEIPT_BYTES) { setBusy(false); setError('That file is bigger than 10 MB. Take a photo or choose a smaller file.'); return }
    const supabase = createClient()
    const res = draft.id
      ? await supabase.from('company_expenses').update(payload).eq('id', draft.id).select('id').maybeSingle()
      : await supabase.from('company_expenses').insert(payload).select('id').maybeSingle()
    if (res.error || !res.data) { setBusy(false); setError(res.error?.message ?? 'Could not save'); return }
    // Receipt photo / PDF: private, office-only storage (expense_receipts/{company}/…).
    if (draft.receiptFile) {
      const id = (res.data as { id: string }).id
      const ext = (draft.receiptFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg'
      const path = `expense_receipts/${companyId}/${id}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('workforce-media').upload(path, draft.receiptFile, { contentType: draft.receiptFile.type || undefined })
      if (upErr) { setBusy(false); setError(`Saved, but the receipt didn't upload: ${upErr.message}`); await load(); return }
      const { error: pErr } = await supabase.from('company_expenses').update({ receipt_path: path }).eq('id', id)
      if (pErr) { setBusy(false); setError(`Saved, but the receipt couldn't be linked: ${pErr.message}`); await load(); return }
    }
    setBusy(false)
    setDraft(null)
    await load()
    onChanged?.()
  }

  async function remove(id: string) {
    setBusy(true)
    const { error: e } = await createClient().from('company_expenses').update({ archived_at: new Date().toISOString() }).eq('id', id)
    setBusy(false)
    if (e) { setError(e.message); return }
    setDraft(null)
    await load()
    onChanged?.()
  }

  async function openReceipt(path: string) {
    const url = await signWorkforceMedia(createClient(), path, 600)
    if (url) window.open(url, '_blank', 'noopener')
    else setError('Could not open the receipt.')
  }

  function edit(r: Row) {
    setError(null)
    setDraft({
      id: r.id, name: r.name, category: r.category, amount: r.amount.toFixed(2), includesVat: r.vat_amount > 0 || !vatRegistered,
      frequency: r.frequency, start_date: r.start_date, end_date: r.end_date ?? '', payment_method: r.payment_method ?? '', notes: r.notes ?? '',
      receipt_path: r.receipt_path ?? null, receiptFile: null,
    })
  }

  const input = 'h-10 rounded-xl border border-divider px-3 text-[14px] bg-background text-text-primary focus:outline-none focus:border-primary/60'
  const label = 'flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary'

  const afterCols = list.filter(r => matchText(r.name, cols.name) && (cols.categories.length === 0 || cols.categories.includes(r.category))
    && (cols.freqs.length === 0 || cols.freqs.includes(r.frequency)) && matchMoney(r.amount, cols.min, cols.max)
    && (!search.trim() || [r.name, r.category, r.notes].some(v => matchText(v, search.trim()))))
  const counts = countByStatusTab(afterCols, EXPENSE_TABS)
  const shown = filterByStatusTab(afterCols, EXPENSE_TABS, tab)
  const categories = [...new Set(list.map(r => r.category))].map(c => ({ id: c, label: c }))
  const anyFilter = search !== '' || JSON.stringify(cols) !== JSON.stringify(EMPTY_COLS)

  return (
    <div className="flex flex-col border border-divider rounded-xl overflow-hidden bg-surface">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider bg-surface gap-3 flex-wrap">
        <p className="text-[12px] text-text-secondary">
          {formatRand(monthly)} a month · paying for {active.length} {active.length === 1 ? 'item' : 'items'} · {soon} due in the next 14 days
        </p>
        <button type="button" onClick={() => { setError(null); setDraft(blank()) }} className="btn-primary h-8 px-3 text-[12px]">+ Expense</button>
      </div>
      <div className="flex gap-2 px-4 py-2 border-b border-divider bg-surface flex-wrap items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Search expenses" placeholder="Search name, category or notes…"
          className="form-input h-8 flex-1 min-w-[180px] text-[12px]" />
        <ResetFiltersButton disabled={!anyFilter} onReset={() => { setCols(EMPTY_COLS); setSearch('') }} />
        <StatusFilterTabs tabs={EXPENSE_TABS} value={tab} counts={counts} onChange={setTab} />
      </div>

      {error && !draft && <p className="px-4 py-2.5 text-[13px] text-error border-b border-divider">{error}</p>}

      <div className="overflow-auto">
        {rows === null ? <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p> : (
          <table className="w-full" style={{ minWidth: 760 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className={`${MONEY_TH} text-left`}><TextHeaderFilter label="Name" value={cols.name} onChange={v => setCols(c => ({ ...c, name: v }))} placeholder="Name…" /></th>
                <th className={`${MONEY_TH} text-left`}><StatusHeaderFilter label="Category" options={categories} selected={cols.categories} onChange={v => setCols(c => ({ ...c, categories: v }))} /></th>
                <th className={`${MONEY_TH} text-left`}><StatusHeaderFilter label="How often" options={FREQS.map(f => ({ id: f, label: FREQUENCY_LABEL[f] }))} selected={cols.freqs} onChange={v => setCols(c => ({ ...c, freqs: v }))} /></th>
                <th className={`${MONEY_TH} text-left`}>Paid by</th>
                <th className={`${MONEY_TH} text-left`}>Next payment</th>
                <th className={`${MONEY_TH} text-left`}>Status</th>
                <th className={`${MONEY_TH} text-right`}><MoneyHeaderFilter label="Amount" min={cols.min} max={cols.max} onChange={p => setCols(c => ({ ...c, min: p.min, max: p.max }))} /></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.id} className="border-b border-divider cursor-pointer hover:bg-surface-elevated transition-colors" onClick={() => edit(r)}>
                  <td className={`${MONEY_TD} font-medium text-primary`}>
                    <span className="inline-flex items-center gap-1.5">{r.name}
                      {r.receipt_path && <span className="material-icons text-[14px] text-emerald-600" title="Receipt attached" aria-label="Receipt attached">receipt</span>}
                    </span>
                  </td>
                  <td className={MONEY_TD}>{r.category}</td>
                  <td className={MONEY_TD}>{FREQUENCY_LABEL[r.frequency]}</td>
                  <td className={MONEY_TD}>{r.payment_method ? (PAYMENT_LABEL[r.payment_method] ?? r.payment_method) : '—'}</td>
                  <td className={`${MONEY_TD} text-text-secondary`}>{r.next ? day(r.next) : r.frequency === 'once' ? `Paid ${day(r.start_date)}` : '—'}</td>
                  <td className={MONEY_TD}>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${EXPENSE_BADGE[r.status]}`}>{EXPENSE_STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className={`${MONEY_TD} text-right`}>{formatRand(r.amount)}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={7} className="text-center text-[13px] text-text-secondary py-10">
                  {list.length === 0 ? 'Nothing added yet. Add what the business pays for: software, phone contracts, rent, insurance, vehicle tracking…' : 'No expenses match these filters'}
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={draft.id ? 'Edit expense' : 'Add expense'}>
          <div className="bg-surface-card rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-text-primary">{draft.id ? 'Edit expense' : 'Add expense'}</h3>
              <button type="button" aria-label="Close" onClick={() => setDraft(null)} className="w-8 h-8 rounded-lg text-text-secondary hover:bg-surface-elevated flex items-center justify-center">
                <span className="material-icons text-[18px]">close</span>
              </button>
            </div>
            <label className={label}>What is it?
              <input className={input} autoFocus value={draft.name} placeholder="e.g. Microsoft 365, Vodacom contracts, office rent"
                onChange={e => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>Category
                <select className={input} value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>
                  {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className={label}>Amount you pay (R)
                <input className={input} inputMode="decimal" value={draft.amount} placeholder="0.00" onChange={e => setDraft({ ...draft, amount: e.target.value })} />
              </label>
            </div>
            {vatRegistered && (
              <label className="flex items-center gap-2 text-[13px] text-text-secondary">
                <input type="checkbox" className="accent-primary" checked={draft.includesVat} onChange={e => setDraft({ ...draft, includesVat: e.target.checked })} />
                This amount includes 15% VAT (claimable)
              </label>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>How often
                <select className={input} value={draft.frequency} onChange={e => setDraft({ ...draft, frequency: e.target.value as Draft['frequency'] })}>
                  {FREQS.map(f => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
                </select>
              </label>
              <label className={label}>Paid by
                <select className={input} value={draft.payment_method} onChange={e => setDraft({ ...draft, payment_method: e.target.value })}>
                  <option value="">—</option>
                  {Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>{draft.frequency === 'once' ? 'Payment date' : 'First payment'}
                <input type="date" className={input} value={draft.start_date} onChange={e => setDraft({ ...draft, start_date: e.target.value })} />
              </label>
              {draft.frequency !== 'once' && (
                <label className={label}>Last payment (optional)
                  <input type="date" className={input} value={draft.end_date} onChange={e => setDraft({ ...draft, end_date: e.target.value })} />
                </label>
              )}
            </div>
            <label className={label}>Notes (optional)
              <input className={input} value={draft.notes} placeholder="Account number, contract end, who looks after it…" onChange={e => setDraft({ ...draft, notes: e.target.value })} />
            </label>
            <div className={label}>Receipt (optional)
              <div className="flex flex-wrap items-center gap-2">
                <label className="h-11 px-4 rounded-xl border border-divider text-[13px] font-semibold text-text-primary flex items-center gap-1.5 cursor-pointer hover:bg-surface-elevated">
                  <span className="material-icons text-[18px]">photo_camera</span>
                  {draft.receiptFile ? 'Change' : draft.receipt_path ? 'Replace receipt' : 'Snap or attach receipt'}
                  <input type="file" accept="image/*,application/pdf" className="hidden"
                    onChange={e => { const f = e.target.files?.[0] ?? null; setDraft({ ...draft, receiptFile: f }); e.target.value = '' }} />
                </label>
                {draft.receiptFile && <span className="text-[12.5px] text-text-primary truncate max-w-[200px]">{draft.receiptFile.name}</span>}
                {!draft.receiptFile && draft.receipt_path && (
                  <button type="button" onClick={() => void openReceipt(draft.receipt_path!)} className="h-11 px-3 text-[13px] font-semibold text-primary">View receipt</button>
                )}
              </div>
              <span className="text-[11.5px] text-text-secondary/80">On a phone this opens the camera. Only the owner, admins and HR can see receipts.</span>
            </div>
            {error && <p className="text-[13px] text-error">{error}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {draft.id ? (
                <button type="button" disabled={busy} onClick={() => void remove(draft.id!)} className="h-10 px-3 rounded-xl text-[13px] text-error hover:bg-error/5 disabled:opacity-50">
                  Remove from list
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button type="button" onClick={() => setDraft(null)} className="h-10 px-4 rounded-xl border border-divider text-[13px] text-text-primary hover:bg-surface-elevated">Cancel</button>
                <button type="button" disabled={busy} onClick={() => void save()} className="h-10 px-5 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50">
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
