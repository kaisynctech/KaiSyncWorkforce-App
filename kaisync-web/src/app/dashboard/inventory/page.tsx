'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { Toggle } from '@/components/Toggle'
import type { InventoryItem } from '@/types/database'

const fmtR = (n: number) =>
  `R ${(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function InventoryPage() {
  const router = useRouter()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }

    const { data } = await supabase
      .from('inventory_items')
      .select('*, supplier:suppliers(id, name)')
      .eq('company_id', member.companyId)
      .order('name')

    setItems((data ?? []) as InventoryItem[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = items.filter(item => {
    if (lowStockOnly && !item.needs_reorder) return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !item.name.toLowerCase().includes(q) &&
        !(item.sku ?? '').toLowerCase().includes(q) &&
        !(item.supplier?.name ?? '').toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  if (error === 'not_linked') return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
        <p className="text-[13px] text-text-secondary">
          Your account is not linked to an active employee record.<br/>
          Please contact your administrator.
        </p>
      </div>
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-2 flex-1 max-w-sm bg-surface border border-border rounded-lg px-2">
          <span className="material-icons text-text-secondary text-[16px]">search</span>
          <input
            placeholder="Search inventory..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-text-primary text-[13px] h-[38px] outline-none placeholder:text-text-disabled"
          />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="bg-surface-dark rounded-md h-9 w-9 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons text-[18px]">refresh</span>
          </button>
          <button onClick={() => router.push('/dashboard/inventory/new')} className="btn-primary h-9 px-3 text-[13px]">
            + Add Item
          </button>
        </div>
      </div>

      {/* Sub-header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-divider shrink-0 bg-surface-dark">
        <p className="text-text-secondary text-sm">{filtered.length} items</p>
        <div className="flex items-center gap-2">
          <span className="text-text-secondary text-sm">Low stock only</span>
          <Toggle checked={lowStockOnly} onChange={setLowStockOnly} />
        </div>
      </div>

      {/* Low stock banner */}
      {(() => {
        const lowItems = items.filter(i => i.needs_reorder)
        if (lowItems.length === 0) return null
        return (
          <div className="mx-4 mt-2 mb-1 px-3 py-2 rounded-lg border border-[#F87171] bg-[#FEF2F2] flex items-center gap-2 shrink-0">
            <span className="material-icons text-[16px]" style={{ color: '#F87171' }}>warning</span>
            <p className="text-[12px] font-medium" style={{ color: '#B91C1C' }}>
              {lowItems.length} item{lowItems.length !== 1 ? 's' : ''} below reorder level:{' '}
              {lowItems.slice(0, 3).map(i => i.name).join(', ')}
              {lowItems.length > 3 ? ` +${lowItems.length - 3} more` : ''}
            </p>
          </div>
        )
      })()}

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto">
          <table style={{ minWidth: 1020 }} className="w-full">
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th style={{ width: 160 }} className="data-th">Item</th>
                <th style={{ width: 80 }}  className="data-th">SKU</th>
                <th style={{ width: 140 }} className="data-th">Supplier</th>
                <th style={{ width: 90 }}  className="data-th text-right">On hand</th>
                <th style={{ width: 90 }}  className="data-th">Unit</th>
                <th style={{ width: 100 }} className="data-th text-right">Unit cost</th>
                <th style={{ width: 100 }} className="data-th text-right">Stock value</th>
                <th style={{ width: 70 }}  className="data-th text-center">Alert</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-text-secondary text-[13px]">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-text-secondary text-[13px]">No inventory items found.</td></tr>
              ) : (
                filtered.map(item => (
                  <tr
                    key={item.id}
                    onClick={() => router.push(`/dashboard/inventory/${item.id}`)}
                    className="border-b border-divider cursor-pointer hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: item.needs_reorder ? '#FEF2F2' : 'var(--color-surface-card)' }}
                  >
                    <td className="data-td text-text-primary text-sm font-medium">{item.name}</td>
                    <td className="data-td text-text-secondary text-sm">{item.sku ?? '—'}</td>
                    <td className="data-td text-sm">{item.supplier?.name ?? '—'}</td>
                    <td className="data-td text-sm text-right">{item.quantity_on_hand}</td>
                    <td className="data-td text-text-secondary text-sm">{item.unit_of_measure ?? '—'}</td>
                    <td className="data-td text-sm text-right">{fmtR(item.unit_cost)}</td>
                    <td className="data-td text-sm text-right">{fmtR(item.stock_value)}</td>
                    <td className="data-td text-center">
                      {item.needs_reorder
                        ? <span className="text-sm font-medium" style={{ color: '#F87171' }}>Low</span>
                        : <span className="text-sm" style={{ color: '#9CA3AF' }}>OK</span>
                      }
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
