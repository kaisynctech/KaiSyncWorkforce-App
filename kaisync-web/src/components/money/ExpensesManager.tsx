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

  useEffect(() => { void load() }, [load])

  const list = useMemo(() => (rows ?? []).map(r => ({ ...r, next: nextPayment(r, today) }))
    .sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999')), [rows, today])
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 items-stretch">
        <Stat label="Regular costs a month" value={formatRand(monthly)} />
        <Stat label="Paying for" value={`${active.length} ${active.length === 1 ? 'item' : 'items'}`} />
        <Stat label="Due in the next 14 days" value={String(soon)} />
        <button type="button" onClick={() => { setError(null); setDraft(blank()) }}
          className="self-center h-11 px-5 rounded-xl bg-primary text-white text-[14px] font-semibold flex items-center gap-2 hover:bg-primary-dark">
          <span className="material-icons text-[18px]">add</span>Add expense
        </button>
      </div>

      {error && !draft && <p className="rounded-xl border border-error/30 bg-error/5 px-4 py-2.5 text-[13px] text-error">{error}</p>}

      <div className="bg-surface-card border border-divider rounded-2xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3">
          <h2 className="text-[15px] font-semibold text-text-primary">Subscriptions and regular costs</h2>
          <span className="text-[12px] text-text-secondary">Each payment counts as money out on its payment day</span>
        </div>
        {rows === null && <p className="px-5 py-6 text-[13px] text-text-secondary border-t border-divider/70">Loading…</p>}
        {rows !== null && list.length === 0 && (
          <div className="px-5 py-10 border-t border-divider/70 text-center">
            <p className="text-[14px] font-medium text-text-primary">Nothing added yet</p>
            <p className="text-[13px] text-text-secondary mt-1">Add what the business pays for: software, phone contracts, rent, insurance, vehicle tracking…</p>
          </div>
        )}
        {list.map(r => (
          <button key={r.id} type="button" onClick={() => edit(r)}
            className={`w-full flex flex-wrap items-center gap-3 px-5 py-3 border-t border-divider/70 text-left hover:bg-surface-elevated/60 ${r.next ? '' : 'opacity-60'}`}>
            <span className="w-9 h-9 rounded-xl bg-surface-elevated text-text-primary font-bold text-[13px] flex items-center justify-center shrink-0">{r.name.trim()[0]?.toUpperCase()}</span>
            <span className="flex-1 basis-[200px] min-w-0 flex flex-col">
              <span className="text-[13.5px] font-medium text-text-primary truncate flex items-center gap-1.5">{r.name}
                {r.receipt_path && <span className="material-icons text-[15px] text-emerald-600" title="Receipt attached" aria-label="Receipt attached">receipt</span>}
              </span>
              <span className="text-[11.5px] text-text-secondary truncate">
                {r.category} · {FREQUENCY_LABEL[r.frequency]}{r.payment_method ? ` · ${PAYMENT_LABEL[r.payment_method] ?? r.payment_method}` : ''}
              </span>
            </span>
            <span className="text-[12px] text-text-secondary w-[140px]">{r.next ? `Next: ${day(r.next)}` : r.frequency === 'once' ? `Paid ${day(r.start_date)}` : 'Ended'}</span>
            <span className="text-[13.5px] font-semibold text-text-primary tabular-nums w-[120px] text-right">{formatRand(r.amount)}</span>
          </button>
        ))}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 basis-[180px] bg-surface-card border border-divider rounded-2xl px-4 py-3.5">
      <p className="text-[12px] text-text-secondary">{label}</p>
      <p className="text-[20px] font-bold text-text-primary mt-1 tabular-nums">{value}</p>
    </div>
  )
}
