'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface Supplier {
  id: string
  name: string
  email: string | null
  phone: string | null
  vat_number: string | null
  payment_terms: number | null
  is_active: boolean
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
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

  const filtered = suppliers.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.email ?? '').toLowerCase().includes(search.toLowerCase())
  )

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
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary">Suppliers</h1>
          <p className="text-[12px] text-text-secondary">{filtered.length} supplier{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowDrawer(true)} className="btn-primary h-9 px-4 text-[13px] flex items-center gap-1">
          <span className="material-icons text-[18px]">add</span>
          New Supplier
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-2 rounded bg-error/10 text-error text-[12px]">{error}</div>
      )}

      {/* Search */}
      <div className="px-4 py-3 shrink-0">
        <input
          type="search"
          placeholder="Search suppliers…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input h-9 text-[13px] w-full max-w-sm"
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-4">
        {loading ? (
          <p className="text-[13px] text-text-secondary py-8 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <span className="material-icons text-[48px] text-text-secondary opacity-30">storefront</span>
            <p className="text-[13px] text-text-secondary mt-3">
              {search ? 'No suppliers match your search.' : 'No suppliers yet. Add your first supplier to get started.'}
            </p>
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 560 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">Name</th>
                <th className="data-th text-left">Email</th>
                <th className="data-th text-left">Phone</th>
                <th className="data-th text-left">VAT</th>
                <th className="data-th text-left">Terms</th>
                <th className="data-th text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className="border-b border-divider hover:bg-surface-elevated/50 cursor-pointer"
                  onClick={() => window.location.href = `/dashboard/supply/suppliers/${s.id}`}>
                  <td className="data-td">
                    <Link href={`/dashboard/supply/suppliers/${s.id}`}
                      className="text-[13px] font-medium text-text-primary hover:text-primary"
                      onClick={e => e.stopPropagation()}>
                      {s.name}
                    </Link>
                  </td>
                  <td className="data-td text-[13px] text-text-secondary">{s.email ?? '—'}</td>
                  <td className="data-td text-[13px] text-text-secondary">{s.phone ?? '—'}</td>
                  <td className="data-td text-[13px] text-text-secondary">{s.vat_number ?? '—'}</td>
                  <td className="data-td text-[13px] text-text-secondary">{s.payment_terms != null ? `${s.payment_terms} days` : '—'}</td>
                  <td className="data-td">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${s.is_active ? 'bg-success/10 text-success' : 'bg-surface-elevated text-text-secondary'}`}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
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
