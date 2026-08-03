'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { isSupplierKind } from '@/lib/partner-kinds'
import { inventoryStockValue, stockMovementLabel, type StockMovementType } from '@/lib/supply-assets'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { Toggle } from '@/components/Toggle'
import type { InventoryItem, InventoryStockMovement } from '@/types/database'

const fmtR = (n: number) =>
  `R ${(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDT = (d: string) =>
  new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(d))

interface SupplierOption { id: string; name: string }

type StockModal = 'receive' | 'adjust' | 'return' | 'allocate' | null

export default function InventoryDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const itemId = params.id
  const isNew = itemId === 'new'

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)

  const [stockModal, setStockModal] = useState<StockModal>(null)
  const [openJobs, setOpenJobs] = useState<{ id: string; title: string }[]>([])
  const [selectedJobId, setSelectedJobId] = useState('')
  const [moveQty, setMoveQty] = useState('1')
  const [moveNote, setMoveNote] = useState('')
  const [moving, setMoving] = useState(false)

  const [movements, setMovements] = useState<InventoryStockMovement[]>([])
  const [movementsLoading, setMovementsLoading] = useState(false)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const canEdit = can(perms, PERM.inventoryEdit)

  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [description, setDescription] = useState('')
  const [unitOfMeasure, setUnitOfMeasure] = useState('each')
  const [unitCost, setUnitCost] = useState('')
  const [sellingPrice, setSellingPrice] = useState('')
  const [quantityOnHand, setQuantityOnHand] = useState('')
  const [reorderLevel, setReorderLevel] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [supplierContractorId, setSupplierContractorId] = useState('')

  const stockValuePreview = (() => {
    const value = inventoryStockValue(parseFloat(quantityOnHand) || 0, parseFloat(unitCost) || 0)
    return `Stock value: ${fmtR(value)}`
  })()

  const loadMovements = useCallback(async () => {
    if (isNew) return
    setMovementsLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('inventory_stock_movements')
      .select('*, employees(name, surname), jobs(id, title)')
      .eq('item_id', itemId)
      .order('created_at', { ascending: false })
      .limit(50)
    setMovements((data ?? []) as InventoryStockMovement[])
    setMovementsLoading(false)
  }, [itemId, isNew])

  useEffect(() => {
    void bootstrap()
  }, [itemId])

  async function bootstrap() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)
    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

    const { data: partners } = await supabase
      .from('contractors')
      .select('id, name, partner_kind, is_supplier')
      .eq('company_id', member.companyId)
      .eq('is_active', true)
      .order('name')

    const supplierRows = ((partners ?? []) as {
      id: string
      name: string
      partner_kind?: string | null
      is_supplier?: boolean
    }[]).filter(c => isSupplierKind(c.partner_kind) || c.is_supplier === true)

    setSuppliers(supplierRows.map(s => ({ id: s.id, name: s.name })))

    if (!isNew) {
      await loadItem()
      await loadMovements()
    } else {
      setLoading(false)
    }
  }

  async function loadItem() {
    setLoading(true)
    const supabase = createClient()
    const { data, error: qErr } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('id', itemId)
      .single()

    if (qErr || !data) {
      setError(qErr?.message ?? 'Item not found')
      router.push('/dashboard/inventory')
      return
    }

    const item = data as InventoryItem
    setName(item.name)
    setSku(item.sku ?? '')
    setDescription(item.description ?? '')
    setUnitOfMeasure(item.unit_of_measure ?? 'each')
    setUnitCost(String(item.unit_cost ?? ''))
    setSellingPrice(String(item.selling_price ?? ''))
    setQuantityOnHand(String(item.quantity_on_hand ?? ''))
    setReorderLevel(String(item.reorder_level ?? ''))
    setIsActive(item.is_active ?? true)
    setSupplierContractorId(item.supplier_contractor_id ?? '')
    setLoading(false)
  }

  async function openStockModal(kind: Exclude<StockModal, null>) {
    setError(null)
    setMoveQty(kind === 'adjust' ? '0' : '1')
    setMoveNote('')
    setSelectedJobId('')
    if (kind === 'allocate' || kind === 'return') {
      if (!companyId) return
      const supabase = createClient()
      const { data } = await supabase
        .from('jobs')
        .select('id, title')
        .eq('company_id', companyId)
        .in('status', ['open', 'scheduled', 'in_progress', 'completed'])
        .order('created_at', { ascending: false })
        .limit(100)
      setOpenJobs((data ?? []) as { id: string; title: string }[])
    }
    setStockModal(kind)
  }

  async function submitStockMovement() {
    if (!companyId || !employeeId || !stockModal) {
      setError('Missing company or employee context.')
      return
    }
    const qty = parseFloat(moveQty)
    if (!Number.isFinite(qty) || qty === 0) {
      setError('Enter a non-zero quantity.')
      return
    }
    if (stockModal === 'allocate' && !selectedJobId) {
      setError('Select a job to allocate to.')
      return
    }
    if (stockModal !== 'adjust' && qty < 0) {
      setError('Quantity must be positive for this action.')
      return
    }

    setMoving(true)
    setError(null)
    const supabase = createClient()

    // Allocate keeps dedicated RPC (also writes movement ledger after migration)
    if (stockModal === 'allocate') {
      const { data, error: e } = await supabase.rpc('hr_allocate_inventory_to_job', {
        p_company_id: companyId,
        p_job_id: selectedJobId,
        p_employee_id: employeeId,
        p_inventory_item_id: itemId,
        p_quantity: Math.abs(qty),
        p_unit_cost: parseFloat(unitCost) || 0,
      })
      if (e) { setError(e.message); setMoving(false); return }
      const updated = data as InventoryItem | null
      if (updated?.quantity_on_hand != null) setQuantityOnHand(String(updated.quantity_on_hand))
      else setQuantityOnHand(prev => String(Math.max(0, (parseFloat(prev) || 0) - Math.abs(qty))))
    } else {
      const { data, error: e } = await supabase.rpc('hr_inventory_stock_movement', {
        p_company_id: companyId,
        p_item_id: itemId,
        p_type: stockModal as StockMovementType,
        p_quantity: stockModal === 'adjust' ? qty : Math.abs(qty),
        p_actor_employee_id: employeeId,
        p_job_id: stockModal === 'return' && selectedJobId ? selectedJobId : null,
        p_note: moveNote.trim() || null,
        p_unit_cost: parseFloat(unitCost) || null,
      })
      if (e) { setError(e.message); setMoving(false); return }
      const updated = data as InventoryItem | null
      if (updated?.quantity_on_hand != null) setQuantityOnHand(String(updated.quantity_on_hand))
    }

    setStockModal(null)
    setMoving(false)
    await loadMovements()
  }

  async function save() {
    if (!name.trim()) { setError('Item name is required.'); return }
    if (!companyId) { setError('Company context missing.'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()

    // Existing items: never write quantity_on_hand (RPC-only after Wave 2 migration)
    const base = {
      name: name.trim(),
      sku: sku.trim() || null,
      description: description.trim() || null,
      unit_of_measure: unitOfMeasure.trim() || 'each',
      unit_cost: parseFloat(unitCost) || 0,
      selling_price: sellingPrice ? parseFloat(sellingPrice) : 0,
      reorder_level: parseFloat(reorderLevel) || 0,
      is_active: isActive,
      supplier_contractor_id: supplierContractorId || null,
    }

    if (isNew) {
      const opening = parseFloat(quantityOnHand) || 0
      const { data: nc, error: e } = await supabase
        .from('inventory_items')
        .insert({ ...base, company_id: companyId, quantity_on_hand: opening })
        .select()
        .single()
      if (e) { setError(e.message); setSaving(false); return }
      router.push(`/dashboard/inventory/${nc.id}`)
    } else {
      const { error: e } = await supabase.from('inventory_items').update(base).eq('id', itemId)
      if (e) setError(e.message)
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-secondary text-[13px]">Loading…</span>
      </div>
    )
  }

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

  const modalTitle =
    stockModal === 'receive' ? 'Receive stock'
      : stockModal === 'adjust' ? 'Adjust stock'
        : stockModal === 'return' ? 'Return stock'
          : stockModal === 'allocate' ? 'Allocate to job'
            : ''

  return (
    <div className="h-full flex flex-col">
      <div className="grid grid-cols-[1fr_auto] items-center px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/dashboard/inventory" className="text-text-secondary hover:text-text-primary transition-colors shrink-0">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <h1 className="text-[20px] font-semibold text-text-primary truncate">{name || (isNew ? 'New Item' : 'Item')}</h1>
        </div>
        {canEdit && (
          <button onClick={() => void save()} disabled={saving}
            className="h-11 px-5 text-[16px] font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors min-w-[80px]">
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>

      {error && error !== 'not_linked' && <p className="px-4 py-2 text-error text-[13px] shrink-0">{error}</p>}

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
        <div className="card p-4 space-y-3">
          <p className="section-label">ITEM DETAILS</p>
          <input placeholder="Item name *" value={name} onChange={e => setName(e.target.value)} className="dark-entry w-full" />
          <input placeholder="SKU / code" value={sku} onChange={e => setSku(e.target.value)} className="dark-entry w-full" />
          <textarea placeholder="Description" value={description} onChange={e => setDescription(e.target.value)}
            rows={3} className="dark-entry w-full min-h-[64px] py-2 resize-none" />
          <input placeholder="Unit (each, box, kg…)" value={unitOfMeasure} onChange={e => setUnitOfMeasure(e.target.value)} className="dark-entry w-full" />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-secondary">Unit cost (R)</label>
              <input type="number" value={unitCost} onChange={e => setUnitCost(e.target.value)} className="dark-entry" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-secondary">Selling price (R)</label>
              <input type="number" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} className="dark-entry" />
            </div>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <p className="section-label">SUPPLIER</p>
          <p className="text-text-secondary text-[11px]">
            Link a supplier from the Suppliers module (separate from contractors who do field work).
          </p>
          <div className="flex items-center gap-2">
            <select value={supplierContractorId} onChange={e => setSupplierContractorId(e.target.value)} className="dark-entry flex-1 appearance-none">
              <option value="">Select supplier…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button
              type="button"
              onClick={() => router.push('/dashboard/suppliers/new')}
              className="text-primary text-sm px-2 hover:opacity-70 transition-opacity whitespace-nowrap"
            >
              + New supplier
            </button>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <p className="section-label">STOCK</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-secondary">
                {isNew ? 'Opening quantity' : 'Quantity on hand'}
              </label>
              <input
                type="number"
                value={quantityOnHand}
                onChange={e => setQuantityOnHand(e.target.value)}
                readOnly={!isNew}
                className={`dark-entry ${!isNew ? 'opacity-80 cursor-default' : ''}`}
              />
              {!isNew && (
                <p className="text-[11px] text-text-secondary">Change stock with Receive / Adjust / Return / Allocate.</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-secondary">Reorder level</label>
              <input type="number" value={reorderLevel} onChange={e => setReorderLevel(e.target.value)} className="dark-entry" />
            </div>
          </div>
          <p className="text-text-primary text-sm">{stockValuePreview}</p>
          <div className="flex items-center justify-between">
            <span className="text-text-primary text-sm">Active item</span>
            <Toggle checked={isActive} onChange={setIsActive} activeColor="#16A34A" />
          </div>
        </div>

        {!isNew && canEdit && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => void openStockModal('receive')} className="btn-outlined h-11 text-[13px]">Receive</button>
            <button onClick={() => void openStockModal('adjust')} className="btn-outlined h-11 text-[13px]">Adjust</button>
            <button onClick={() => void openStockModal('return')} className="btn-outlined h-11 text-[13px]">Return</button>
            <button onClick={() => void openStockModal('allocate')} className="btn-primary h-11 text-[13px]">Allocate to job</button>
          </div>
        )}

        {!isNew && (
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-label mb-0">MOVEMENT HISTORY</p>
              <button onClick={() => void loadMovements()} className="text-[12px] text-primary hover:opacity-70">Refresh</button>
            </div>
            {movementsLoading ? (
              <p className="text-text-secondary text-[13px]">Loading…</p>
            ) : movements.length === 0 ? (
              <p className="text-text-secondary text-[13px]">
                No movements yet. Apply the stock-movements migration, then Receive / Adjust / Return / Allocate.
              </p>
            ) : (
              <div className="space-y-2">
                {movements.map(m => {
                  const actor = m.employees
                    ? `${m.employees.name ?? ''} ${m.employees.surname ?? ''}`.trim()
                    : null
                  return (
                    <div key={m.id} className="border-b border-divider pb-2 last:border-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-text-primary">
                          {stockMovementLabel(m.movement_type)}
                        </span>
                        <span className={`text-[13px] font-semibold ${m.quantity >= 0 ? 'text-green-600' : 'text-error'}`}>
                          {m.quantity > 0 ? '+' : ''}{m.quantity}
                        </span>
                      </div>
                      <p className="text-[11px] text-text-secondary">
                        {m.quantity_before} → {m.quantity_after}
                        {m.jobs?.title ? ` · ${m.jobs.title}` : ''}
                        {actor ? ` · ${actor}` : ''}
                        {' · '}{fmtDT(m.created_at)}
                      </p>
                      {m.note && <p className="text-[11px] text-text-secondary mt-0.5">{m.note}</p>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {stockModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">{modalTitle}</h3>
            {(stockModal === 'allocate' || stockModal === 'return') && (
              <>
                <select value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)}
                  className="dark-entry w-full appearance-none">
                  <option value="">
                    {stockModal === 'allocate' ? 'Select job…' : 'Job (optional for warehouse return)…'}
                  </option>
                  {openJobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
                </select>
                {stockModal === 'return' && (
                  <p className="text-[11px] text-text-secondary">
                    With a job selected, usage on that job is reduced. Without a job, stock is returned to warehouse only.
                  </p>
                )}
              </>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">
                {stockModal === 'adjust' ? 'Delta (+ increase / − decrease)' : 'Quantity'}
              </label>
              <input type="number" value={moveQty} onChange={e => setMoveQty(e.target.value)}
                step="any" className="dark-entry w-full" />
            </div>
            {stockModal !== 'allocate' && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">Note (optional)</label>
                <input value={moveNote} onChange={e => setMoveNote(e.target.value)} className="dark-entry w-full" />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setStockModal(null)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
              <button
                onClick={() => void submitStockMovement()}
                disabled={moving || (stockModal === 'allocate' && !selectedJobId)}
                className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50"
              >
                {moving ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
