'use client'

import { cn } from '@/lib/utils'

/** Coloured status pills used on Money list pages (same pattern as Quotes). */
export type StatusTabDef = {
  id: string
  label: string
  /** Row statuses that belong to this tab; null = All */
  match: string[] | null
  idle: string
  active: string
}

export const MONEY_TH = 'data-th !py-1.5 !px-2.5 text-[11px] !text-text-primary'
export const MONEY_TD = 'data-td !py-1.5 !px-2.5 text-[12px]'

export function countByStatusTab<T extends { status: string }>(
  rows: T[],
  tabs: StatusTabDef[],
): Record<string, number> {
  const counts: Record<string, number> = { all: rows.length }
  for (const t of tabs) {
    if (!t.match) continue
    counts[t.id] = rows.filter(r => t.match!.includes(r.status)).length
  }
  return counts
}

export function filterByStatusTab<T extends { status: string }>(
  rows: T[],
  tabs: StatusTabDef[],
  tabId: string,
): T[] {
  const t = tabs.find(x => x.id === tabId)
  if (!t?.match) return rows
  return rows.filter(r => t.match!.includes(r.status))
}

export function StatusFilterTabs({
  tabs,
  value,
  counts,
  onChange,
}: {
  tabs: StatusTabDef[]
  value: string
  counts: Record<string, number>
  onChange: (id: string) => void
}) {
  return (
    <div className="flex gap-1 flex-wrap ml-auto">
      {tabs.map(f => {
        const count = counts[f.id] ?? 0
        const on = value === f.id
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange(f.id)}
            className={cn(
              'h-8 px-2.5 rounded-md text-[11px] font-semibold border transition-colors bg-surface',
              on ? f.active : f.idle,
            )}
          >
            {f.label}
            {counts[f.id] != null && (
              <span className={cn('ml-1 tabular-nums font-medium', on ? 'text-white/85' : 'opacity-70')}>
                ({count})
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export const TAB_ALL: StatusTabDef = {
  id: 'all',
  label: 'All',
  match: null,
  idle: 'border-divider text-text-primary hover:bg-surface-elevated',
  active: 'bg-slate-800 text-white border-slate-800',
}
