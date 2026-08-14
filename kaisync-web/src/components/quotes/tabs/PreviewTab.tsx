'use client'

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import type { QuoteLine } from '@/types/quotes'

interface QuoteData {
  id: string
  quote_number: string
  status: string
  title: string | null
  valid_until: string | null
  scope_notes: string | null
  terms_and_conditions: string | null
}

interface Props {
  quoteId: string
  companyId: string
}

const VAT_RATE = 0.15

function fmtR(n: number) {
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function PreviewTab({ quoteId, companyId }: Props) {
  const supabase = createClient()
  const [quote, setQuote]   = useState<QuoteData | null>(null)
  const [lines, setLines]   = useState<QuoteLine[]>([])
  const [notes, setNotes]   = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [qRes, lRes] = await Promise.all([
      supabase.from('commercial_quotes').select('id,quote_number,status,title,valid_until,scope_notes,terms_and_conditions')
        .eq('id', quoteId).single(),
      supabase.from('commercial_quote_lines').select('*')
        .eq('quote_id', quoteId).eq('company_id', companyId).eq('is_excluded', false).order('sort_order'),
    ])
    setQuote(qRes.data as QuoteData)
    setLines((lRes.data ?? []) as QuoteLine[])
    setNotes((qRes.data as QuoteData | null)?.scope_notes ?? '')
    setLoading(false)
  }, [quoteId, companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load() }, [load])

  async function markAsSent() {
    setSaving(true)
    await supabase.from('commercial_quotes')
      .update({ status: 'sent', sent_at: new Date().toISOString(), scope_notes: notes.trim() || null })
      .eq('id', quoteId)
    setSaving(false)
    void load()
  }

  async function saveNotes() {
    await supabase.from('commercial_quotes').update({ scope_notes: notes.trim() || null }).eq('id', quoteId)
  }

  function comingSoon() {
    alert('PDF generation coming in Phase 2.')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 gap-2 text-text-secondary text-[13px]">
        <span className="material-icons animate-spin text-primary">refresh</span>
        Loading…
      </div>
    )
  }

  if (!quote) return null

  // Totals
  const subtotal = lines.reduce((s, l) => s + (l.unit_sell_price ?? 0) * (l.quantity ?? 1), 0)
  const vat      = subtotal * VAT_RATE
  const total    = subtotal + vat

  return (
    <div className="flex flex-col h-full space-y-6 overflow-y-auto">
      {/* Quote header */}
      <div className="border border-divider rounded-xl p-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] text-text-secondary mb-1">Customer quote</p>
          <h2 className="text-[20px] font-bold text-text-primary">{quote.quote_number}</h2>
          {quote.title && <p className="text-[14px] text-text-secondary mt-0.5">{quote.title}</p>}
        </div>
        <div className="text-right text-[12px] text-text-secondary space-y-1">
          <p>Date: <span className="text-text-primary font-medium">{new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' })}</span></p>
          {quote.valid_until && (
            <p>Valid until: <span className="text-text-primary font-medium">{new Date(quote.valid_until).toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' })}</span></p>
          )}
          <span className={cn(
            'inline-block text-[10px] px-2 py-0.5 rounded-full font-medium capitalize',
            quote.status === 'sent' ? 'bg-blue-50 text-blue-600' :
            quote.status === 'accepted' ? 'bg-green-50 text-green-600' :
            'bg-gray-100 text-gray-600',
          )}>
            {quote.status}
          </span>
        </div>
      </div>

      {/* Line items — customer view (no cost, no source) */}
      <div className="border border-divider rounded-xl overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-divider bg-surface-elevated text-text-secondary text-left">
              <th className="px-4 py-2.5 font-medium w-8">#</th>
              <th className="px-4 py-2.5 font-medium">Description</th>
              <th className="px-4 py-2.5 font-medium text-right w-14">Qty</th>
              <th className="px-4 py-2.5 font-medium w-16">Unit</th>
              <th className="px-4 py-2.5 font-medium text-right w-28">Unit price</th>
              <th className="px-4 py-2.5 font-medium text-right w-28">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => {
              const lineTotal = (line.unit_sell_price ?? 0) * (line.quantity ?? 1)
              return (
                <tr key={line.id} className="border-b border-divider last:border-0">
                  <td className="px-4 py-2.5 text-text-secondary">{idx + 1}</td>
                  <td className="px-4 py-2.5 text-text-primary font-medium">{line.description}</td>
                  <td className="px-4 py-2.5 text-right text-text-secondary">{line.quantity}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{line.unit}</td>
                  <td className="px-4 py-2.5 text-right text-text-secondary">{fmtR(line.unit_sell_price ?? 0)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-text-primary">{fmtR(lineTotal)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Totals */}
        <div className="border-t border-divider px-4 py-3 space-y-1.5 bg-surface-elevated">
          <div className="flex justify-between text-[12px] text-text-secondary">
            <span>Subtotal (excl. VAT)</span>
            <span className="font-medium text-text-primary">{fmtR(subtotal)}</span>
          </div>
          <div className="flex justify-between text-[12px] text-text-secondary">
            <span>VAT (15%)</span>
            <span className="font-medium text-text-primary">{fmtR(vat)}</span>
          </div>
          <div className="flex justify-between text-[14px] font-bold text-text-primary border-t border-divider pt-2 mt-2">
            <span>Total (incl. VAT)</span>
            <span>{fmtR(total)}</span>
          </div>
        </div>
      </div>

      {/* Notes / Terms */}
      <div>
        <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
          Notes / Terms (visible on quote)
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={() => void saveNotes()}
          rows={4}
          placeholder="Payment terms, scope inclusions/exclusions, assumptions…"
          className="w-full rounded-lg border border-divider bg-surface px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-primary resize-none transition-colors"
        />
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between pt-2 border-t border-divider">
        <button
          type="button"
          onClick={comingSoon}
          className="flex items-center gap-2 h-9 px-4 rounded-lg border border-divider text-[13px] text-text-secondary hover:bg-surface-elevated transition-colors"
        >
          <span className="material-icons text-[16px]">picture_as_pdf</span>
          Generate quote PDF
          <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full">Phase 2</span>
        </button>

        <button
          type="button"
          onClick={() => void markAsSent()}
          disabled={saving || quote.status === 'sent'}
          className="flex items-center gap-2 h-9 px-5 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : quote.status === 'sent' ? '✓ Sent to customer' : 'Mark as sent to customer'}
        </button>
      </div>
    </div>
  )
}
