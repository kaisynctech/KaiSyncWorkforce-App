'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney, roundFinancial } from '@/lib/finance-calc'
import type { Rfq, RfqLine, RfqRecipient, RfqResponseLine } from '@/types/commercial'

interface ResponseLineLocal {
  rfq_line_id: string
  existing_id?: string
  unit_price: string
  lead_time_days: string
  availability_notes: string
}

export default function RfqResponsesPage() {
  const { id: rfqId } = useParams<{ id: string }>()
  const router = useRouter()

  const [rfq, setRfq] = useState<Rfq | null>(null)
  const [lines, setLines] = useState<RfqLine[]>([])
  const [recipients, setRecipients] = useState<RfqRecipient[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [responseLines, setResponseLines] = useState<Record<string, ResponseLineLocal[]>>({}) // keyed by recipient_id
  const [recipientMeta, setRecipientMeta] = useState<Record<string, { vatRate: string; deliveryDays: string; validUntil: string; notes: string }>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)

    const [{ data: rfqData }, { data: lineData }, { data: recipData }, { data: respData }] = await Promise.all([
      supabase.from('rfqs').select('*').eq('id', rfqId).maybeSingle(),
      supabase.from('rfq_lines').select('*').eq('rfq_id', rfqId).order('sort_order'),
      supabase.from('rfq_recipients').select('*, supplier:contractors(id, name, email, phone)').eq('rfq_id', rfqId).order('created_at'),
      supabase.from('rfq_response_lines').select('*').eq('rfq_id', rfqId),
    ])

    setRfq(rfqData as Rfq | null)
    const rfqLines = (lineData ?? []) as RfqLine[]
    const rfqRecipients = (recipData ?? []) as RfqRecipient[]
    setLines(rfqLines)
    setRecipients(rfqRecipients)

    if (rfqRecipients.length > 0 && !activeTab) {
      setActiveTab(rfqRecipients[0].id)
    }

    // Build local response state per recipient
    const respMap = new Map<string, RfqResponseLine[]>()
    for (const r of (respData ?? []) as RfqResponseLine[]) {
      if (!respMap.has(r.recipient_id)) respMap.set(r.recipient_id, [])
      respMap.get(r.recipient_id)!.push(r)
    }

    const newResponseLines: Record<string, ResponseLineLocal[]> = {}
    const newMeta: Record<string, { vatRate: string; deliveryDays: string; validUntil: string; notes: string }> = {}

    for (const rec of rfqRecipients) {
      const existing = respMap.get(rec.id) ?? []
      newResponseLines[rec.id] = rfqLines.map(l => {
        const found = existing.find(e => e.rfq_line_id === l.id)
        return {
          rfq_line_id: l.id,
          existing_id: found?.id,
          unit_price: found ? String(found.unit_price) : '',
          lead_time_days: found?.lead_time_days != null ? String(found.lead_time_days) : '',
          availability_notes: found?.availability_notes ?? '',
        }
      })
      newMeta[rec.id] = {
        vatRate: '15',
        deliveryDays: rec.response_delivery_days != null ? String(rec.response_delivery_days) : '',
        validUntil: rec.response_valid_until ?? '',
        notes: rec.response_notes ?? '',
      }
    }
    setResponseLines(newResponseLines)
    setRecipientMeta(newMeta)
    setLoading(false)
  }, [rfqId, activeTab])

  useEffect(() => { void load() }, [load])

  function updateResponseLine(recipientId: string, rfqLineId: string, field: string, value: string) {
    setResponseLines(prev => ({
      ...prev,
      [recipientId]: (prev[recipientId] ?? []).map(l =>
        l.rfq_line_id === rfqLineId ? { ...l, [field]: value } : l
      ),
    }))
  }

  async function saveResponses(recipientId: string, newStatus?: string) {
    if (!companyId) return
    setSaving(true)
    setError(null)
    const supabase = createClient()

    const meta = recipientMeta[recipientId] ?? {}
    const vatRate = Number(meta.vatRate) / 100 || 0.15
    const recLines = responseLines[recipientId] ?? []

    // Upsert response lines
    const payloads = recLines.filter(l => l.unit_price !== '').map(l => {
      const rfqLine = lines.find(rl => rl.id === l.rfq_line_id)
      const qty = rfqLine?.quantity ?? 1
      const up = Number(l.unit_price) || 0
      const subtotal = roundFinancial(qty * up)
      const vat = roundFinancial(subtotal * vatRate)
      return {
        ...(l.existing_id ? { id: l.existing_id } : {}),
        company_id: companyId,
        rfq_id: rfqId,
        recipient_id: recipientId,
        rfq_line_id: l.rfq_line_id,
        unit_price: up,
        quantity: qty,
        subtotal,
        vat_rate: vatRate,
        vat_amount: vat,
        line_total: roundFinancial(subtotal + vat),
        lead_time_days: l.lead_time_days ? Number(l.lead_time_days) : null,
        availability_notes: l.availability_notes.trim() || null,
      }
    })

    if (payloads.length > 0) {
      await supabase.from('rfq_response_lines').upsert(payloads, { onConflict: 'id' })
    }

    // Recalculate totals
    const { data: allLines } = await supabase.from('rfq_response_lines').select('subtotal, vat_amount, line_total').eq('recipient_id', recipientId)
    const subtotal = (allLines ?? []).reduce((s: number, l: { subtotal: number }) => s + l.subtotal, 0)
    const vatAmt = (allLines ?? []).reduce((s: number, l: { vat_amount: number }) => s + l.vat_amount, 0)

    const now = new Date().toISOString()
    await supabase.from('rfq_recipients').update({
      response_subtotal: roundFinancial(subtotal),
      response_vat_amount: roundFinancial(vatAmt),
      response_total: roundFinancial(subtotal + vatAmt),
      response_delivery_days: meta.deliveryDays ? Number(meta.deliveryDays) : null,
      response_valid_until: meta.validUntil || null,
      response_notes: meta.notes.trim() || null,
      ...(newStatus ? { status: newStatus } : {}),
      ...(newStatus === 'responded' ? { responded_at: now } : {}),
      ...(newStatus === 'declined' ? { declined_at: now } : {}),
      updated_at: now,
    }).eq('id', recipientId)

    // Update RFQ status if all responded
    const { data: allRec } = await supabase.from('rfq_recipients').select('status').eq('rfq_id', rfqId)
    const anyResponded = (allRec ?? []).some((r: { status: string }) => r.status === 'responded')
    if (anyResponded) {
      await supabase.from('rfqs').update({ status: 'responses_received', updated_at: now }).eq('id', rfqId)
    }

    setSaving(false)
    showToast(newStatus === 'responded' ? 'Marked as responded!' : newStatus === 'declined' ? 'Marked as declined' : 'Response saved.')
    void load()
  }

  if (loading) return <p className="p-6 text-[13px] text-text-secondary">Loading…</p>
  if (!rfq) return <p className="p-6 text-[13px] text-text-secondary">RFQ not found</p>

  const activeRecipient = recipients.find(r => r.id === activeTab)

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <button onClick={() => router.push(`/dashboard/supply/rfqs/${rfqId}`)} className="text-text-secondary hover:text-text-primary">
          <span className="material-icons text-[20px]">arrow_back</span>
        </button>
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold text-text-primary">Supplier Responses — {rfq.rfq_number ?? rfq.title}</h1>
          <p className="text-[12px] text-text-secondary">{recipients.length} supplier{recipients.length !== 1 ? 's' : ''} invited</p>
        </div>
        <div className="ml-auto">
          <a href={`/dashboard/supply/rfqs/${rfqId}/compare`}
            className="btn-primary h-9 px-4 text-[13px] flex items-center gap-1">
            <span className="material-icons text-[18px]">compare</span>
            Compare
          </a>
        </div>
      </div>

      {error && <div className="mx-4 mt-2 p-2 rounded bg-error/10 text-error text-[12px]">{error}</div>}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-success text-white px-4 py-2 rounded-lg shadow-lg text-[13px] z-50 pointer-events-none">
          {toast}
        </div>
      )}

      {recipients.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[13px] text-text-secondary">No suppliers invited to this RFQ yet.</p>
        </div>
      ) : (
        <>
          {/* Supplier tabs */}
          <div className="flex border-b border-divider shrink-0 px-4 overflow-x-auto">
            {recipients.map(r => {
              const name = (r.supplier as { name: string } | undefined)?.name ?? 'Supplier'
              return (
                <button key={r.id} onClick={() => setActiveTab(r.id)}
                  className={`px-4 py-2.5 text-[13px] font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === r.id ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                  {name}
                  <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${r.status === 'responded' ? 'bg-success/10 text-success' : r.status === 'declined' ? 'bg-error/10 text-error' : 'bg-surface-elevated text-text-secondary'}`}>
                    {r.status}
                  </span>
                </button>
              )
            })}
          </div>

          {activeRecipient && (
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {/* Recipient meta */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[12px] text-text-secondary mb-1">VAT Rate (%)</label>
                  <input type="number" className="input h-9 text-[13px] w-full"
                    value={recipientMeta[activeRecipient.id]?.vatRate ?? '15'}
                    onChange={e => setRecipientMeta(m => ({ ...m, [activeRecipient.id]: { ...m[activeRecipient.id], vatRate: e.target.value } }))} />
                </div>
                <div>
                  <label className="block text-[12px] text-text-secondary mb-1">Delivery Days</label>
                  <input type="number" className="input h-9 text-[13px] w-full"
                    value={recipientMeta[activeRecipient.id]?.deliveryDays ?? ''}
                    onChange={e => setRecipientMeta(m => ({ ...m, [activeRecipient.id]: { ...m[activeRecipient.id], deliveryDays: e.target.value } }))} />
                </div>
                <div>
                  <label className="block text-[12px] text-text-secondary mb-1">Valid Until</label>
                  <input type="date" className="input h-9 text-[13px] w-full"
                    value={recipientMeta[activeRecipient.id]?.validUntil ?? ''}
                    onChange={e => setRecipientMeta(m => ({ ...m, [activeRecipient.id]: { ...m[activeRecipient.id], validUntil: e.target.value } }))} />
                </div>
                <div>
                  <label className="block text-[12px] text-text-secondary mb-1">Notes</label>
                  <input className="input h-9 text-[13px] w-full"
                    value={recipientMeta[activeRecipient.id]?.notes ?? ''}
                    onChange={e => setRecipientMeta(m => ({ ...m, [activeRecipient.id]: { ...m[activeRecipient.id], notes: e.target.value } }))} />
                </div>
              </div>

              {/* Line items */}
              <div className="overflow-x-auto">
                <table className="w-full" style={{ minWidth: 700 }}>
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className="data-th text-left">Description</th>
                      <th className="data-th text-right">Qty</th>
                      <th className="data-th text-right">Unit</th>
                      <th className="data-th text-right">Unit Price</th>
                      <th className="data-th text-right">Lead Time</th>
                      <th className="data-th text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(rfqLine => {
                      const resp = (responseLines[activeRecipient.id] ?? []).find(r => r.rfq_line_id === rfqLine.id)
                      const vatRate = Number(recipientMeta[activeRecipient.id]?.vatRate ?? 15) / 100
                      const up = Number(resp?.unit_price ?? 0)
                      const lineTotal = up > 0 ? roundFinancial(rfqLine.quantity * up * (1 + vatRate)) : 0
                      return (
                        <tr key={rfqLine.id} className="border-b border-divider">
                          <td className="data-td text-[13px]">{rfqLine.description}</td>
                          <td className="data-td text-[13px] text-right">{rfqLine.quantity}</td>
                          <td className="data-td text-[12px] text-text-secondary text-right">{rfqLine.unit}</td>
                          <td className="data-td text-right">
                            <input type="number" step="0.01" className="input h-8 text-[13px] w-28 text-right"
                              placeholder="0.00"
                              value={resp?.unit_price ?? ''}
                              onChange={e => updateResponseLine(activeRecipient.id, rfqLine.id, 'unit_price', e.target.value)} />
                          </td>
                          <td className="data-td text-right">
                            <input type="number" className="input h-8 text-[13px] w-20 text-right"
                              placeholder="days"
                              value={resp?.lead_time_days ?? ''}
                              onChange={e => updateResponseLine(activeRecipient.id, rfqLine.id, 'lead_time_days', e.target.value)} />
                          </td>
                          <td className="data-td text-[13px] text-right font-medium">{lineTotal > 0 ? fmtMoney(lineTotal) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button onClick={() => saveResponses(activeRecipient.id)} disabled={saving}
                  className="btn-secondary h-9 px-4 text-[13px] disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save Response'}
                </button>
                {activeRecipient.status !== 'responded' && (
                  <button onClick={() => saveResponses(activeRecipient.id, 'responded')} disabled={saving}
                    className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">
                    Mark as Responded
                  </button>
                )}
                {activeRecipient.status !== 'declined' && (
                  <button onClick={() => saveResponses(activeRecipient.id, 'declined')} disabled={saving}
                    className="h-9 px-4 text-[13px] text-error border border-error rounded-lg hover:bg-error/10 disabled:opacity-50">
                    Mark as Declined
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
