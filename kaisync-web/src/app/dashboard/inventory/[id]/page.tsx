'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { isSupplierKind } from '@/lib/partner-kinds'
import { inventoryStockValue } from '@/lib/supply-assets'
import { Toggle } from '@/components/Toggle'
import type { InventoryItem } from '@/types/database'

const fmtR = (n: number) =>
  `R ${(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

interface SupplierOption { id: string; name: string }

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
  const [showAllocate, setShowAllocate] = useState(false)
  const [openJobs, setOpenJobs] = useState<{ id: string; title: string }[]>([])
  const [selectedJobId, setSelectedJobId] = useState('')
  const [allocateQty, setAllocateQty] = useState('1')
  const [allocating, setAllocating] = useState(false)

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

  useEffect(() => {
    void bootstrap()
  }, [itemId])

  async function bootstrap() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

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

    if (!isNew) await loadItem()
    else setLoading(false)
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

  async function openAllocateModal() {
    if (!companyId) return
    const supabase = createClient()
    const { data } = await supabase
      .from('jobs')
      .select('id, title')
      .eq('company_id', companyId)
      .in('status', ['open', 'scheduled', 'in_progress'])
      .order('created_at', { ascending: false })
    setOpenJobs((data ?? []) as { id: string; title: string }[])
    setSelectedJobId('')
    setAllocateQty('1')
    setShowAllocate(true)
  }

  async function doAllocate() {
    if (!selectedJobId || !companyId || !employeeId) {
      setError('Missing company or employee context for allocation.')
      return
    }
    const qty = parseFloat(allocateQty)
    if (!qty || qty <= 0) { setError('Enter a valid quantity.'); return }
    setAllocating(true)
    setError(null)
    const supabase = createClient()
    const { error: e } = await supabase.rpc('hr_allocate_inventory_to_job', {
      p_company_id: companyId,
      p_job_id: selectedJobId,
      p_employee_id: employeeId,
      p_inventory_item_id: itemId,
      p_quantity: qty,
      p_unit_cost: parseFloat(unitCost) || 0,
    })
    if (e) { setError(e.message); setAllocating(false); return }
    setQuantityOnHand(prev => String(Math.max(0, (parseFloat(prev) || 0) - qty)))
    setShowAllocate(false)
    setAllocating(false)
  }

  async function save() {
    if (!name.trim()) { setError('Item name is required.'); return }
    if (!companyId) { setError('Company context missing.'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()

    const payload = {
      name: name.trim(),
      sku: sku.trim() || null,
      description: description.trim() || null,
      unit_of_measure: unitOfMeasure.trim() || 'each',
      unit_cost: parseFloat(unitCost) || 0,
      selling_price: sellingPrice ? parseFloat(sellingPrice) : 0,
      quantity_on_hand: parseFloat(quantityOnHand) || 0,
      reorder_level: parseFloat(reorderLevel) || 0,
      is_active: isActive,
      supplier_contractor_id: supplierContractorId || null,
    }

    if (isNew) {
      const { data: nc, error: e } = await supabase
        .from('inventory_items')
        .insert({ ...payload, company_id: companyId })
        .select()
        .single()
      if (e) { setError(e.message); setSaving(false); return }
      router.push(`/dashboard/inventory/${nc.id}`)
    } else {
      const { error: e } = await supabase.from('inventory_items').update(payload).eq('id', itemId)
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

  return (
    <div className="h-full flex flex-col">
      <div className="grid grid-cols-[1fr_auto] items-center px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/dashboard/inventory" className="text-text-secondary hover:text-text-primary transition-colors shrink-0">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <h1 className="text-[20px] font-semibold text-text-primary truncate">{name || (isNew ? 'New Item' : 'Item')}</h1>
        </div>
        <button onClick={() => void save()} disabled={saving}
          className="h-11 px-5 text-[16px] font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors min-w-[80px]">
          {saving ? 'Saving…' : 'Save'}
        </button>
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
          {suppliers.length === 0 && (
            <p className="text-[12px] text-text-secondary">No suppliers yet. Add one in Suppliers first.</p>
          )}
        </div>

        <div className="card p-4 space-y-3">
          <p className="section-label">STOCK</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-secondary">Quantity on hand</label>
              <input type="number" value={quantityOnHand} onChange={e => setQuantityOnHand(e.target.value)} className="dark-entry" />
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

        {!isNew && (
          <button onClick={() => void openAllocateModal()} className="btn-outlined w-full h-11 text-[13px]">
            Allocate stock to open job
          </button>
        )}
      </div>

      {showAllocate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">Allocate to Job</h3>
            <select value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)}
              className="dark-entry w-full appearance-none">
              <option value="">Select job…</option>
              {openJobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
            {openJobs.length === 0 && (
              <p className="text-text-secondary text-[12px]">No open jobs found for this company.</p>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Quantity</label>
              <input type="number" value={allocateQty} onChange={e => setAllocateQty(e.target.value)}
                min="1" step="any" className="dark-entry w-full" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAllocate(false)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
              <button onClick={() => void doAllocate()} disabled={!selectedJobId || allocating}
                className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">
                {allocating ? 'Allocating…' : 'Allocate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
