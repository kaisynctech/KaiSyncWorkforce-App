'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { ADJUSTMENT_TYPES, getAdjustmentConfig } from '@/lib/stock'
import type { AdjustmentType, AdjustmentResult, CatalogueItem } from '@/types/inventory'
import { getUnitLabel } from '@/lib/units'

interface Props {
  item: CatalogueItem
  companyId: string
  employeeId: string
  onClose: () => void
  onSaved: (newQty: number) => void
}

export default function StockAdjustmentModal({ item, companyId, employeeId, onClose, onSaved }: Props) {
  const supabase = createClient()

  const [type,      setType]      = useState<AdjustmentType>('received')
  const [qty,       setQty]       = useState('1')
  const [direction, setDirection] = useState<'add' | 'remove'>('add')
  const [notes,     setNotes]     = useState('')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  // Auto-set direction when type changes
  useEffect(() => {
    const config = getAdjustmentConfig(type)
    if (config.direction === 'in')  setDirection('add')
    if (config.direction === 'out') setDirection('remove')
    // 'either' — leave as user set
  }, [type])

  const qtyNum    = Math.max(parseFloat(qty) || 0, 0)
  const qtyChange = direction === 'add' ? qtyNum : -qtyNum
  const newTotal  = (item.qty_on_hand ?? 0) + qtyChange
  const unitLabel = getUnitLabel(item.unit_of_measure ?? item.unit ?? 'each')

  const config         = getAdjustmentConfig(type)
  const directionLocked = config.direction !== 'either'
  const notesRequired  = type === 'other' || type === 'count_correction'

  async function handleSave() {
    setError(null)

    if (qtyNum <= 0) {
      setError('Quantity must be greater than zero.')
      return
    }
    if (notesRequired && !notes.trim()) {
      setError(`Notes are required for "${config.label}".`)
      return
    }
    if (newTotal < 0) {
      setError('This would bring stock below zero.')
      return
    }

    setSaving(true)
    try {
      const { data, error: rpcErr } = await supabase.rpc('record_stock_adjustment', {
        p_company_id:        companyId,
        p_catalogue_item_id: item.id,
        p_adjusted_by:       employeeId,
        p_adjustment_type:   type,
        p_qty_change:        qtyChange,
        p_notes:             notes.trim() || null,
        p_reference_type:    'manual',
        p_reference_id:      null,
        p_allow_negative:    false,
      })

      if (rpcErr) throw rpcErr
      onSaved((data as AdjustmentResult).qty_after)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record adjustment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-6">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-divider shrink-0">
          <h2 className="text-[15px] font-semibold text-text-primary">
            Adjust stock
          </h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">

          {/* Item + current stock */}
          <div className="rounded-lg bg-surface-elevated border border-divider px-4 py-3">
            <p className="text-[12px] text-text-secondary mb-1">Item</p>
            <p className="text-[14px] font-semibold text-text-primary">{item.name}</p>
            <p className="text-[12px] text-text-secondary mt-2">
              Current stock:{' '}
              <span className="font-semibold text-text-primary">
                {item.qty_on_hand ?? 0} {unitLabel}
              </span>
            </p>
          </div>

          {/* Type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Type</label>
            <select
              value={type}
              onChange={e => setType(e.target.value as AdjustmentType)}
              className={inputCls}
            >
              {ADJUSTMENT_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Quantity + direction */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Quantity</label>
            <input
              type="number"
              min="0"
              step="0.001"
              value={qty}
              onChange={e => setQty(e.target.value)}
              className={inputCls}
            />
            <div className="flex gap-4 mt-1">
              <label className={cn('flex items-center gap-2 text-[13px] cursor-pointer select-none', directionLocked && direction === 'remove' ? 'opacity-40' : '')}>
                <input
                  type="radio"
                  name="direction"
                  value="add"
                  checked={direction === 'add'}
                  onChange={() => setDirection('add')}
                  disabled={directionLocked && config.direction === 'out'}
                  className="accent-primary"
                />
                <span className="text-text-secondary">Add stock</span>
              </label>
              <label className={cn('flex items-center gap-2 text-[13px] cursor-pointer select-none', directionLocked && direction === 'add' ? 'opacity-40' : '')}>
                <input
                  type="radio"
                  name="direction"
                  value="remove"
                  checked={direction === 'remove'}
                  onChange={() => setDirection('remove')}
                  disabled={directionLocked && config.direction === 'in'}
                  className="accent-primary"
                />
                <span className="text-text-secondary">Remove stock</span>
              </label>
            </div>
          </div>

          {/* Live preview */}
          {qtyNum > 0 && (
            <div className={cn(
              'rounded-lg border px-4 py-3 text-[13px]',
              newTotal < 0
                ? 'border-red-300 bg-red-50 text-red-600'
                : 'border-divider bg-surface-elevated text-text-secondary',
            )}>
              New total:{' '}
              <span className="font-semibold text-text-primary">
                {newTotal} {unitLabel}
              </span>
              {newTotal < 0 && (
                <span className="ml-2 text-red-500 font-medium">⚠ Cannot go below zero</span>
              )}
            </div>
          )}

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-secondary">
              Notes{notesRequired && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder={notesRequired ? 'Required for this adjustment type' : 'Optional'}
              className={cn(inputCls, 'resize-none h-auto py-2')}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[12px] text-red-600">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-divider shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-5 rounded-lg border border-divider text-[13px] text-text-secondary hover:bg-surface-elevated transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || qtyNum <= 0 || newTotal < 0}
            className="h-9 px-6 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Recording…' : 'Record adjustment'}
          </button>
        </div>

      </div>
    </div>
  )
}

const inputCls = 'h-9 w-full rounded-md border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary transition-colors'
