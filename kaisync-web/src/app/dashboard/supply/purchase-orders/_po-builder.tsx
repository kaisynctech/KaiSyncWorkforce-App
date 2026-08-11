'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney, roundFinancial } from '@/lib/finance-calc'
import type { PurchaseOrder, PurchaseOrderLine, ThreeWayMatchLine } from '@/types/commercial'

interface Supplier { id: string; name: string; email: string | null }
interface Deal { id: string; title: string }
interface Rfq { id: string; rfq_number: string | null; title: string }

interface DraftLine {
  key: string
  id?: string
  description: string
  unit: string
  quantity_ordered: string
  unit_price: string
  vat_rate: string
}

interface GrnSummary { id: string; grn_number: string | null; received_date: string; status: string }

interface SupplierInvRow { id: string; invoice_number: string | null; total_amount: number; status: string }

let lc = 0
function nk() { return `p${++lc}` }

export default function PoBuilder({ poId }: { poId?: string }) {
  const isNew = !poId
  const routeId = poId
  const router = useRouter()
  const searchParams = useSearchParams()
  const preRfqId = searchParams.get('rfq_id')
  const preRecipientId = searchParams.get('recipient_id')
  const preSupplier = searchParams.get('supplier_id')

  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [po, setPo] = useState<PurchaseOrder | null>(null)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [grns, setGrns] = useState<GrnSummary[]>([])
  const [matchLines, setMatchLines] = useState<ThreeWayMatchLine[]>([])
  const [supplierInvs, setSupplierInvs] = useState<SupplierInvRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [tab, setTab] = useState<'details' | 'match'>('details')
  const [canApprove, setCanApprove] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [showLinkInvModal, setShowLinkInvModal] = useState(false)

  // Fields
  const [supplierId, setSupplierId] = useState(preSupplier ?? '')
  const [dealId, setDealId] = useState('')
  const [rfqId, setRfqId] = useState(preRfqId ?? '')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [requiredDate, setRequiredDate] = useState('')
  const [terms, setTerms] = useState('')
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [rfqs, setRfqs] = useState<Rfq[]>([])

  const savedId = useRef<string | null>(isNew ? null : (routeId ?? null))

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    const [{ data: supps }, { data: dls }, { data: rfqRows }, { data: approveData }] = await Promise.all([
      supabase.from('contractors').select('id, name, email').eq('company_id', member.companyId).eq('partner_kind', 'supplier').eq('is_active', true).order('name'),
      supabase.from('client_deals').select('id, title').eq('company_id', member.companyId).order('title'),
      supabase.from('rfqs').select('id, rfq_number, title').eq('company_id', member.companyId).order('created_at', { ascending: false }),
      supabase.rpc('user_has_permission', { p_company_id: member.companyId, p_key: 'purchase_orders.approve' }),
    ])
    setSuppliers((supps ?? []) as Supplier[])
    setDeals((dls ?? []) as Deal[])
    setRfqs((rfqRows ?? []) as Rfq[])
    setCanApprove(Boolean(approveData))

    if (!isNew) {
      const currentPoId = savedId.current!
      const [{ data: poData }, { data: lineData }, { data: grnData }, { data: matchData }, { data: invData }] = await Promise.all([
        supabase.from('purchase_orders').select('*, supplier:contractors!purchase_orders_supplier_id_fkey(id, name, email)').eq('id', currentPoId).maybeSingle(),
        supabase.from('purchase_order_lines').select('*').eq('po_id', currentPoId).order('sort_order'),
        supabase.from('goods_received_notes').select('id, grn_number, received_date, status').eq('po_id', currentPoId).order('received_date', { ascending: false }),
        supabase.from('po_three_way_match').select('*').eq('po_id', currentPoId),
        supabase.from('supplier_invoices').select('id, invoice_number, total_amount, status').eq('company_id', member.companyId).eq('po_id', currentPoId),
      ])
      if (poData) {
        const p = poData as PurchaseOrder
        setPo(p)
        setSupplierId(p.supplier_id ?? '')
        setDealId(p.deal_id ?? '')
        setRfqId(p.rfq_id ?? '')
        setDeliveryAddress(p.delivery_address ?? '')
        setRequiredDate(p.required_delivery_date ?? '')
        setTerms(p.terms_and_conditions ?? '')
        setNotes(p.notes ?? '')
        setInternalNotes(p.internal_notes ?? '')
      }
      setLines((lineData ?? []).map((l: PurchaseOrderLine) => ({
        key: nk(), id: l.id,
        description: l.description, unit: l.unit,
        quantity_ordered: String(l.quantity_ordered),
        unit_price: String(l.unit_price),
        vat_rate: String((l.vat_rate ?? 0.15) * 100),
      })))
      setGrns((grnData ?? []) as GrnSummary[])
      setMatchLines((matchData ?? []) as ThreeWayMatchLine[])
      setSupplierInvs((invData ?? []) as SupplierInvRow[])
    } else {
      // Pre-populate from RFQ recipient if provided
      if (preRfqId && preRecipientId) {
        const { data: respLines } = await supabase
          .from('rfq_response_lines')
          .select('*, rfq_line:rfq_lines(description, unit, quantity)')
          .eq('recipient_id', preRecipientId)
        setLines((respLines ?? []).map((rl: {
          id: string;
          rfq_line_id: string;
          unit_price: number;
          vat_rate: number;
          rfq_line?: { description: string; unit: string; quantity: number } | null;
        }) => ({
          key: nk(),
          description: rl.rfq_line?.description ?? '',
          unit: rl.rfq_line?.unit ?? 'each',
          quantity_ordered: String(rl.rfq_line?.quantity ?? 1),
          unit_price: String(rl.unit_price),
          vat_rate: String((rl.vat_rate ?? 0.15) * 100),
        })))
      } else {
        setLines([{ key: nk(), description: '', unit: 'each', quantity_ordered: '1', unit_price: '0', vat_rate: '15' }])
      }
    }
    setLoading(false)
  }, [isNew, preRfqId, preRecipientId])

  useEffect(() => { void load() }, [load])

  function addLine() { setLines(ls => [...ls, { key: nk(), description: '', unit: 'each', quantity_ordered: '1', unit_price: '0', vat_rate: '15' }]) }
  function updateLine(key: string, f: string, v: string) { setLines(ls => ls.map(l => l.key === key ? { ...l, [f]: v } : l)) }
  function removeLine(key: string) { setLines(ls => ls.filter(l => l.key !== key)) }

  // Totals
  const totals = lines.reduce((acc, l) => {
    const qty = Number(l.quantity_ordered) || 0
    const up = Number(l.unit_price) || 0
    const vr = (Number(l.vat_rate) || 15) / 100
    const sub = roundFinancial(qty * up)
    const vat = roundFinancial(sub * vr)
    return { subtotal: acc.subtotal + sub, vat: acc.vat + vat, total: acc.total + sub + vat }
  }, { subtotal: 0, vat: 0, total: 0 })

  const isReadonly = po && (po.status === 'cancelled' || po.status === 'received')

  async function save(newStatus?: string) {
    if (!companyId) return
    setSaving(true)
    setError(null)
    const supabase = createClient()

    const payload = {
      company_id: companyId,
      supplier_id: supplierId || null,
      deal_id: dealId || null,
      rfq_id: rfqId || null,
      delivery_address: deliveryAddress.trim() || null,
      required_delivery_date: requiredDate || null,
      terms_and_conditions: terms.trim() || null,
      notes: notes.trim() || null,
      internal_notes: internalNotes.trim() || null,
      subtotal: roundFinancial(totals.subtotal),
      vat_amount: roundFinancial(totals.vat),
      total_amount: roundFinancial(totals.total),
      status: newStatus ?? (po?.status ?? 'draft'),
      updated_at: new Date().toISOString(),
    }

    let currentId = savedId.current
    if (!currentId) {
      const { data: numData } = await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: string | null }>)('generate_po_number', { p_company_id: companyId })
      const { data: inserted, error: insErr } = await supabase.from('purchase_orders').insert({
        ...payload,
        po_number: numData ?? null,
        created_by: employeeId,
        sent_at: newStatus === 'sent' ? new Date().toISOString() : null,
      }).select('id').single()
      if (insErr || !inserted) { setError(insErr?.message ?? 'Failed to create PO'); setSaving(false); return }
      currentId = (inserted as { id: string }).id
      savedId.current = currentId
    } else {
      await supabase.from('purchase_orders').update({
        ...payload,
        ...(newStatus === 'sent' && !po?.sent_at ? { sent_at: new Date().toISOString() } : {}),
      }).eq('id', currentId)
    }

    // Upsert lines
    const validLines = lines.filter(l => l.description.trim())
    const linePayloads = validLines.map((l, i) => {
      const qty = Number(l.quantity_ordered) || 0
      const up = Number(l.unit_price) || 0
      const vr = (Number(l.vat_rate) || 15) / 100
      const sub = roundFinancial(qty * up)
      const vat = roundFinancial(sub * vr)
      return {
        ...(l.id ? { id: l.id } : {}),
        company_id: companyId,
        po_id: currentId!,
        sort_order: i,
        description: l.description.trim(),
        unit: l.unit,
        quantity_ordered: qty,
        unit_price: up,
        subtotal: sub,
        vat_rate: vr,
        vat_amount: vat,
        line_total: roundFinancial(sub + vat),
      }
    })

    const existingIds = validLines.filter(l => l.id).map(l => l.id!)
    if (currentId) {
      await supabase.from('purchase_order_lines').delete().eq('po_id', currentId).not('id', 'in', `(${existingIds.length > 0 ? existingIds.join(',') : '00000000-0000-0000-0000-000000000000'})`)
    }
    if (linePayloads.length > 0) await supabase.from('purchase_order_lines').upsert(linePayloads, { onConflict: 'id' })

    setSaving(false)
    showToast(newStatus === 'sent' ? 'PO marked as sent.' : newStatus === 'approved' ? 'PO approved!' : 'PO saved.')
    if (isNew && currentId) router.replace(`/dashboard/supply/purchase-orders/${currentId}`)
    else void load()
  }

  async function approve() {
    if (!savedId.current || !employeeId) return
    const supabase = createClient()
    const now = new Date().toISOString()
    await supabase.from('purchase_orders').update({ approval_status: 'approved', status: 'approved', approved_by: employeeId, approved_at: now, updated_at: now }).eq('id', savedId.current)
    showToast('PO approved!')
    void load()
  }

  async function reject() {
    if (!savedId.current || !employeeId) return
    const supabase = createClient()
    const now = new Date().toISOString()
    await supabase.from('purchase_orders').update({ approval_status: 'rejected', status: 'draft', rejected_by: employeeId, rejected_at: now, rejection_reason: rejectReason, updated_at: now }).eq('id', savedId.current)
    setShowRejectModal(false)
    setRejectReason('')
    showToast('PO rejected.')
    void load()
  }

  async function linkInvoice(invId: string) {
    if (!savedId.current) return
    const supabase = createClient()
    await supabase.from('supplier_invoices').update({ po_id: savedId.current }).eq('id', invId)
    setShowLinkInvModal(false)
    showToast('Invoice linked to PO.')
    void load()
  }

  const matchSummary = (() => {
    if (matchLines.length === 0) return null
    const hasOverInvoiced = matchLines.some(l => l.match_status === 'OVER_INVOICED')
    const allMatched = matchLines.every(l => l.match_status === 'MATCHED')
    const hasPartial = matchLines.some(l => l.match_status === 'PARTIAL' || l.match_status === 'SHORT_DELIVERY')
    if (hasOverInvoiced) return { cls: 'bg-error/10 text-error', msg: 'Discrepancy detected — review before paying' }
    if (allMatched) return { cls: 'bg-success/10 text-success', msg: 'All lines matched — ready to approve payment' }
    if (hasPartial) return { cls: 'bg-amber-50 text-amber-700', msg: 'Partial receipt — some lines still outstanding' }
    return null
  })()

  const matchBadge: Record<string, string> = {
    MATCHED: 'bg-success/10 text-success',
    OVER_INVOICED: 'bg-error/10 text-error',
    SHORT_DELIVERY: 'bg-amber-100 text-amber-700',
    PARTIAL: 'bg-blue-100 text-blue-700',
    NO_ORDER: 'bg-surface-elevated text-text-secondary',
  }

  const matchLabel: Record<string, string> = {
    MATCHED: '✓ Matched', OVER_INVOICED: '⚠ Over-invoiced',
    SHORT_DELIVERY: 'Short delivery', PARTIAL: 'Partial', NO_ORDER: 'No order',
  }

  if (loading) return <p className="p-6 text-[13px] text-text-secondary">Loading…</p>

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => router.push('/dashboard/supply/purchase-orders')} className="text-text-secondary hover:text-text-primary">
            <span className="material-icons text-[20px]">arrow_back</span>
          </button>
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold text-text-primary truncate">
              {po?.po_number ?? 'New Purchase Order'}
            </h1>
            <p className="text-[12px] text-text-secondary capitalize">{po?.status?.replace(/_/g, ' ') ?? 'draft'} · {po?.approval_status ?? 'pending'}</p>
          </div>
        </div>
        {!isReadonly && (
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={() => save()} disabled={saving} className="btn-secondary h-9 px-4 text-[13px] disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            {(!po || po.status === 'draft') && (
              <button onClick={() => save('pending_approval')} disabled={saving} className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">
                Submit for Approval
              </button>
            )}
            {po?.status === 'pending_approval' && canApprove && (
              <>
                <button onClick={approve} className="btn-primary h-9 px-4 text-[13px] bg-success border-success">Approve</button>
                <button onClick={() => setShowRejectModal(true)} className="h-9 px-4 text-[13px] text-error border border-error rounded-lg hover:bg-error/10">Reject</button>
              </>
            )}
            {po?.status === 'approved' && (
              <button onClick={() => save('sent')} disabled={saving} className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">Mark as Sent</button>
            )}
            {(po?.status === 'sent' || po?.status === 'approved' || po?.status === 'partially_received') && (
              <button onClick={() => router.push(`/dashboard/supply/goods-received/new?po_id=${po.id}`)}
                className="btn-secondary h-9 px-4 text-[13px] flex items-center gap-1">
                <span className="material-icons text-[18px]">local_shipping</span>
                Receive Goods
              </button>
            )}
          </div>
        )}
      </div>

      {error && <div className="mx-4 mt-2 p-2 rounded bg-error/10 text-error text-[12px]">{error}</div>}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-success text-white px-4 py-2 rounded-lg shadow-lg text-[13px] z-50 pointer-events-none">
          {toast}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-divider shrink-0 px-4">
        <button onClick={() => setTab('details')} className={`px-4 py-2.5 text-[13px] font-medium border-b-2 ${tab === 'details' ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>Details</button>
        {grns.length > 0 && (
          <button onClick={() => setTab('match')} className={`px-4 py-2.5 text-[13px] font-medium border-b-2 ${tab === 'match' ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>Three-Way Match</button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tab === 'details' && (
          <div className="space-y-6 max-w-4xl">
            {/* Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">Supplier *</label>
                <select className="input h-9 text-[13px] w-full" value={supplierId} disabled={!!isReadonly}
                  onChange={e => setSupplierId(e.target.value)}>
                  <option value="">— Select supplier —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">Link to Project</label>
                <select className="input h-9 text-[13px] w-full" value={dealId} disabled={!!isReadonly}
                  onChange={e => setDealId(e.target.value)}>
                  <option value="">— None —</option>
                  {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">Link to RFQ</label>
                <select className="input h-9 text-[13px] w-full" value={rfqId} disabled={!!isReadonly}
                  onChange={e => setRfqId(e.target.value)}>
                  <option value="">— None —</option>
                  {rfqs.map(r => <option key={r.id} value={r.id}>{r.rfq_number ?? r.title}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">Required Delivery Date</label>
                <input type="date" className="input h-9 text-[13px] w-full" value={requiredDate} disabled={!!isReadonly}
                  onChange={e => setRequiredDate(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[12px] text-text-secondary mb-1">Delivery Address</label>
                <input className="input h-9 text-[13px] w-full" value={deliveryAddress} disabled={!!isReadonly}
                  onChange={e => setDeliveryAddress(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[12px] text-text-secondary mb-1">Terms & Conditions</label>
                <textarea className="input text-[13px] w-full p-2" rows={2} value={terms} disabled={!!isReadonly}
                  onChange={e => setTerms(e.target.value)} />
              </div>
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">Notes (visible to supplier)</label>
                <textarea className="input text-[13px] w-full p-2" rows={2} value={notes} disabled={!!isReadonly}
                  onChange={e => setNotes(e.target.value)} />
              </div>
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">Internal Notes</label>
                <textarea className="input text-[13px] w-full p-2" rows={2} value={internalNotes} disabled={!!isReadonly}
                  onChange={e => setInternalNotes(e.target.value)} />
              </div>
            </div>

            {/* Lines */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[13px] font-semibold text-text-primary">Line Items</h2>
                {!isReadonly && (
                  <button onClick={addLine} className="text-[12px] text-primary flex items-center gap-0.5 hover:underline">
                    <span className="material-icons text-[16px]">add</span> Add Line
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full" style={{ minWidth: 640 }}>
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className="data-th text-left">Description</th>
                      <th className="data-th text-right w-20">Unit</th>
                      <th className="data-th text-right w-20">Qty</th>
                      <th className="data-th text-right w-28">Unit Price</th>
                      <th className="data-th text-right w-16">VAT %</th>
                      <th className="data-th text-right w-28">Line Total</th>
                      {!isReadonly && <th className="data-th w-10" />}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(l => {
                      const qty = Number(l.quantity_ordered) || 0
                      const up = Number(l.unit_price) || 0
                      const vr = (Number(l.vat_rate) || 15) / 100
                      const lineTotal = roundFinancial(qty * up * (1 + vr))
                      return (
                        <tr key={l.key} className="border-b border-divider">
                          <td className="data-td">
                            <input className="input h-8 text-[13px] w-full" value={l.description} disabled={!!isReadonly}
                              onChange={e => updateLine(l.key, 'description', e.target.value)} />
                          </td>
                          <td className="data-td">
                            <input className="input h-8 text-[13px] w-16" value={l.unit} disabled={!!isReadonly}
                              onChange={e => updateLine(l.key, 'unit', e.target.value)} />
                          </td>
                          <td className="data-td">
                            <input type="number" className="input h-8 text-[13px] w-16 text-right" value={l.quantity_ordered} disabled={!!isReadonly}
                              onChange={e => updateLine(l.key, 'quantity_ordered', e.target.value)} />
                          </td>
                          <td className="data-td">
                            <input type="number" step="0.01" className="input h-8 text-[13px] w-24 text-right" value={l.unit_price} disabled={!!isReadonly}
                              onChange={e => updateLine(l.key, 'unit_price', e.target.value)} />
                          </td>
                          <td className="data-td">
                            <input type="number" className="input h-8 text-[13px] w-14 text-right" value={l.vat_rate} disabled={!!isReadonly}
                              onChange={e => updateLine(l.key, 'vat_rate', e.target.value)} />
                          </td>
                          <td className="data-td text-[13px] text-right font-medium">{fmtMoney(lineTotal)}</td>
                          {!isReadonly && (
                            <td className="data-td">
                              <button onClick={() => removeLine(l.key)} className="text-text-secondary hover:text-error">
                                <span className="material-icons text-[18px]">delete</span>
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {/* Totals */}
              <div className="max-w-xs ml-auto mt-3 space-y-1 text-[13px]">
                <div className="flex justify-between"><span className="text-text-secondary">Subtotal</span><span>{fmtMoney(totals.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-text-secondary">VAT</span><span>{fmtMoney(totals.vat)}</span></div>
                <div className="flex justify-between font-semibold"><span>Total</span><span>{fmtMoney(totals.total)}</span></div>
                {po && po.amount_received_value > 0 && (
                  <div className="flex justify-between text-success"><span>Received value</span><span>{fmtMoney(po.amount_received_value)}</span></div>
                )}
              </div>
            </div>

            {/* GRNs */}
            {grns.length > 0 && (
              <div>
                <h2 className="text-[13px] font-semibold text-text-primary mb-2">Goods Received Notes</h2>
                <div className="space-y-1">
                  {grns.map(g => (
                    <a key={g.id} href={`/dashboard/supply/goods-received/${g.id}`}
                      className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-elevated text-[13px]">
                      <span className="font-medium">{g.grn_number ?? 'GRN'}</span>
                      <span className="text-text-secondary">{g.received_date}</span>
                      <span className="capitalize text-text-secondary">{g.status}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Linked invoices */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[13px] font-semibold text-text-primary">Linked Supplier Invoice</h2>
                {po && supplierInvs.length === 0 && (
                  <button onClick={() => setShowLinkInvModal(true)} className="text-[12px] text-primary hover:underline">
                    Link Invoice
                  </button>
                )}
              </div>
              {supplierInvs.length === 0 ? (
                <p className="text-[13px] text-text-secondary">No supplier invoice linked.</p>
              ) : supplierInvs.map(inv => (
                <a key={inv.id} href={`/dashboard/finance/supplier-invoices/${inv.id}`}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-elevated text-[13px]">
                  <span className="font-medium">{inv.invoice_number ?? 'Invoice'}</span>
                  <span className="text-text-secondary">{fmtMoney(inv.total_amount)}</span>
                  <span className="capitalize text-text-secondary">{inv.status}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {tab === 'match' && (
          <div className="space-y-4 max-w-4xl">
            {matchSummary && (
              <div className={`p-3 rounded-lg text-[13px] font-medium ${matchSummary.cls}`}>
                {matchSummary.msg}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full" style={{ minWidth: 700 }}>
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider">
                    <th className="data-th text-left">Item</th>
                    <th className="data-th text-right">Ordered</th>
                    <th className="data-th text-right">Received</th>
                    <th className="data-th text-right">Invoiced</th>
                    <th className="data-th text-right">Receipt Var</th>
                    <th className="data-th text-right">Invoice Var</th>
                    <th className="data-th text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {matchLines.map(ml => (
                    <tr key={ml.po_line_id} className="border-b border-divider">
                      <td className="data-td text-[13px]">{ml.description}</td>
                      <td className="data-td text-[13px] text-right">{ml.quantity_ordered}</td>
                      <td className="data-td text-[13px] text-right">{ml.quantity_received}</td>
                      <td className="data-td text-[13px] text-right">{ml.quantity_invoiced}</td>
                      <td className={`data-td text-[13px] text-right ${Number(ml.receipt_variance) < 0 ? 'text-error' : ''}`}>{ml.receipt_variance}</td>
                      <td className={`data-td text-[13px] text-right ${Number(ml.invoice_variance) > 0 ? 'text-error' : ''}`}>{ml.invoice_variance}</td>
                      <td className="data-td text-center">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${matchBadge[ml.match_status] ?? ''}`}>
                          {matchLabel[ml.match_status] ?? ml.match_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Reject modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface rounded-xl shadow-2xl w-80 p-5 space-y-4">
            <h3 className="text-[15px] font-semibold text-text-primary">Reject PO</h3>
            <div>
              <label className="block text-[12px] text-text-secondary mb-1">Reason (optional)</label>
              <textarea className="input text-[13px] w-full p-2" rows={3} value={rejectReason}
                onChange={e => setRejectReason(e.target.value)} placeholder="Enter rejection reason…" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowRejectModal(false)} className="btn-secondary flex-1 h-9 text-[13px]">Cancel</button>
              <button onClick={reject} className="flex-1 h-9 text-[13px] bg-error text-white rounded-lg hover:bg-error/90">Reject PO</button>
            </div>
          </div>
        </div>
      )}

      {/* Link invoice modal */}
      {showLinkInvModal && po && (
        <LinkInvoiceModal
          companyId={po.company_id}
          supplierId={po.supplier_id}
          onLink={linkInvoice}
          onClose={() => setShowLinkInvModal(false)}
        />
      )}
    </div>
  )
}

function LinkInvoiceModal({ companyId, supplierId, onLink, onClose }: {
  companyId: string; supplierId: string | null; onLink: (id: string) => void; onClose: () => void
}) {
  const [invs, setInvs] = useState<SupplierInvRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      let q = supabase.from('supplier_invoices').select('id, invoice_number, total_amount, status')
        .eq('company_id', companyId).is('po_id', null)
      if (supplierId) q = q.eq('supplier_id', supplierId)
      const { data } = await q.order('created_at', { ascending: false })
      setInvs((data ?? []) as SupplierInvRow[])
      setLoading(false)
    }
    void load()
  }, [companyId, supplierId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface rounded-xl shadow-2xl w-96 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-text-primary">Link Supplier Invoice</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <span className="material-icons text-[20px]">close</span>
          </button>
        </div>
        {loading ? (
          <p className="text-[13px] text-text-secondary py-4 text-center">Loading…</p>
        ) : invs.length === 0 ? (
          <p className="text-[13px] text-text-secondary py-4 text-center">No unlinked invoices found.</p>
        ) : (
          <div className="max-h-64 overflow-auto space-y-1">
            {invs.map(inv => (
              <button key={inv.id} onClick={() => onLink(inv.id)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-elevated text-[13px]">
                <span className="font-medium">{inv.invoice_number ?? 'Invoice'}</span>
                <span className="ml-2 text-text-secondary">{fmtMoney(inv.total_amount)}</span>
                <span className="ml-2 capitalize text-text-secondary">{inv.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface SupplierInvRow { id: string; invoice_number: string | null; total_amount: number; status: string }
