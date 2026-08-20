'use client'

/**
 * StockAdjustmentModal — Phase 1 stub
 *
 * A lightweight quick-adjust modal that directly updates qty_on_hand.
 * Mission #3 (Stock Adjustment Log) will replace this with an immutable
 * audit-trail RPC once the stock_adjustments migration is applied.
 */

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CatalogueItem } from '@/types/inventory'

interface Props {
  item:      CatalogueItem
  companyId: string
  employeeId: string
  onClose:   () => void
  onSaved:   (newQty: number) => void
}

export default function StockAdjustmentModal({ item, onClose, onSaved }: Props) {
  const [delta,   setDelta]   = useState('')
  const [reason,  setReason]  = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const current = item.qty_on_hand ?? 0

  async function handleSave() {
    const d = parseFloat(delta)
    if (!Number.isFinite(d) || d === 0) {
      setError('Enter a non-zero adjustment amount.')
      return
    }
    setSaving(true)
    setError(null)
    const newQty = current + d
    const supabase = createClient()
    const { error: e } = await supabase
      .from('quote_catalogue_items')
      .update({ qty_on_hand: newQty })
      .eq('id', item.id)
    if (e) { setError(e.message); setSaving(false); return }
    onSaved(newQty)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm bg-surface rounded-xl shadow-2xl p-6 space-y-4">

        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-text-primary">Adjust stock</h2>
          <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <span className="material-icons text-[20px]">close</span>
          </button>
        </div>

        <div>
          <p className="text-[12px] text-text-secondary mb-1">{item.name}</p>
          <p className="text-[13px] text-text-primary">
            Current: <span className="font-semibold">{current % 1 === 0 ? String(current) : current.toFixed(3)}</span>
            {' '}
            {item.unit_of_measure ?? item.unit ?? 'each'}
          </p>
        </div>

        <div>
          <label className="block text-[12px] text-text-secondary mb-1">
            Adjustment (+&thinsp;increase&ensp;/&ensp;&minus;&thinsp;decrease)
          </label>
          <input
            autoFocus
            type="number"
            step="any"
            value={delta}
            onChange={e => setDelta(e.target.value)}
            placeholder="e.g. +5 or -2"
            className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary"
          />
          {delta !== '' && Number.isFinite(parseFloat(delta)) && (
            <p className="text-[11px] text-text-secondary mt-1">
              New total: <span className="font-medium text-text-primary">
                {(current + parseFloat(delta)).toFixed(
                  (current + parseFloat(delta)) % 1 === 0 ? 0 : 3
                )}
              </span>
            </p>
          )}
        </div>

        <div>
          <label className="block text-[12px] text-text-secondary mb-1">Reason (optional)</label>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. Stocktake correction"
            className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary"
          />
        </div>

        {error && <p className="text-[12px] text-red-500">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-4 rounded-lg border border-divider text-[12px] text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !delta}
            className="h-8 px-4 rounded-lg bg-primary text-white text-[12px] font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}
