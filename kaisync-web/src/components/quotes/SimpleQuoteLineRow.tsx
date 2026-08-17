'use client'

import { UNITS_OF_MEASURE } from '@/lib/units'
import type { SimpleQuoteLine } from './SimpleQuoteBuilder'

// ─── Unit select data ─────────────────────────────────────────────────────────

const COMMON_UNIT_VALUES = ['each', 'hour', 'half_hour', 'day', 'job', 'm', 'm2', 'm3', 'kg', 'litre', 'tonne']
const commonUnits = UNITS_OF_MEASURE.filter(u => COMMON_UNIT_VALUES.includes(u.value))
const otherUnits  = UNITS_OF_MEASURE.filter(u => !COMMON_UNIT_VALUES.includes(u.value))

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  line:     SimpleQuoteLine
  isOnly:   boolean
  onUpdate: (patch: Partial<SimpleQuoteLine>) => void
  onRemove: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SimpleQuoteLineRow({ line, isOnly, onUpdate, onRemove }: Props) {

  function handleQty(v: string) {
    const qty = Math.max(0, parseFloat(v) || 0)
    onUpdate({ qty, total: qty * line.unit_price })
  }

  function handlePrice(v: string) {
    const unit_price = Math.max(0, parseFloat(v) || 0)
    onUpdate({ unit_price, total: line.qty * unit_price })
  }

  // If the stored unit value isn't in our list (e.g. a free-text unit from
  // the old builder), surface it as a selectable option so it isn't lost.
  const unitInList = UNITS_OF_MEASURE.some(u => u.value === line.unit)

  return (
    <div
      className="grid gap-2 px-4 py-2.5 items-center group hover:bg-surface-elevated/50 transition-colors"
      style={{ gridTemplateColumns: '1.5rem 1fr 5rem 6rem 7.5rem 5.5rem 1.5rem' }}
    >
      {/* Drag handle (visual only) */}
      <span className="material-icons text-[16px] text-text-secondary/30 cursor-grab select-none">
        drag_indicator
      </span>

      {/* Description */}
      <input
        type="text"
        value={line.description}
        onChange={e => onUpdate({ description: e.target.value })}
        placeholder="Describe the work or item…"
        className="w-full bg-transparent text-[13px] text-text-primary placeholder-text-secondary/50 focus:outline-none"
      />

      {/* Qty */}
      <input
        type="number"
        min={0.001}
        step="any"
        value={line.qty || ''}
        onChange={e => handleQty(e.target.value)}
        placeholder="1"
        className="w-full text-right bg-transparent text-[13px] text-text-primary focus:outline-none"
      />

      {/* Unit */}
      <select
        value={line.unit}
        onChange={e => onUpdate({ unit: e.target.value })}
        className="w-full bg-transparent text-[13px] text-text-secondary focus:outline-none"
      >
        {/* Preserve a unit value not in our list */}
        {!unitInList && line.unit && (
          <option value={line.unit}>{line.unit}</option>
        )}
        <optgroup label="Common">
          {commonUnits.map(u => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </optgroup>
        <optgroup label="Other">
          {otherUnits.map(u => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </optgroup>
      </select>

      {/* Unit price */}
      <div className="flex items-center gap-1 justify-end">
        <span className="text-[12px] text-text-secondary shrink-0">R</span>
        <input
          type="number"
          min={0}
          step={0.01}
          value={line.unit_price === 0 ? '' : line.unit_price}
          onChange={e => handlePrice(e.target.value)}
          placeholder="0.00"
          className="w-full text-right bg-transparent text-[13px] text-text-primary focus:outline-none"
        />
      </div>

      {/* Line total (read-only) */}
      <div className="text-right text-[13px] text-text-secondary font-medium tabular-nums">
        R {line.total.toFixed(2)}
      </div>

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        disabled={isOnly}
        title="Remove line"
        className="text-text-secondary hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-0 disabled:pointer-events-none"
      >
        <span className="material-icons text-[16px]">close</span>
      </button>
    </div>
  )
}
