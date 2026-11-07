'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Compact column header with a funnel icon. Click opens a popover filter —
 * same idea as classic “Manage Quotes” grids (icon in the header, not a
 * second always-visible filter row).
 */
export function ColumnHeaderFilter({
  label,
  align = 'left',
  active,
  children,
}: {
  label: string
  align?: 'left' | 'right'
  active: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative inline-flex items-center gap-0.5 max-w-full',
        align === 'right' && 'flex-row-reverse ml-auto',
      )}
    >
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={`Filter ${label}`}
        aria-expanded={open}
        onClick={e => {
          e.stopPropagation()
          setOpen(v => !v)
        }}
        className={cn(
          'inline-flex items-center justify-center h-3.5 w-3.5 rounded shrink-0 transition-colors',
          active
            ? 'text-primary bg-primary/10'
            : 'text-text-secondary/70 hover:text-text-primary hover:bg-surface',
        )}
      >
        <span className="material-icons text-[11px] leading-none">filter_alt</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`${label} filter`}
          className={cn(
            'absolute top-full z-40 mt-1 w-[220px] rounded-lg border border-divider bg-surface shadow-lg p-2.5',
            align === 'right' ? 'right-0' : 'left-0',
          )}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function ColumnFilterText({
  value,
  onChange,
  placeholder = 'Contains…',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      autoFocus
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="form-input h-8 w-full text-[12px]"
    />
  )
}

export function ColumnFilterMoney({
  min,
  max,
  onMin,
  onMax,
}: {
  min: string
  max: string
  onMin: (v: string) => void
  onMax: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] text-text-secondary">Min</label>
      <input
        value={min}
        onChange={e => onMin(e.target.value)}
        inputMode="decimal"
        placeholder="0"
        className="form-input h-8 w-full text-[12px]"
      />
      <label className="text-[11px] text-text-secondary">Max</label>
      <input
        value={max}
        onChange={e => onMax(e.target.value)}
        inputMode="decimal"
        placeholder="Any"
        className="form-input h-8 w-full text-[12px]"
      />
    </div>
  )
}

export function ColumnFilterDateRange({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] text-text-secondary">From</label>
      <input
        type="date"
        value={from}
        onChange={e => onFrom(e.target.value)}
        className="form-input h-8 w-full text-[12px]"
      />
      <label className="text-[11px] text-text-secondary">To</label>
      <input
        type="date"
        value={to}
        onChange={e => onTo(e.target.value)}
        className="form-input h-8 w-full text-[12px]"
      />
    </div>
  )
}

export function ColumnFilterStatus({
  options,
  selected,
  onToggle,
}: {
  options: { id: string; label: string }[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-0.5 max-h-48 overflow-auto">
      {options.map(opt => {
        const on = selected.includes(opt.id)
        return (
          <label
            key={opt.id}
            className="flex items-center gap-2 px-1 py-1 rounded hover:bg-surface-elevated cursor-pointer text-[12px] text-text-primary"
          >
            <input
              type="checkbox"
              checked={on}
              onChange={() => onToggle(opt.id)}
              className="rounded border-divider"
            />
            <span className="capitalize">{opt.label}</span>
          </label>
        )
      })}
    </div>
  )
}

export function ColumnFilterClear({ onClear, disabled }: { onClear: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClear}
      className="mt-2 w-full h-7 rounded-md text-[11px] font-medium text-primary hover:bg-primary/5 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      Clear
    </button>
  )
}
