'use client'

/**
 * Shared building blocks for Money-menu list pages (same pattern as Quotes):
 * header-funnel column filters, Reset button, tab colour presets and
 * client-side match helpers. Built on ColumnHeaderFilter / StatusFilterTabs.
 */

import {
  ColumnHeaderFilter,
  ColumnFilterText,
  ColumnFilterMoney,
  ColumnFilterDateRange,
  ColumnFilterStatus,
  ColumnFilterClear,
} from '@/components/ui/ColumnHeaderFilter'
import type { StatusTabDef } from '@/components/ui/StatusFilterTabs'

export type ColumnOption = { id: string; label: string }

/* ── Match helpers ─────────────────────────────────────────────────────── */

export function matchText(value: string | null | undefined, needle: string): boolean {
  if (!needle) return true
  return (value ?? '').toLowerCase().includes(needle.toLowerCase())
}

export function matchMoney(amount: number | null | undefined, min: string, max: string): boolean {
  const n = Number(amount ?? 0)
  if (min !== '' && !Number.isNaN(Number(min)) && n < Number(min)) return false
  if (max !== '' && !Number.isNaN(Number(max)) && n > Number(max)) return false
  return true
}

export function inDateRange(iso: string | null | undefined, from: string, to: string): boolean {
  const d = iso ? iso.slice(0, 10) : ''
  if (!d) return !(from || to)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

export function toggleInList(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter(x => x !== id) : [...list, id]
}

/* ── Tab colour presets (match status badge families) ──────────────────── */

export type TabTone = 'slate' | 'blue' | 'indigo' | 'amber' | 'green' | 'red' | 'purple' | 'gray'

const TONES: Record<TabTone, { idle: string; active: string }> = {
  slate: { idle: 'border-slate-200 text-slate-700 hover:bg-slate-50', active: 'bg-slate-700 text-white border-slate-700' },
  blue: { idle: 'border-blue-200 text-blue-700 hover:bg-blue-50', active: 'bg-blue-600 text-white border-blue-600' },
  indigo: { idle: 'border-indigo-200 text-indigo-700 hover:bg-indigo-50', active: 'bg-indigo-600 text-white border-indigo-600' },
  amber: { idle: 'border-amber-200 text-amber-700 hover:bg-amber-50', active: 'bg-amber-500 text-white border-amber-500' },
  green: { idle: 'border-green-200 text-green-700 hover:bg-green-50', active: 'bg-green-600 text-white border-green-600' },
  red: { idle: 'border-red-200 text-red-700 hover:bg-red-50', active: 'bg-red-600 text-white border-red-600' },
  purple: { idle: 'border-purple-200 text-purple-700 hover:bg-purple-50', active: 'bg-purple-600 text-white border-purple-600' },
  gray: { idle: 'border-gray-200 text-gray-600 hover:bg-gray-50', active: 'bg-gray-500 text-white border-gray-500' },
}

export function statusTab(id: string, label: string, match: string[], tone: TabTone): StatusTabDef {
  return { id, label, match, ...TONES[tone] }
}

/* ── Header filter wrappers ────────────────────────────────────────────── */

export function TextHeaderFilter({
  label,
  value,
  onChange,
  placeholder,
  align,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  align?: 'left' | 'right'
}) {
  return (
    <ColumnHeaderFilter label={label} active={!!value} align={align}>
      <ColumnFilterText value={value} onChange={onChange} placeholder={placeholder} />
      <ColumnFilterClear disabled={!value} onClear={() => onChange('')} />
    </ColumnHeaderFilter>
  )
}

export function MoneyHeaderFilter({
  label,
  min,
  max,
  onChange,
}: {
  label: string
  min: string
  max: string
  onChange: (patch: { min: string; max: string }) => void
}) {
  return (
    <ColumnHeaderFilter label={label} align="right" active={!!(min || max)}>
      <ColumnFilterMoney
        min={min}
        max={max}
        onMin={v => onChange({ min: v, max })}
        onMax={v => onChange({ min, max: v })}
      />
      <ColumnFilterClear disabled={!min && !max} onClear={() => onChange({ min: '', max: '' })} />
    </ColumnHeaderFilter>
  )
}

export function DateHeaderFilter({
  label,
  from,
  to,
  onChange,
}: {
  label: string
  from: string
  to: string
  onChange: (patch: { from: string; to: string }) => void
}) {
  return (
    <ColumnHeaderFilter label={label} active={!!(from || to)}>
      <ColumnFilterDateRange
        from={from}
        to={to}
        onFrom={v => onChange({ from: v, to })}
        onTo={v => onChange({ from, to: v })}
      />
      <ColumnFilterClear disabled={!from && !to} onClear={() => onChange({ from: '', to: '' })} />
    </ColumnHeaderFilter>
  )
}

export function StatusHeaderFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: ColumnOption[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <ColumnHeaderFilter label={label} active={selected.length > 0}>
      <ColumnFilterStatus
        options={options}
        selected={selected}
        onToggle={id => onChange(toggleInList(selected, id))}
      />
      <ColumnFilterClear disabled={selected.length === 0} onClear={() => onChange([])} />
    </ColumnHeaderFilter>
  )
}

/* ── Reset button ──────────────────────────────────────────────────────── */

export function ResetFiltersButton({ disabled, onReset }: { disabled: boolean; onReset: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onReset}
      className="h-8 px-2.5 rounded-md border border-divider text-[11px] font-medium text-text-secondary hover:bg-surface-elevated disabled:opacity-40 inline-flex items-center gap-1"
    >
      <span className="material-icons text-[14px]">filter_alt_off</span>
      Reset filters
    </button>
  )
}
