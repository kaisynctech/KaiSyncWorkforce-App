'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { Rfq, RfqLine, RfqRecipient } from '@/types/commercial'

interface Supplier {
  id: string
  name: string
  email: string | null
}

interface RfqBuilderProps {
  rfqId?: string
}

let lineCounter = 0
function nextKey() { return `l${++lineCounter}` }

interface DraftLine {
  key: string
  id?: string
  description: string
  unit: string
  quantity: string
  specifications: string
}

export default function RfqBuilder({ rfqId }: RfqBuilderProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preloadSupplierId = searchParams.get('supplier_id')

  const [companyId, setCompanyId] = useState<string | null>(null)
  const [rfq, setRfq] = useState<Rfq | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  // Header fields
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dealId, setDealId] = useState('')
  const [requiredByDate, setRequiredByDate] = useState('')
  const [responseDeadline, setResponseDeadline] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [notes, setNotes] = useState('')

  // Lines
  const [lines, setLines] = useState<DraftLine[]>([])

  // Recipients
  const [recipients, setRecipients] = useState<RfqRecipient[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierSearch, setSupplierSearch] = useState('')
  const [showSupplierPicker, setShowSupplierPicker] = useState(false)

  // Deals (for dropdown)
  const [deals, setDeals] = useState<{ id: string; title: string }[]>([])

  const savedRfqId = useRef<string | undefined>(rfqId)

  function showToast(msg: string) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)

    const [{ data: suppData }, { data: dealData }] = await Promise.all([
      supabase.from('contractors').select('id, name, email').eq('company_id', member.companyId).eq('partner_kind', 'supplier').eq('is_active', true).order('name'),
      supabase.from('client_deals').select('id, title').eq('company_id', member.companyId).order('title'),
    ])
    setSuppliers((suppData ?? []) as Supplier[])
    setDeals((dealData ?? []) as { id: string; title: string }[])

    if (rfqId) {
      const [{ data: rfqData }, { data: lineData }, { data: recipData }] = await Promise.all([
        supabase.from('rfqs').select('*').eq('id', rfqId).maybeSingle(),
        supabase.from('rfq_lines').select('*').eq('rfq_id', rfqId).order('sort_order'),
        supabase.from('rfq_recipients').select('*, supplier:contractors(id, name, email, phone)').eq('rfq_id', rfqId).order('created_at'),
      ])
      if (rfqData) {
        const r = rfqData as Rfq
        setRfq(r)
        setTitle(r.title)
        setDescription(r.description ?? '')
        setDealId(r.deal_id ?? '')
        setRequiredByDate(r.required_by_date ?? '')
        setResponseDeadline(r.response_deadline ?? '')
        setDeliveryAddress(r.delivery_address ?? '')
        setNotes(r.notes ?? '')
      }
      setLines((lineData ?? []).map((l: RfqLine) => ({
        key: nextKey(), id: l.id,
        description: l.description, unit: l.unit,
        quantity: String(l.quantity), specifications: l.specifications ?? '',
      })))
      setRecipients((recipData ?? []) as RfqRecipient[])
    } else {
      setLines([{ key: nextKey(), description: '', unit: 'each', quantity: '1', specifications: '' }])
      if (preloadSupplierId) {
        // Pre-add the supplier as a recipient once RFQ is saved
      }
    }
    setLoading(false)
  }, [rfqId, preloadSupplierId])

  useEffect(() => { void load() }, [load])

  function addLine() {
    setLines(ls => [...ls, { key: nextKey(), description: '', unit: 'each', quantity: '1', specifications: '' }])
  }

  function updateLine(key: string, field: keyof DraftLine, value: string) {
    setLines(ls => ls.map(l => l.key === key ? { ...l, [field]: value } : l))
  }

  function removeLine(key: string) {
    setLines(ls => ls.filter(l => l.key !== key))
  }

  async function save(newStatus?: string) {
    if (!companyId || !title.trim()) { setError('Title is required'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()

    let currentRfqId = savedRfqId.current

    const rfqPayload = {
      company_id: companyId,
      title: title.trim(),
      description: description.trim() || null,
      deal_id: dealId || null,
      required_by_date: requiredByDate || null,
      response_deadline: responseDeadline || null,
      delivery_address: deliveryAddress.trim() || null,
      notes: notes.trim() || null,
      status: newStatus ?? (rfq?.status ?? 'draft'),
      updated_at: new Date().toISOString(),
    }

    if (currentRfqId) {
      await supabase.from('rfqs').update(rfqPayload).eq('id', currentRfqId)
    } else {
      // Auto-number
      const { data: numData } = await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: string | null }>)('generate_rfq_number', { p_company_id: companyId })
      const { data: newRfq, error: insErr } = await supabase.from('rfqs').insert({
        ...rfqPayload,
        rfq_number: numData ?? null,
        created_by: null,
      }).select('id').single()
      if (insErr || !newRfq) { setError(insErr?.message ?? 'Failed to create RFQ'); setSaving(false); return }
      currentRfqId = (newRfq as { id: string }).id
      savedRfqId.current = currentRfqId
    }

    // Upsert lines
    const validLines = lines.filter(l => l.description.trim())
    const linePayloads = validLines.map((l, i) => ({
      ...(l.id ? { id: l.id } : {}),
      company_id: companyId,
      rfq_id: currentRfqId!,
      sort_order: i,
      description: l.description.trim(),
      unit: l.unit,
      quantity: Number(l.quantity) || 1,
      specifications: l.specifications.trim() || null,
    }))

    // Delete removed lines
    const existingIds = validLines.filter(l => l.id).map(l => l.id!)
    if (savedRfqId.current) {
      await supabase.from('rfq_lines').delete().eq('rfq_id', currentRfqId!).not('id', 'in', `(${existingIds.length > 0 ? existingIds.join(',') : '00000000-0000-0000-0000-000000000000'})`)
    }
    if (linePayloads.length > 0) {
      await supabase.from('rfq_lines').upsert(linePayloads, { onConflict: 'id' })
    }

    setSaving(false)
    showToast(newStatus === 'sent' ? 'RFQ marked as sent!' : 'RFQ saved.')

    if (!rfqId && currentRfqId) {
      router.replace(`/dashboard/supply/rfqs/${currentRfqId}`)
    } else {
      void load()
    }
  }

  async function sendRfq() {
    if (!savedRfqId.current) { await save('sent'); return }
    // Update status + recipients
    const supabase = createClient()
    const now = new Date().toISOString()
    await supabase.from('rfqs').update({ status: 'sent', updated_at: now }).eq('id', savedRfqId.current)
    if (recipients.length > 0) {
      await supabase.from('rfq_recipients').update({ status: 'sent', sent_at: now }).eq('rfq_id', savedRfqId.current!).eq('status', 'pending')
    }
    showToast('RFQ sent! (Email integration coming soon)')
    void load()
  }

  async function addRecipient(supplier: Supplier) {
    if (!savedRfqId.current || !companyId) {
      // Save first
      await save()
      if (!savedRfqId.current) return
    }
    const supabase = createClient()
    await supabase.from('rfq_recipients').insert({
      company_id: companyId!,
      rfq_id: savedRfqId.current!,
      supplier_id: supplier.id,
      status: rfq?.status === 'sent' ? 'sent' : 'pending',
      sent_at: rfq?.status === 'sent' ? new Date().toISOString() : null,
    })
    setShowSupplierPicker(false)
    setSupplierSearch('')
    void load()
  }

  async function removeRecipient(recipientId: string) {
    const supabase = createClient()
    await supabase.from('rfq_recipients').delete().eq('id', recipientId)
    void load()
  }

  const filteredSuppliers = suppliers.filter(s =>
    !supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase())
  ).filter(s => !recipients.find(r => r.supplier_id === s.id))

  const recipientStatusColour: Record<string, string> = {
    pending: 'bg-surface-elevated text-text-secondary',
    sent: 'bg-blue-100 text-blue-700',
    responded: 'bg-success/10 text-success',
    declined: 'bg-error/10 text-error',
    selected: 'bg-primary/10 text-primary',
  }

  if (loading) return <p className="p-6 text-[13px] text-text-secondary">Loading…</p>

  const isReadonly = rfq?.status === 'closed' || rfq?.status === 'cancelled'

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => router.push('/dashboard/supply/rfqs')} className="text-text-secondary hover:text-text-primary">
            <span className="material-icons text-[20px]">arrow_back</span>
          </button>
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold text-text-primary truncate">
              {rfq?.rfq_number ? `${rfq.rfq_number} — ${title}` : (title || 'New RFQ')}
            </h1>
            <p className="text-[12px] text-text-secondary capitalize">{rfq?.status ?? 'draft'}</p>
          </div>
        </div>
        {!isReadonly && (
          <div className="flex items-center gap-2">
            <button onClick={() => save()} disabled={saving} className="btn-secondary h-9 px-4 text-[13px] disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            {(rfq?.status === 'draft' || rfq?.status === 'responses_received' || !rfq) && (
              <button onClick={sendRfq} disabled={saving || recipients.length === 0} className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">
                Send to Suppliers
              </button>
            )}
            {(rfq?.status === 'sent' || rfq?.status === 'responses_received') && (
              <button onClick={() => save('closed')} disabled={saving} className="btn-secondary h-9 px-4 text-[13px] disabled:opacity-50">
                Close RFQ
              </button>
            )}
          </div>
        )}
      </div>

      {error && <div className="mx-4 mt-2 p-2 rounded bg-error/10 text-error text-[12px]">{error}</div>}

      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-success text-white px-4 py-2 rounded-lg shadow-lg text-[13px] z-50 pointer-events-none">
          {toastMsg}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Two-panel layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Details */}
          <div className="space-y-3">
            <h2 className="text-[13px] font-semibold text-text-primary">Details</h2>
            <div>
              <label className="block text-[12px] text-text-secondary mb-1">Title *</label>
              <input className="input h-9 text-[13px] w-full" value={title} disabled={isReadonly}
                onChange={e => setTitle(e.target.value)} placeholder="e.g. Office supplies Q3" />
            </div>
            <div>
              <label className="block text-[12px] text-text-secondary mb-1">Link to Project</label>
              <select className="input h-9 text-[13px] w-full" value={dealId} disabled={isReadonly}
                onChange={e => setDealId(e.target.value)}>
                <option value="">— None —</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[12px] text-text-secondary mb-1">Description</label>
              <textarea className="input text-[13px] w-full p-2" rows={3} value={description} disabled={isReadonly}
                onChange={e => setDescription(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">Required By</label>
                <input type="date" className="input h-9 text-[13px] w-full" value={requiredByDate} disabled={isReadonly}
                  onChange={e => setRequiredByDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">Response Deadline</label>
                <input type="date" className="input h-9 text-[13px] w-full" value={responseDeadline} disabled={isReadonly}
                  onChange={e => setResponseDeadline(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-[12px] text-text-secondary mb-1">Delivery Address</label>
              <input className="input h-9 text-[13px] w-full" value={deliveryAddress} disabled={isReadonly}
                onChange={e => setDeliveryAddress(e.target.value)} />
            </div>
            <div>
              <label className="block text-[12px] text-text-secondary mb-1">Notes</label>
              <textarea className="input text-[13px] w-full p-2" rows={2} value={notes} disabled={isReadonly}
                onChange={e => setNotes(e.target.value)} />
            </div>
          </div>

          {/* Right: Line items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-text-primary">Line Items</h2>
              {!isReadonly && (
                <button onClick={addLine} className="text-[12px] text-primary flex items-center gap-0.5 hover:underline">
                  <span className="material-icons text-[16px]">add</span> Add Line
                </button>
              )}
            </div>
            {lines.length === 0 ? (
              <p className="text-[13px] text-text-secondary text-center py-6">No lines yet.</p>
            ) : (
              <div className="space-y-2">
                {lines.map((line) => (
                  <div key={line.key} className="card p-3 space-y-2">
                    <div className="flex gap-2">
                      <input className="input h-8 text-[13px] flex-1" placeholder="Description" value={line.description} disabled={isReadonly}
                        onChange={e => updateLine(line.key, 'description', e.target.value)} />
                      <input className="input h-8 text-[13px] w-16" placeholder="Unit" value={line.unit} disabled={isReadonly}
                        onChange={e => updateLine(line.key, 'unit', e.target.value)} />
                      <input type="number" className="input h-8 text-[13px] w-20" placeholder="Qty" value={line.quantity} disabled={isReadonly}
                        onChange={e => updateLine(line.key, 'quantity', e.target.value)} />
                      {!isReadonly && (
                        <button onClick={() => removeLine(line.key)} className="text-text-secondary hover:text-error">
                          <span className="material-icons text-[18px]">delete</span>
                        </button>
                      )}
                    </div>
                    <input className="input h-8 text-[12px] w-full" placeholder="Specifications…" value={line.specifications} disabled={isReadonly}
                      onChange={e => updateLine(line.key, 'specifications', e.target.value)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recipients */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-text-primary">Suppliers Invited</h2>
            {!isReadonly && (
              <button onClick={() => setShowSupplierPicker(true)} className="text-[12px] text-primary flex items-center gap-0.5 hover:underline">
                <span className="material-icons text-[16px]">add</span> Add Supplier
              </button>
            )}
          </div>

          {suppliers.length === 0 ? (
            <p className="text-[13px] text-text-secondary">
              No suppliers yet —{' '}
              <a href="/dashboard/supply/suppliers" className="text-primary hover:underline">add one first</a>
            </p>
          ) : recipients.length === 0 ? (
            <p className="text-[13px] text-text-secondary">No suppliers invited yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {recipients.map(r => (
                <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-elevated">
                  <span className="text-[13px] font-medium text-text-primary">
                    {(r.supplier as { name: string } | undefined)?.name ?? r.supplier_id}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${recipientStatusColour[r.status] ?? ''}`}>
                    {r.status}
                  </span>
                  {r.response_total > 0 && (
                    <span className="text-[12px] text-text-secondary">R {r.response_total.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</span>
                  )}
                  {!isReadonly && (
                    <button onClick={() => removeRecipient(r.id)} className="text-text-secondary hover:text-error">
                      <span className="material-icons text-[14px]">close</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {rfq?.status === 'sent' || rfq?.status === 'responses_received' ? (
            <div className="flex gap-2 mt-2">
              <a href={`/dashboard/supply/rfqs/${rfq.id}/responses`}
                className="btn-secondary h-9 px-4 text-[13px] flex items-center gap-1">
                <span className="material-icons text-[18px]">edit_note</span>
                Enter Responses
              </a>
              <a href={`/dashboard/supply/rfqs/${rfq.id}/compare`}
                className="btn-primary h-9 px-4 text-[13px] flex items-center gap-1">
                <span className="material-icons text-[18px]">compare</span>
                Compare Suppliers
              </a>
            </div>
          ) : null}
        </div>
      </div>

      {/* Supplier picker modal */}
      {showSupplierPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface rounded-xl shadow-2xl w-80 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-text-primary">Add Supplier</h3>
              <button onClick={() => setShowSupplierPicker(false)} className="text-text-secondary hover:text-text-primary">
                <span className="material-icons text-[20px]">close</span>
              </button>
            </div>
            <input type="search" className="input h-9 text-[13px] w-full" placeholder="Search…"
              value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} />
            <div className="max-h-56 overflow-auto space-y-1">
              {filteredSuppliers.length === 0 ? (
                <p className="text-[13px] text-text-secondary text-center py-4">
                  {suppliers.length === 0 ? 'No suppliers exist yet.' : 'All suppliers already added.'}
                </p>
              ) : filteredSuppliers.map(s => (
                <button key={s.id} onClick={() => addRecipient(s)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-elevated text-[13px] text-text-primary">
                  {s.name}
                  {s.email && <span className="block text-[11px] text-text-secondary">{s.email}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
