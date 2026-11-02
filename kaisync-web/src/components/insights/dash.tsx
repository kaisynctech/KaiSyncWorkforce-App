'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { addDays, describeRange, pointLabel, weekStart, type DateRange, type Grain } from '@/lib/insights/period'
import { deltaPct } from '@/lib/insights/period'
import type { TableSpec } from '@/lib/insights/table'

/** Holds the last numbers on screen (dimmed) while new ones load. */
export function Loadable({ loading, error, hasData, children }: { loading: boolean; error: string | null; hasData: boolean; children: ReactNode }) {
  if (error && !hasData) {
    return (
      <div className="bg-surface border border-divider rounded-2xl p-10 text-center">
        <span className="material-icons text-[32px] text-slate-300">error_outline</span>
        <p className="text-[14px] text-text-primary mt-2">{error}</p>
      </div>
    )
  }
  if (!hasData) return <Skeleton />
  return (
    <div className={cn('transition-opacity duration-200', loading && 'opacity-55 pointer-events-none')} aria-busy={loading}>
      {children}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-label="Loading">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-[118px] rounded-2xl bg-slate-200/60" />)}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 h-[320px] rounded-2xl bg-slate-200/60" />
        <div className="h-[320px] rounded-2xl bg-slate-200/60" />
      </div>
    </div>
  )
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mt-8 mb-3">
      <h2 className="text-[15px] font-semibold text-text-primary">{children}</h2>
      {sub && <p className="text-[12.5px] text-text-secondary mt-0.5">{sub}</p>}
    </div>
  )
}

export const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}

/** Delta between two KPI objects for one key. */
export function d<K extends string>(cur: Partial<Record<K, unknown>> | null | undefined, prev: Partial<Record<K, unknown>> | null | undefined, key: K) {
  const c = cur?.[key], p = prev?.[key]
  if (c == null || p == null) return null
  return deltaPct(n(c), n(p))
}

/** Rolls a daily series up to weeks or months by summing the chosen fields. */
export function rollUp<T extends Record<string, unknown>>(rows: T[], dayKey: string, grain: Grain, fields: string[]): Record<string, unknown>[] {
  if (grain === 'day') return rows
  const map = new Map<string, Record<string, unknown>>()
  for (const r of rows) {
    const day = String(r[dayKey])
    const k = grain === 'week' ? weekStart(day) : `${day.slice(0, 7)}-01`
    const acc = map.get(k) ?? { [dayKey]: k, _days: 0 }
    for (const f of fields) acc[f] = n(acc[f]) + n(r[f])
    acc._days = n(acc._days) + 1
    map.set(k, acc)
  }
  return [...map.values()].sort((a, b) => String(a[dayKey]).localeCompare(String(b[dayKey])))
}

/** Hover title for a point: the day, the week ("Week of 5 Oct") or the month. */
export function pointTitle(x: string, grain: Grain): string {
  if (grain === 'week') return `Week of ${pointLabel(x, 'week')} – ${pointLabel(addDays(x, 6), 'week')}`
  if (grain === 'month') return describeRange({ from: x, to: x }).replace(/^\d+ /, '')
  return describeRange({ from: x, to: x })
}

/** Headline figures as a table (screen, CSV and PDF). */
export function kpiTable(title: string, rows: { measure: string; now: string; before: string; change: string }[]): TableSpec<{ measure: string; now: string; before: string; change: string }> {
  return {
    title,
    columns: [
      { key: 'measure', label: 'Measure', width: 2 },
      { key: 'now', label: 'This period' },
      { key: 'before', label: 'Previous period' },
      { key: 'change', label: 'Change' },
    ],
    rows,
  }
}

export function periodNote(r: DateRange) {
  return describeRange(r)
}
