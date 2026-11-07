'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
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
  StatusHeaderFilter,
  ResetFiltersButton,
  matchText,
  statusTab,
} from '@/components/ui/MoneyListFilters'

interface Supplier {
  id: string
  name: string
  email: string | null
  phone: string | null
  vat_number: string | null
  payment_terms: number | null
  is_active: boolean
}

/** contractors has no status column — tabs filter on is_active via this derived status. */
type SupplierRow = Supplier & { status: 'active' | 'inactive' }

const STATUS_TABS = [
  TAB_ALL,
  statusTab('active', 'Active', ['active'], 'green'),
  statusTab('inactive', 'Inactive', ['inactive'], 'slate'),
]

const STATUS_OPTIONS = [
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
]

type Cols = {
  name: string
  email: string
  phone: string
  vat: string
  terms: string
  statuses: string[]
}

const EMPTY_COLS: Cols = { name: '', email: '', phone: '', vat: '', terms: '', statuses: [] }

function colsActive(c: Cols): boolean {
  return !!(c.name || c.email || c.phone || c.vat || c.terms || c.statuses.length)
}

function termsLabel(s: Supplier): string {
  return s.payment_terms != null ? `${s.payment_terms} days` : '—'
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusTabId, setStatusTabId] = useState('all')
  const [cols, setCols] = useState<Cols>(EMPTY_COLS)
  const [showDrawer, setShowDrawer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    name: '', email: '', phone: '', vat_number: '', payment_terms: '30',
  })
  const [companyId, setCompanyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Not linked to a company'); setLoading(false); return }
    setCompanyId(member.companyId)

    const { data, error: err } = await supabase
      .from('contractors')
      .select('id, name, email, phone, vat_number, payment_terms, is_active')
      .eq('company_id', member.companyId)
      .eq('partner_kind', 'supplier')
      .order('name')

    if (err) setError(err.message)
    else setSuppliers((data ?? []) as Supplier[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function patchCols(p: Partial<Cols>) { setCols(prev => ({ ...prev, ...p })) }

  const base = useMemo<SupplierRow[]>(() => {
    const q = search.trim().toLowerCase()
    return suppliers
      .map<SupplierRow>(s => ({ ...s, status: s.is_active ? 'active' : 'inactive' }))
      .filter(s => {
        if (!matchText(s.name, cols.name)) return false
        if (!matchText(s.email, cols.email)) return false
        if (!matchText(s.phone, cols.phone)) return false
        if (!matchText(s.vat_number, cols.vat)) return false
        if (!matchText(termsLabel(s), cols.terms)) return false
        if (cols.statuses.length && !cols.statuses.includes(s.status)) return false
        if (!q) return true
        return s.name.toLowerCase().includes(q)
          || (s.email ?? '').toLowerCase().includes(q)
          || (s.phone ?? '').toLowerCase().includes(q)
          || (s.vat_number ?? '').toLowerCase().includes(q)
      })
  }, [suppliers, cols, search])

  const counts = useMemo(() => countByStatusTab(base, STATUS_TABS), [base])
  const filtered = useMemo(() => filterByStatusTab(base, STATUS_TABS, statusTabId), [base, statusTabId])

  async function createSupplier() {
    if (!companyId || !form.name.trim()) return
    setBusy(true)
    const supabase = createClient()
    const { error: err } = await supabase.from('contractors').insert({
      company_id: companyId,
      name: form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      vat_number: form.vat_number.trim() || null,
      payment_terms: form.payment_terms ? Number(form.payment_terms) : null,
      partner_kind: 'supplier',
      is_active: true,
    })
    setBusy(false)
    if (err) { setError(err.message); return }
    setShowDrawer(false)
    setForm({ name: '', email: '', phone: '', vat_number: '', payment_terms: '30' })
    void load()
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary leading-tight">Suppliers</h1>
          <p className="text-[11px] text-text-secondary mt-0.5">{filtered.length} supplier{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowDrawer(true)} className="btn-primary h-8 px-3 text-[12px] flex items-center gap-1">
          <span className="material-icons text-[16px]">add</span>
          New Supplier
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-2 rounded bg-error/10 text-error text-[12px]">{error}</div>
      )}

      <div className="flex gap-2 px-4 py-2 border-b border-divider bg-surface shrink-0 flex-wrap items-center">
        <input
          type="search"
          placeholder="Search name, email, phone, or VAT…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="form-input h-8 flex-1 min-w-[180px] text-[12px]"
        />
        <ResetFiltersButton
          disabled={!colsActive(cols) && !search}
          onReset={() => { setCols(EMPTY_COLS); setSearch('') }}
        />
        <StatusFilterTabs tabs={STATUS_TABS} value={statusTabId} counts={counts} onChange={setStatusTabId} />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-[13px] text-text-secondary py-8 text-center">Loading…</p>
        ) : suppliers.length === 0 ? (
          <div className="text-center py-16">
            <span className="material-icons text-[48px] text-text-secondary opacity-30">storefront</span>
            <p className="text-[13px] text-text-secondary mt-3">
              No suppliers yet. Add your first supplier to get started.
            </p>
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 640 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Name" value={cols.name} onChange={v => patchCols({ name: v })} placeholder="Supplier name…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Email" value={cols.email} onChange={v => patchCols({ email: v })} placeholder="Email…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Phone" value={cols.phone} onChange={v => patchCols({ phone: v })} placeholder="Phone…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="VAT" value={cols.vat} onChange={v => patchCols({ vat: v })} placeholder="VAT number…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Terms" value={cols.terms} onChange={v => patchCols({ terms: v })} placeholder="e.g. 30…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <StatusHeaderFilter
                    label="Status"
                    options={STATUS_OPTIONS}
                    selected={cols.statuses}
                    onChange={statuses => patchCols({ statuses })}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className="border-b border-divider hover:bg-surface-elevated/50 cursor-pointer"
                  onClick={() => window.location.href = `/dashboard/supply/suppliers/${s.id}`}>
                  <td className={MONEY_TD}>
                    <Link href={`/dashboard/supply/suppliers/${s.id}`}
                      className="font-medium text-text-primary hover:text-primary"
                      onClick={e => e.stopPropagation()}>
                      {s.name}
                    </Link>
                  </td>
                  <td className={`${MONEY_TD} text-text-secondary`}>{s.email ?? '—'}</td>
                  <td className={`${MONEY_TD} text-text-secondary`}>{s.phone ?? '—'}</td>
                  <td className={`${MONEY_TD} text-text-secondary`}>{s.vat_number ?? '—'}</td>
                  <td className={`${MONEY_TD} text-text-secondary`}>{termsLabel(s)}</td>
                  <td className={MONEY_TD}>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${s.is_active ? 'bg-success/10 text-success' : 'bg-surface-elevated text-text-secondary'}`}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-[13px] text-text-secondary py-14">
                    No suppliers match these filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Create drawer */}
      {showDrawer && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setShowDrawer(false)} />
          <div className="w-80 bg-surface h-full flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
              <h2 className="text-[15px] font-semibold text-text-primary">New Supplier</h2>
              <button onClick={() => setShowDrawer(false)} className="text-text-secondary hover:text-text-primary">
                <span className="material-icons text-[20px]">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">Name *</label>
                <input className="input h-9 text-[13px] w-full" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">Email</label>
                <input className="input h-9 text-[13px] w-full" type="email" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">Phone</label>
                <input className="input h-9 text-[13px] w-full" value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">VAT Number</label>
                <input className="input h-9 text-[13px] w-full" value={form.vat_number}
                  onChange={e => setForm(f => ({ ...f, vat_number: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">Payment Terms (days)</label>
                <input className="input h-9 text-[13px] w-full" type="number" value={form.payment_terms}
                  onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))} />
              </div>
            </div>
            <div className="p-4 border-t border-divider flex gap-2">
              <button onClick={() => setShowDrawer(false)} className="btn-secondary flex-1 h-9 text-[13px]">Cancel</button>
              <button onClick={createSupplier} disabled={busy || !form.name.trim()} className="btn-primary flex-1 h-9 text-[13px] disabled:opacity-50">
                {busy ? 'Saving…' : 'Create Supplier'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
