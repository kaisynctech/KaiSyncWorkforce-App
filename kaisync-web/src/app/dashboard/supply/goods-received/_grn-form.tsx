'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { roundFinancial } from '@/lib/finance-calc'

interface Po { id: string; po_number: string | null; supplier_id: string | null }
interface Employee { id: string; name: string; surname: string }

interface DraftGrnLine {
  key: string
  id?: string
  po_line_id: string | null
  inventory_item_id: string | null
  description: string
  unit: string
  quantity_expected: string
  quantity_received: string
  unit_cost: string
  condition_notes: string
}

let lc = 0
function nk() { return `g${++lc}` }

export default function GrnForm({ grnId }: { grnId?: string }) {
  const isNew = !grnId
  const router = useRouter()
  const searchParams = useSearchParams()
  const prePoId = searchParams.get('po_id')

  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [grn, setGrn] = useState<{ id: string; grn_number: string | null; status: string; po_id: string | null; received_date: string; notes: string | null } | null>(null)
  const [pos, setPos] = useState<Po[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [lines, setLines] = useState<DraftGrnLine[]>([])
  const [poId, setPoId] = useState(prePoId ?? '')
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10))
  const [receivedBy, setReceivedBy] = useState('')
  const [deliveryNoteNum, setDeliveryNoteNum] = useState('')
  const [notes, setNotes] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const savedId = useRef<string | null>(isNew ? null : (grnId ?? null))

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  async function loadPoLines(selectedPoId: string) {
    if (!selectedPoId) { setLines([]); setSupplierName(''); return }
    const supabase = createClient()
    const [{ data: poData }, { data: supplierData }, { data: poLines }] = await Promise.all([
      supabase.from('purchase_orders').select('id, po_number, supplier_id').eq('id', selectedPoId).maybeSingle(),
      supabase.from('purchase_orders').select('supplier:contractors!purchase_orders_supplier_id_fkey(name)').eq('id', selectedPoId).maybeSingle(),
      supabase.from('purchase_order_lines').select('*').eq('po_id', selectedPoId).order('sort_order'),
    ])
    void poData // used for supplier_id reference
    const suppName = (supplierData as { supplier?: { name: string }[] } | null)?.supplier?.[0]?.name ?? ''
    setSupplierName(suppName)
    setLines((poLines ?? []).map((l: {
      id: string;
      inventory_item_id: string | null;
      description: string;
      unit: string;
      quantity_ordered: number;
      quantity_received: number;
      unit_price: number;
    }) => ({
      key: nk(),
      po_line_id: l.id,
      inventory_item_id: l.inventory_item_id,
      description: l.description,
      unit: l.unit,
      quantity_expected: String(Math.max(0, l.quantity_ordered - l.quantity_received)),
      quantity_received: String(Math.max(0, l.quantity_ordered - l.quantity_received)),
      unit_cost: String(l.unit_price),
      condition_notes: '',
    })))
  }

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    const [{ data: poRows }, { data: empRows }] = await Promise.all([
      supabase.from('purchase_orders').select('id, po_number, supplier_id')
        .eq('company_id', member.companyId).in('status', ['approved', 'sent', 'partially_received']).order('created_at', { ascending: false }),
      supabase.from('employees').select('id, name, surname').eq('company_id', member.companyId).eq('is_active', true).order('name'),
    ])
    setPos((poRows ?? []) as Po[])
    setEmployees((empRows ?? []) as Employee[])

    if (!isNew) {
      const [{ data: grnData }, { data: lineData }] = await Promise.all([
        supabase.from('goods_received_notes').select('*').eq('id', grnId!).maybeSingle(),
        supabase.from('goods_received_lines').select('*').eq('grn_id', grnId!).order('created_at'),
      ])
      if (grnData) {
        const g = grnData as typeof grn
        setGrn(g)
        if (g) {
          setPoId(g.po_id ?? '')
          setReceivedDate(g.received_date)
          setNotes(g.notes ?? '')
        }
      }
      setLines((lineData ?? []).map((l: {
        id: string;
        po_line_id: string | null;
        inventory_item_id: string | null;
        description: string;
        unit: string;
        quantity_expected: number;
        quantity_received: number;
        unit_cost: number;
        condition_notes: string | null;
      }) => ({
        key: nk(), id: l.id,
        po_line_id: l.po_line_id, inventory_item_id: l.inventory_item_id,
        description: l.description, unit: l.unit,
        quantity_expected: String(l.quantity_expected), quantity_received: String(l.quantity_received),
        unit_cost: String(l.unit_cost), condition_notes: l.condition_notes ?? '',
      })))
    } else if (prePoId) {
      setPoId(prePoId)
      await loadPoLines(prePoId)
    }
    setLoading(false)
  }, [isNew, grnId, prePoId])

  useEffect(() => { void load() }, [load])

  function updateLine(key: string, field: string, value: string) {
    setLines(ls => ls.map(l => l.key === key ? { ...l, [field]: value } : l))
  }

  function addLine() {
    setLines(ls => [...ls, { key: nk(), po_line_id: null, inventory_item_id: null, description: '', unit: 'each', quantity_expected: '0', quantity_received: '0', unit_cost: '0', condition_notes: '' }])
  }

  async function save() {
    if (!companyId) return
    setSaving(true)
    setError(null)
    const supabase = createClient()

    let currentId = savedId.current
    if (!currentId) {
      const { data: numData } = await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: string | null }>)('generate_grn_number', { p_company_id: companyId })
      const { data: inserted, error: insErr } = await supabase.from('goods_received_notes').insert({
        company_id: companyId,
        grn_number: numData ?? null,
        po_id: poId || null,
        supplier_id: pos.find(p => p.id === poId)?.supplier_id ?? null,
        received_date: receivedDate,
        received_by: receivedBy || employeeId,
        delivery_note_number: deliveryNoteNum.trim() || null,
        notes: notes.trim() || null,
        status: 'draft',
        created_by: employeeId,
      }).select('id').single()
      if (insErr || !inserted) { setError(insErr?.message ?? 'Failed to create GRN'); setSaving(false); return }
      currentId = (inserted as { id: string }).id
      savedId.current = currentId
    } else {
      await supabase.from('goods_received_notes').update({
        po_id: poId || null,
        received_date: receivedDate,
        received_by: receivedBy || employeeId,
        delivery_note_number: deliveryNoteNum.trim() || null,
        notes: notes.trim() || null,
      }).eq('id', currentId)
    }

    // Upsert lines
    const validLines = lines.filter(l => l.description.trim())
    for (const l of validLines) {
      await supabase.from('goods_received_lines').upsert({
        ...(l.id ? { id: l.id } : {}),
        company_id: companyId,
        grn_id: currentId!,
        po_line_id: l.po_line_id,
        inventory_item_id: l.inventory_item_id,
        description: l.description.trim(),
        unit: l.unit,
        quantity_expected: Number(l.quantity_expected) || 0,
        quantity_received: Number(l.quantity_received) || 0,
        unit_cost: Number(l.unit_cost) || 0,
        condition_notes: l.condition_notes.trim() || null,
      }, { onConflict: 'id' })

      // Update PO line quantity_received
      if (l.po_line_id) {
        const { data: poLine } = await supabase.from('purchase_order_lines').select('quantity_received').eq('id', l.po_line_id).maybeSingle()
        if (poLine) {
          const prevQty = (poLine as { quantity_received: number }).quantity_received
          await supabase.from('purchase_order_lines').update({
            quantity_received: roundFinancial(prevQty + (Number(l.quantity_received) || 0))
          }).eq('id', l.po_line_id)
        }
      }

      // Update inventory quantity_on_hand
      if (l.inventory_item_id) {
        const { data: item } = await supabase.from('inventory_items').select('quantity_on_hand').eq('id', l.inventory_item_id).maybeSingle()
        if (item) {
          const prev = (item as { quantity_on_hand: number }).quantity_on_hand ?? 0
          await supabase.from('inventory_items').update({ quantity_on_hand: roundFinancial(prev + (Number(l.quantity_received) || 0)) }).eq('id', l.inventory_item_id)
        }
      }
    }

    // Update PO status and received value
    if (poId) {
      const { data: allPoLines } = await supabase.from('purchase_order_lines').select('quantity_ordered, quantity_received, unit_price').eq('po_id', poId)
      if (allPoLines && allPoLines.length > 0) {
        const poLinesTyped = allPoLines as { quantity_ordered: number; quantity_received: number; unit_price: number }[]
        const allReceived = poLinesTyped.every(pl => pl.quantity_received >= pl.quantity_ordered)
        const anyReceived = poLinesTyped.some(pl => pl.quantity_received > 0)
        const totalReceived = poLinesTyped.reduce((s, pl) => s + roundFinancial(pl.quantity_received * pl.unit_price), 0)
        const { data: currentPo } = await supabase.from('purchase_orders').select('status').eq('id', poId).maybeSingle()
        const newStatus = allReceived ? 'received' : anyReceived ? 'partially_received' : (currentPo as { status: string } | null)?.status ?? 'sent'
        await supabase.from('purchase_orders').update({ status: newStatus, amount_received_value: roundFinancial(totalReceived), updated_at: new Date().toISOString() }).eq('id', poId)
      }
    }

    // Mark GRN as received
    await supabase.from('goods_received_notes').update({ status: 'received' }).eq('id', currentId!)

    setSaving(false)
    showToast('GRN saved!')
    if (isNew && currentId) router.replace(`/dashboard/supply/goods-received/${currentId}`)
    else void load()
  }

  if (loading) return <p className="p-6 text-[13px] text-text-secondary">Loading…</p>

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => router.push('/dashboard/supply/goods-received')} className="text-text-secondary hover:text-text-primary">
            <span className="material-icons text-[20px]">arrow_back</span>
          </button>
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold text-text-primary truncate">
              {grn?.grn_number ?? 'New Goods Received Note'}
            </h1>
            <p className="text-[12px] text-text-secondary capitalize">{grn?.status ?? 'draft'}</p>
          </div>
        </div>
        <button onClick={save} disabled={saving} className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">
          {saving ? 'Saving…' : 'Save GRN'}
        </button>
      </div>

      {error && <div className="mx-4 mt-2 p-2 rounded bg-error/10 text-error text-[12px]">{error}</div>}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-success text-white px-4 py-2 rounded-lg shadow-lg text-[13px] z-50 pointer-events-none">
          {toast}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 space-y-5">
        {/* Header fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Purchase Order *</label>
            <select className="input h-9 text-[13px] w-full" value={poId}
              onChange={async e => { setPoId(e.target.value); await loadPoLines(e.target.value) }}>
              <option value="">— Select PO —</option>
              {pos.map(p => <option key={p.id} value={p.id}>{p.po_number ?? 'Draft PO'}</option>)}
            </select>
          </div>
          {supplierName && (
            <div>
              <label className="block text-[12px] text-text-secondary mb-1">Supplier</label>
              <input className="input h-9 text-[13px] w-full bg-surface-elevated" value={supplierName} readOnly />
            </div>
          )}
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Received Date</label>
            <input type="date" className="input h-9 text-[13px] w-full" value={receivedDate}
              onChange={e => setReceivedDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Received By</label>
            <select className="input h-9 text-[13px] w-full" value={receivedBy}
              onChange={e => setReceivedBy(e.target.value)}>
              <option value="">— Select employee —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name} {e.surname}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Delivery Note Number</label>
            <input className="input h-9 text-[13px] w-full" value={deliveryNoteNum}
              onChange={e => setDeliveryNoteNum(e.target.value)} placeholder="Supplier's delivery note ref" />
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Notes</label>
            <input className="input h-9 text-[13px] w-full" value={notes}
              onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        {/* Lines */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[13px] font-semibold text-text-primary">Line Items</h2>
            <button onClick={addLine} className="text-[12px] text-primary flex items-center gap-0.5 hover:underline">
              <span className="material-icons text-[16px]">add</span> Add Line
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: 720 }}>
              <thead>
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className="data-th text-left">Description</th>
                  <th className="data-th text-right w-16">Unit</th>
                  <th className="data-th text-right w-24">Expected</th>
                  <th className="data-th text-right w-28">Received</th>
                  <th className="data-th text-right w-28">Unit Cost</th>
                  <th className="data-th text-left">Condition Notes</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr><td colSpan={6} className="data-td text-center text-text-secondary py-6 text-[13px]">
                    {poId ? 'No lines loaded from PO.' : 'Select a PO to load its lines.'}
                  </td></tr>
                ) : lines.map(l => (
                  <tr key={l.key} className="border-b border-divider">
                    <td className="data-td">
                      <input className="input h-8 text-[13px] w-full" value={l.description}
                        onChange={e => updateLine(l.key, 'description', e.target.value)} />
                    </td>
                    <td className="data-td">
                      <input className="input h-8 text-[13px] w-16" value={l.unit}
                        onChange={e => updateLine(l.key, 'unit', e.target.value)} />
                    </td>
                    <td className="data-td">
                      <input type="number" className="input h-8 text-[13px] w-20 text-right bg-surface-elevated" value={l.quantity_expected} readOnly />
                    </td>
                    <td className="data-td">
                      <input type="number" step="0.01" className="input h-8 text-[13px] w-24 text-right" value={l.quantity_received}
                        onChange={e => updateLine(l.key, 'quantity_received', e.target.value)} />
                    </td>
                    <td className="data-td">
                      <input type="number" step="0.01" className="input h-8 text-[13px] w-24 text-right" value={l.unit_cost}
                        onChange={e => updateLine(l.key, 'unit_cost', e.target.value)} />
                    </td>
                    <td className="data-td">
                      <input className="input h-8 text-[13px] w-40" value={l.condition_notes}
                        onChange={e => updateLine(l.key, 'condition_notes', e.target.value)} placeholder="Any issues…" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
