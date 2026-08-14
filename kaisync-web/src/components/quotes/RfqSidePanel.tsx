'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { RFQ_STATUS_CONFIG } from '@/lib/rfq'
import type { QuoteRfq, QuoteRfqLine, QuoteSourcingSummaryRow } from '@/types/quotes'

interface Contractor {
  id: string
  name: string
  partner_kind: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  // If rfq is set → Mode B (view/log response). If null → Mode A (create new)
  rfq: QuoteRfq | null
  // For Mode A: pre-loaded items to include
  preloadedItems?: QuoteSourcingSummaryRow[]
  quoteId: string
  companyId: string
  employeeId: string
  quoteNumber: string
  rfqCount: number           // total existing RFQ count → used for number generation
  onSaved: () => void        // refresh parent
}

export default function RfqSidePanel({
  isOpen, onClose, rfq, preloadedItems, quoteId, companyId, employeeId, quoteNumber, rfqCount, onSaved,
}: Props) {
  const supabase = createClient()

  // ── Mode A state (create) ──
  const [supplierQuery,   setSupplierQuery]   = useState('')
  const [supplierResults, setSupplierResults] = useState<Contractor[]>([])
  const [selectedSupplier, setSelectedSupplier] = useState<Contractor | null>(null)
  const [showSupDrop,     setShowSupDrop]     = useState(false)
  const [createNotes,     setCreateNotes]     = useState('')
  const [saving,          setSaving]          = useState(false)

  // ── Mode B state (log response) ──
  const [responses, setResponses] = useState<Record<string, {
    price: string; ref: string; qty: string; lead: string; notes: string
  }>>({})

  // Pre-populate responses from existing data when rfq loads
  useEffect(() => {
    if (!rfq?.lines) return
    const init: typeof responses = {}
    rfq.lines.forEach(l => {
      init[l.id] = {
        price: l.supplier_price != null ? String(l.supplier_price) : '',
        ref:   l.supplier_ref ?? '',
        qty:   l.supplier_qty_available != null ? String(l.supplier_qty_available) : '',
        lead:  l.lead_time_days != null ? String(l.lead_time_days) : '',
        notes: l.supplier_notes ?? '',
      }
    })
    setResponses(init)
  }, [rfq?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Search suppliers (contractors where partner_kind = supplier or contractor)
  useEffect(() => {
    if (!supplierQuery.trim()) { setSupplierResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('contractors')
        .select('id, name, partner_kind')
        .eq('company_id', companyId)
        .or(`partner_kind.eq.supplier,partner_kind.eq.contractor`)
        .ilike('name', `%${supplierQuery}%`)
        .limit(8)
      setSupplierResults((data ?? []) as Contractor[])
      setShowSupDrop(true)
    }, 250)
    return () => clearTimeout(t)
  }, [supplierQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Create RFQ (Mode A) ──
  async function handleCreate(markSent: boolean) {
    if (!selectedSupplier) return
    setSaving(true)
    try {
      const rfqNumber = `RFQ-${quoteNumber.replace(/^QT-/, '')}-${String(rfqCount + 1).padStart(2, '0')}`
      const { data: newRfq, error } = await supabase
        .from('quote_rfqs')
        .insert({
          company_id:  companyId,
          quote_id:    quoteId,
          supplier_id: selectedSupplier.id,
          rfq_number:  rfqNumber,
          status:      markSent ? 'sent' : 'draft',
          sent_at:     markSent ? new Date().toISOString() : null,
          sent_via:    'manual',
          notes:       createNotes.trim() || null,
          created_by:  employeeId,
        })
        .select('id')
        .single()
      if (error) throw error

      // Insert lines from preloaded items
      if (preloadedItems && preloadedItems.length > 0) {
        await supabase.from('quote_rfq_lines').insert(
          preloadedItems.map(item => ({
            company_id:       companyId,
            rfq_id:           newRfq.id,
            catalogue_item_id: item.catalogue_item_id,
            qty_requested:    item.qty_requested,
          }))
        )
      }

      onSaved()
      onClose()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to create RFQ')
    } finally {
      setSaving(false)
    }
  }

  // ── Save responses (Mode B) ──
  async function handleSaveResponses() {
    if (!rfq?.lines) return
    setSaving(true)
    try {
      for (const line of rfq.lines) {
        const r = responses[line.id]
        if (!r) continue
        const price = r.price ? parseFloat(r.price) : null
        await supabase.from('quote_rfq_lines').update({
          supplier_price:         price,
          supplier_ref:           r.ref.trim() || null,
          supplier_qty_available: r.qty ? parseFloat(r.qty) : null,
          lead_time_days:         r.lead ? parseInt(r.lead) : null,
          supplier_notes:         r.notes.trim() || null,
          responded_at:           price !== null ? new Date().toISOString() : null,
        }).eq('id', line.id)
      }

      // Update RFQ status based on responses
      const allLines = rfq.lines
      const respondedCount = allLines.filter(l => {
        const r = responses[l.id]
        return r?.price && parseFloat(r.price) > 0
      }).length
      const newStatus =
        respondedCount === 0 ? rfq.status :
        respondedCount === allLines.length ? 'responded' : 'partially_responded'
      if (newStatus !== rfq.status) {
        await supabase.from('quote_rfqs').update({
          status: newStatus,
          responded_at: new Date().toISOString(),
        }).eq('id', rfq.id)
      }

      onSaved()
      onClose()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save responses')
    } finally {
      setSaving(false)
    }
  }

  // ── Mark RFQ as sent ──
  async function markSent() {
    if (!rfq) return
    await supabase.from('quote_rfqs').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    }).eq('id', rfq.id)
    onSaved()
  }

  // ── Add contractor ──
  async function addSupplier() {
    if (!supplierQuery.trim()) return
    const { data } = await supabase
      .from('contractors')
      .insert({ company_id: companyId, name: supplierQuery.trim(), partner_kind: 'supplier' })
      .select('id, name, partner_kind')
      .single()
    if (data) {
      setSelectedSupplier(data as Contractor)
      setSupplierQuery(data.name)
      setShowSupDrop(false)
    }
  }

  const modeB = rfq !== null

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div className="fixed inset-0 z-40" onClick={onClose} />
      )}

      {/* Panel */}
      <div className={cn(
        'fixed top-0 right-0 h-full w-[420px] bg-background border-l border-divider z-50',
        'shadow-xl transition-transform duration-200 flex flex-col',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}>
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-divider shrink-0">
          <div>
            {modeB ? (
              <>
                <p className="text-[10px] text-text-secondary font-mono mb-0.5">{rfq!.rfq_number}</p>
                <h2 className="text-[15px] font-semibold text-text-primary">
                  {rfq!.supplier_name ?? 'Unknown supplier'}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  {(() => {
                    const cfg = RFQ_STATUS_CONFIG[rfq!.status]
                    return (
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', cfg.colour, cfg.bgColour)}>
                        {cfg.label}
                      </span>
                    )
                  })()}
                  {rfq!.sent_at && (
                    <span className="text-[11px] text-text-secondary">
                      Sent {new Date(rfq!.sent_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <h2 className="text-[15px] font-semibold text-text-primary">New RFQ</h2>
            )}
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors mt-0.5">
            <span className="material-icons">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* ── MODE A: Create ── */}
          {!modeB && (
            <>
              {/* Supplier search */}
              <div>
                <label className="block text-[12px] font-medium text-text-secondary mb-1.5">Supplier</label>
                <div className="relative">
                  <input
                    value={supplierQuery}
                    onChange={e => { setSupplierQuery(e.target.value); setSelectedSupplier(null) }}
                    onFocus={() => supplierQuery && setShowSupDrop(true)}
                    onBlur={() => setTimeout(() => setShowSupDrop(false), 150)}
                    placeholder="Search or add new supplier…"
                    className="h-9 w-full rounded-md border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary transition-colors"
                  />
                  {showSupDrop && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-divider rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                      {supplierResults.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={() => { setSelectedSupplier(c); setSupplierQuery(c.name); setShowSupDrop(false) }}
                          className="w-full flex items-center justify-between px-3 py-2 text-[13px] hover:bg-surface-elevated text-left border-b border-divider last:border-0"
                        >
                          <span className="text-text-primary">{c.name}</span>
                          <span className="text-[10px] text-text-secondary capitalize">{c.partner_kind}</span>
                        </button>
                      ))}
                      {supplierQuery.trim() && !supplierResults.some(c => c.name.toLowerCase() === supplierQuery.toLowerCase()) && (
                        <button
                          type="button"
                          onMouseDown={() => void addSupplier()}
                          className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-primary hover:bg-surface-elevated text-left"
                        >
                          <span className="material-icons text-[15px]">add</span>
                          Add &ldquo;{supplierQuery}&rdquo; as new supplier
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Pre-loaded items */}
              {preloadedItems && preloadedItems.length > 0 && (
                <div>
                  <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                    Items in this RFQ
                  </label>
                  <div className="border border-divider rounded-lg overflow-hidden divide-y divide-divider">
                    {preloadedItems.map(item => (
                      <div key={item.line_id} className="flex items-center gap-3 px-3 py-2.5">
                        <span className="material-icons text-[16px] text-green-500">check</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-text-primary truncate">{item.item_name}</p>
                          {item.item_sku && <p className="text-[10px] text-text-secondary font-mono">{item.item_sku}</p>}
                        </div>
                        <span className="text-[11px] text-text-secondary shrink-0">qty: {item.qty_requested}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-[12px] font-medium text-text-secondary mb-1.5">Notes (optional)</label>
                <textarea
                  value={createNotes}
                  onChange={e => setCreateNotes(e.target.value)}
                  rows={3}
                  placeholder="Any instructions for this supplier…"
                  className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-primary resize-none transition-colors"
                />
              </div>
            </>
          )}

          {/* ── MODE B: Log response ── */}
          {modeB && rfq?.lines && (
            <>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary border-b border-divider pb-2 mb-3">
                  Items &amp; Responses
                </p>
                <div className="space-y-5">
                  {rfq.lines.map(line => {
                    const r = responses[line.id] ?? { price: '', ref: '', qty: '', lead: '', notes: '' }
                    return (
                      <div key={line.id} className="rounded-lg border border-divider p-3 space-y-2">
                        <div>
                          <p className="text-[12px] font-semibold text-text-primary">{line.item_name}</p>
                          <p className="text-[10px] text-text-secondary font-mono">
                            {line.item_sku ?? '—'} &middot; qty requested: {line.qty_requested}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-text-secondary block mb-0.5">Their price (R)</label>
                            <input
                              type="number" min="0" step="0.01"
                              value={r.price}
                              onChange={e => setResponses(prev => ({ ...prev, [line.id]: { ...r, price: e.target.value } }))}
                              placeholder="—"
                              className="h-7 w-full rounded border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-text-secondary block mb-0.5">Their ref</label>
                            <input
                              value={r.ref}
                              onChange={e => setResponses(prev => ({ ...prev, [line.id]: { ...r, ref: e.target.value } }))}
                              placeholder="—"
                              className="h-7 w-full rounded border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-text-secondary block mb-0.5">Qty available</label>
                            <input
                              type="number" min="0"
                              value={r.qty}
                              onChange={e => setResponses(prev => ({ ...prev, [line.id]: { ...r, qty: e.target.value } }))}
                              placeholder="—"
                              className="h-7 w-full rounded border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-text-secondary block mb-0.5">Lead time (days)</label>
                            <input
                              type="number" min="0"
                              value={r.lead}
                              onChange={e => setResponses(prev => ({ ...prev, [line.id]: { ...r, lead: e.target.value } }))}
                              placeholder="—"
                              className="h-7 w-full rounded border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-text-secondary block mb-0.5">Notes</label>
                          <input
                            value={r.notes}
                            onChange={e => setResponses(prev => ({ ...prev, [line.id]: { ...r, notes: e.target.value } }))}
                            placeholder="—"
                            className="h-7 w-full rounded border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary"
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Response document */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary border-b border-divider pb-2 mb-3">
                  Response document
                </p>
                {rfq.response_document_name ? (
                  <div className="flex items-center gap-2 text-[12px] text-green-600">
                    <span className="material-icons text-[16px]">description</span>
                    {rfq.response_document_name}
                    <span className="material-icons text-[14px]">check_circle</span>
                  </div>
                ) : (
                  <div>
                    <button
                      type="button"
                      onClick={() => alert('Document upload coming in Phase 2.')}
                      className="flex items-center gap-2 h-8 px-3 rounded-lg border border-dashed border-divider text-[12px] text-text-secondary hover:bg-surface-elevated transition-colors"
                    >
                      <span className="material-icons text-[15px]">upload_file</span>
                      Upload their PDF / Excel
                    </button>
                    <p className="text-[11px] text-text-secondary mt-1 italic">
                      When email integration is enabled, responses will be parsed automatically. (Phase 2)
                    </p>
                  </div>
                )}
              </div>

              {/* Mark sent (if draft) */}
              {rfq.status === 'draft' && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                  <p className="text-[12px] text-amber-700 mb-2">This RFQ is still in draft — have you sent it to the supplier?</p>
                  <button
                    type="button"
                    onClick={() => void markSent()}
                    className="h-7 px-3 rounded-md bg-amber-600 text-white text-[11px] font-medium hover:bg-amber-700 transition-colors"
                  >
                    Mark as sent manually
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-divider shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-divider text-[13px] text-text-secondary hover:bg-surface-elevated transition-colors"
          >
            Cancel
          </button>
          {!modeB ? (
            <>
              <button
                type="button"
                onClick={() => void handleCreate(false)}
                disabled={!selectedSupplier || saving}
                className="h-9 px-4 rounded-lg border border-primary text-[13px] text-primary font-medium hover:bg-primary/5 transition-colors disabled:opacity-50"
              >
                {saving ? '…' : 'Create — draft'}
              </button>
              <button
                type="button"
                onClick={() => void handleCreate(true)}
                disabled={!selectedSupplier || saving}
                className="h-9 px-5 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving ? '…' : 'Create + mark as sent'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void handleSaveResponses()}
              disabled={saving}
              className="h-9 px-5 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save responses'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
