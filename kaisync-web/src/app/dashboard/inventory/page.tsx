'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  inventoryNeedsReorder,
  inventoryStockValue,
  suggestedReorderQty,
} from '@/lib/supply-assets'
import { createDraftSupplierReorderInvoices } from '@/lib/finance-api'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  escapeIlike,
  pageRange,
  totalPages,
} from '@/lib/list-pagination'
import { Toggle } from '@/components/Toggle'
import type { InventoryItem } from '@/types/database'

const fmtR = (n: number) =>
  `R ${(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type InventoryRow = InventoryItem & {
  supplier_partner?: { id: string; name: string } | null
}

function supplierName(item: InventoryRow): string {
  return item.supplier_partner?.name?.trim()
    || (typeof item.supplier === 'string' ? item.supplier.trim() : '')
    || '—'
}

export default function InventoryPage() {
  const router = useRouter()
  const [items, setItems] = useState<InventoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busyReorder, setBusyReorder] = useState(false)
  const [reorderMsg, setReorderMsg] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [actorName, setActorName] = useState<string | null>(null)
  const [lowBannerCount, setLowBannerCount] = useState(0)

  const canEdit = can(perms, PERM.inventoryEdit)

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(1) }, [searchDebounced, lowStockOnly, pageSize])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    const [meRes, lowCountRes] = await Promise.all([
      supabase.from('employees').select('name, surname, access_level').eq('id', member.employeeId).maybeSingle(),
      supabase
        .from('inventory_items')
        .select('id, quantity_on_hand, reorder_level')
        .eq('company_id', member.companyId)
        .eq('is_active', true),
    ])
    const permSet = await loadPermissions(supabase, member.companyId, meRes.data?.access_level)
    setPerms(permSet)
    if (meRes.data) setActorName(`${meRes.data.name ?? ''} ${meRes.data.surname ?? ''}`.trim() || null)
    const lowAll = ((lowCountRes.data ?? []) as { quantity_on_hand: number; reorder_level: number }[])
      .filter(i => inventoryNeedsReorder(i.quantity_on_hand, i.reorder_level))
    setLowBannerCount(lowAll.length)

    const { from, to } = pageRange(page, pageSize)
    let query = supabase
      .from('inventory_items')
      .select('*, supplier_partner:contractors!supplier_contractor_id(id, name)', { count: 'exact' })
      .eq('company_id', member.companyId)
      .order('name')

    if (searchDebounced) {
      const q = escapeIlike(searchDebounced)
      query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
    }

    // Low-stock: fetch a wider window then filter (column-to-column compare not in PostgREST)
    if (lowStockOnly) {
      const { data, error: qErr } = await query.limit(500)
      if (qErr) {
        setError(qErr.message)
        setItems([])
        setTotal(0)
      } else {
        const filtered = ((data ?? []) as InventoryRow[])
          .filter(i => inventoryNeedsReorder(i.quantity_on_hand, i.reorder_level))
        setTotal(filtered.length)
        setItems(filtered.slice(from, from + pageSize))
      }
    } else {
      const { data, error: qErr, count } = await query.range(from, to)
      if (qErr) {
        setError(qErr.message)
        setItems([])
        setTotal(0)
      } else {
        setItems((data ?? []) as InventoryRow[])
        setTotal(count ?? 0)
      }
    }

    setSelected(new Set())
    setLoading(false)
  }, [page, pageSize, searchDebounced, lowStockOnly])

  useEffect(() => { void load() }, [load])

  const pages = totalPages(total, pageSize)
  const selectableOnPage = useMemo(
    () => items.filter(i =>
      inventoryNeedsReorder(i.quantity_on_hand, i.reorder_level) && !!i.supplier_contractor_id,
    ),
    [items],
  )

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllLowOnPage() {
    setSelected(new Set(selectableOnPage.map(i => i.id)))
  }

  async function createReorderDrafts() {
    if (!companyId || !canEdit) return
    const chosen = items.filter(i => selected.has(i.id) && i.supplier_contractor_id)
    if (chosen.length === 0) {
      setReorderMsg('Select low-stock items that have a preferred supplier.')
      return
    }
    setBusyReorder(true)
    setReorderMsg(null)
    setError(null)
    try {
      const supabase = createClient()
      const lines = chosen.map(i => ({
        inventoryItemId: i.id,
        description: [i.name, i.sku].filter(Boolean).join(' · '),
        quantity: suggestedReorderQty(i.quantity_on_hand, i.reorder_level),
        unitCost: Number(i.unit_cost ?? 0),
        supplierId: i.supplier_contractor_id as string,
      })).filter(l => l.quantity > 0)

      const { invoiceIds, skippedNoSupplier } = await createDraftSupplierReorderInvoices(supabase, {
        companyId,
        actorId: employeeId,
        actorName,
        lines,
      })

      setReorderMsg(
        `Created ${invoiceIds.length} draft invoice${invoiceIds.length === 1 ? '' : 's'}`
        + (skippedNoSupplier ? ` · ${skippedNoSupplier} skipped (no supplier)` : ''),
      )
      setSelected(new Set())
      if (invoiceIds.length === 1) {
        router.push(`/dashboard/finance/supplier-invoices/${invoiceIds[0]}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create draft invoices')
    } finally {
      setBusyReorder(false)
    }
  }

  if (error === 'not_linked') return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
      </div>
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-sm bg-surface border border-border rounded-lg px-2">
          <span className="material-icons text-text-secondary text-[16px]">search</span>
          <input
            placeholder="Search name or SKU…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-text-primary text-[13px] h-[38px] outline-none placeholder:text-text-disabled"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => void load()} className="bg-surface-dark rounded-md h-9 w-9 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons text-[18px]">refresh</span>
          </button>
          {canEdit && (
            <button onClick={() => router.push('/dashboard/inventory/new')} className="btn-primary h-9 px-3 text-[13px]">
              + Add Item
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-b border-divider shrink-0 bg-surface-dark gap-3 flex-wrap">
        <p className="text-text-secondary text-sm">
          {total === 0 ? '0 items' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1 text-[12px] text-text-secondary">
            Page size
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              className="dark-entry h-8 text-[12px] py-0"
            >
              {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-text-secondary text-sm">Low stock only</span>
            <Toggle checked={lowStockOnly} onChange={setLowStockOnly} />
          </div>
        </div>
      </div>

      {error && error !== 'not_linked' && (
        <p className="mx-4 mt-2 text-[12px] text-error">{error}</p>
      )}
      {reorderMsg && (
        <p className="mx-4 mt-2 text-[12px] text-green-700 bg-green-50 px-3 py-2 rounded">{reorderMsg}</p>
      )}

      {lowBannerCount > 0 && (
        <div className="mx-4 mt-2 mb-1 px-3 py-2 rounded-lg border border-[#F87171] bg-[#FEF2F2] flex items-center justify-between gap-2 shrink-0 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="material-icons text-[16px]" style={{ color: '#F87171' }}>warning</span>
            <p className="text-[12px] font-medium" style={{ color: '#B91C1C' }}>
              {lowBannerCount} item{lowBannerCount !== 1 ? 's' : ''} below reorder level
            </p>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={selectAllLowOnPage} className="text-[12px] text-primary hover:underline">
                Select low on page ({selectableOnPage.length})
              </button>
              <button
                type="button"
                disabled={selected.size === 0 || busyReorder}
                onClick={() => void createReorderDrafts()}
                className="btn-primary h-8 px-3 text-[12px] disabled:opacity-50"
              >
                {busyReorder ? 'Creating…' : `Draft reorder (${selected.size})`}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto">
          <table style={{ minWidth: 1080 }} className="w-full">
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                {canEdit && <th style={{ width: 40 }} className="data-th" />}
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
                <tr><td colSpan={9} className="text-center py-10 text-text-secondary text-[13px]">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-text-secondary text-[13px]">No inventory items found.</td></tr>
              ) : (
                items.map(item => {
                  const low = inventoryNeedsReorder(item.quantity_on_hand, item.reorder_level)
                  const value = inventoryStockValue(item.quantity_on_hand, item.unit_cost)
                  const canSelect = low && !!item.supplier_contractor_id
                  return (
                    <tr
                      key={item.id}
                      onClick={() => router.push(`/dashboard/inventory/${item.id}`)}
                      className="border-b border-divider cursor-pointer hover:opacity-90 transition-opacity"
                      style={{ backgroundColor: low ? '#FEF2F2' : 'var(--color-surface-card)' }}
                    >
                      {canEdit && (
                        <td className="data-td" onClick={e => canSelect && toggleSelect(item.id, e)}>
                          <input
                            type="checkbox"
                            disabled={!canSelect}
                            checked={selected.has(item.id)}
                            onChange={() => {}}
                            className="accent-primary"
                            title={canSelect ? 'Select for reorder' : 'Needs preferred supplier + low stock'}
                          />
                        </td>
                      )}
                      <td className="data-td text-text-primary text-sm font-medium">{item.name}</td>
                      <td className="data-td text-text-secondary text-sm">{item.sku ?? '—'}</td>
                      <td className="data-td text-sm">
                        {supplierName(item)}
                        {low && !item.supplier_contractor_id && (
                          <Link
                            href={`/dashboard/inventory/${item.id}`}
                            onClick={e => e.stopPropagation()}
                            className="block text-[11px] text-primary"
                          >
                            Set supplier
                          </Link>
                        )}
                      </td>
                      <td className="data-td text-sm text-right">{item.quantity_on_hand}</td>
                      <td className="data-td text-text-secondary text-sm">{item.unit_of_measure ?? '—'}</td>
                      <td className="data-td text-sm text-right">{fmtR(item.unit_cost)}</td>
                      <td className="data-td text-sm text-right">{fmtR(value)}</td>
                      <td className="data-td text-center">
                        {low
                          ? <span className="text-sm font-medium" style={{ color: '#F87171' }}>Low</span>
                          : <span className="text-sm" style={{ color: '#9CA3AF' }}>OK</span>
                        }
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-t border-divider shrink-0">
        <button
          disabled={page <= 1}
          onClick={() => setPage(p => Math.max(1, p - 1))}
          className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40"
        >
          Previous
        </button>
        <span className="text-[12px] text-text-secondary">Page {page} of {pages}</span>
        <button
          disabled={page >= pages}
          onClick={() => setPage(p => p + 1)}
          className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}
