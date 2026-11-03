'use client'

/**
 * Insights chart kit. One look across every dashboard:
 *  - colours by job: series in a fixed order (validated for colour-blind readers), one blue ramp for
 *    "how much", and the status colours only where something is good or bad;
 *  - thin marks, 2px lines, hairline solid grid, values in text colours, never in the series colour;
 *  - every chart has a legend when it has two or more series, a hover read-out, and a table view.
 */

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { cn } from '@/lib/utils'
import { signedPct } from '@/lib/insights/format'
import { cellValue, displayCell, isNumericKind, sortRows, type Column, type TableSpec } from '@/lib/insights/table'

// ── Colours ───────────────────────────────────────────────────────────────────────────────
/** Categorical slots, always used in this order (blue, orange, aqua, yellow, magenta, green). */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'] as const
/** One-hue ramp for amounts (light → dark). */
export const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#2a78d6', '#1c5cab', '#104281'] as const
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' } as const
export const MUTED_FILL = '#CBD5E1'
const GRID = '#EEF0F3'
const AXIS = '#6B7280'
const UP_TEXT = '#15803d'
const DOWN_TEXT = '#b91c1c'

// ── Cards ─────────────────────────────────────────────────────────────────────────────────

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('bg-surface border border-divider rounded-2xl', className)}>{children}</div>
}

/** A chart with its title, an optional legend, and a switch to see the same numbers as a table. */
export function ChartCard({
  title, subtitle, table, legend, children, className, action,
}: {
  title: string
  subtitle?: string
  table?: TableSpec<any> // eslint-disable-line @typescript-eslint/no-explicit-any
  legend?: { label: string; color: string; shape?: 'box' | 'line' }[]
  children: ReactNode
  className?: string
  action?: ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <Card className={cn('p-4 sm:p-5 flex flex-col min-w-0', className)}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-text-primary leading-snug">{title}</h3>
          {subtitle && <p className="text-[12px] text-text-secondary mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {action}
          {table && (
            <div className="flex rounded-lg border border-divider overflow-hidden" role="group" aria-label="Show as">
              <button
                type="button"
                onClick={() => setAsTable(false)}
                className={cn('h-7 w-8 flex items-center justify-center', !asTable ? 'bg-slate-100 text-text-primary' : 'text-text-secondary hover:bg-slate-50')}
                aria-pressed={!asTable}
                title="Chart"
              >
                <span className="material-icons text-[16px]">insert_chart_outlined</span>
              </button>
              <button
                type="button"
                onClick={() => setAsTable(true)}
                className={cn('h-7 w-8 flex items-center justify-center border-l border-divider', asTable ? 'bg-slate-100 text-text-primary' : 'text-text-secondary hover:bg-slate-50')}
                aria-pressed={asTable}
                title="Table"
              >
                <span className="material-icons text-[16px]">table_rows</span>
              </button>
            </div>
          )}
        </div>
      </div>
      {legend && legend.length > 1 && !asTable && <Legend items={legend} />}
      <div className="flex-1 min-w-0">
        {asTable && table ? <DataTable table={table} compact maxHeight={320} /> : children}
      </div>
    </Card>
  )
}

export function Legend({ items }: { items: { label: string; color: string; shape?: 'box' | 'line' }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary">
          {i.shape === 'line'
            ? <span className="inline-block w-3.5 h-[2px] rounded" style={{ background: i.color }} />
            : <span className="inline-block w-2.5 h-2.5 rounded-[3px]" style={{ background: i.color }} />}
          {i.label}
        </span>
      ))}
    </div>
  )
}

export function EmptyChart({ height = 220, text = 'Nothing recorded in this period' }: { height?: number; text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 text-text-secondary" style={{ height }}>
      <span className="material-icons text-[28px] text-slate-300">query_stats</span>
      <span className="text-[12px]">{text}</span>
    </div>
  )
}

// ── Stat tiles ────────────────────────────────────────────────────────────────────────────

/**
 * label · value · change against the previous period (green when the change is good news) · optional
 * sparkline. `goodWhenUp` null means the change is neither good nor bad (shown in grey).
 */
export function StatTile({
  label, value, delta, goodWhenUp = true, compare, spark, hero, href, hint, icon, className,
}: {
  label: string
  value: string
  delta?: number | null
  goodWhenUp?: boolean | null
  compare?: string
  spark?: number[]
  hero?: boolean
  href?: string
  hint?: string
  icon?: string
  className?: string
}) {
  const body = (
    <div className={cn(
      'h-full bg-surface border border-divider rounded-2xl p-4 flex flex-col gap-1 min-w-0 transition-colors',
      href && 'hover:border-slate-300 hover:shadow-sm',
    )}>
      <div className="flex items-center gap-1.5 text-[12px] text-text-secondary">
        {icon && <span className="material-icons text-[16px] text-slate-400">{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className={cn('font-semibold text-text-primary leading-none tracking-tight whitespace-nowrap min-w-0', hero ? 'text-[36px] sm:text-[40px] 2xl:text-[48px] mt-1' : 'text-[22px] sm:text-[24px] mt-1')}>
          {value}
        </div>
        {spark && spark.length > 1 && <Sparkline values={spark} />}
      </div>
      <DeltaLine delta={delta} goodWhenUp={goodWhenUp} compare={compare} hint={hint} />
    </div>
  )
  return href
    ? <Link href={href} className={cn('block h-full no-underline', className)}>{body}</Link>
    : <div className={cn('h-full', className)}>{body}</div>
}

function DeltaLine({ delta, goodWhenUp, compare, hint }: { delta?: number | null; goodWhenUp?: boolean | null; compare?: string; hint?: string }) {
  if (delta == null || !Number.isFinite(delta)) {
    return <p className="text-[11.5px] text-text-secondary mt-1 min-h-[16px]">{hint ?? ''}</p>
  }
  const flat = Math.abs(delta) < 0.5
  const up = delta > 0
  const good = flat || goodWhenUp == null ? null : up === goodWhenUp
  const color = good == null ? AXIS : good ? UP_TEXT : DOWN_TEXT
  const icon = flat ? 'trending_flat' : up ? 'trending_up' : 'trending_down'
  return (
    <p className="text-[11.5px] mt-1 flex items-center gap-1 min-h-[16px]">
      <span className="material-icons text-[15px]" style={{ color }} aria-hidden>{icon}</span>
      <span className="font-semibold" style={{ color }}>{signedPct(delta)}</span>
      {compare && <span className="text-text-secondary truncate">vs {compare}</span>}
    </p>
  )
}

/** 12-ish point trend line in a quiet grey, last point in the accent. */
export function Sparkline({ values, width = 84, height = 30 }: { values: number[]; width?: number; height?: number }) {
  const pts = values.slice(-24)
  const max = Math.max(...pts), min = Math.min(...pts)
  const span = max - min || 1
  const step = width / Math.max(1, pts.length - 1)
  const xy = pts.map((v, i) => [i * step, height - 3 - ((v - min) / span) * (height - 6)] as const)
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lx, ly] = xy[xy.length - 1]
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0 overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke="#94A3B8" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={3} fill={SERIES[0]} stroke="#fff" strokeWidth={1.5} />
    </svg>
  )
}

// ── Hover read-out ────────────────────────────────────────────────────────────────────────

type TipRow = { name: string; value: string; color: string }

function TipBox({ title, rows, footer }: { title: string; rows: TipRow[]; footer?: string }) {
  return (
    <div className="rounded-xl border border-divider bg-white shadow-lg px-3 py-2 min-w-[150px] pointer-events-none">
      <p className="text-[11px] text-text-secondary mb-1">{title}</p>
      {rows.map(r => (
        <div key={r.name} className="flex items-center gap-2 py-0.5">
          <span className="inline-block w-3 h-[2px] rounded shrink-0" style={{ background: r.color }} />
          <span className="text-[13px] font-semibold text-text-primary tabular-nums">{r.value}</span>
          <span className="text-[11.5px] text-text-secondary">{r.name}</span>
        </div>
      ))}
      {footer && <p className="text-[11px] text-text-secondary mt-1 pt-1 border-t border-divider">{footer}</p>}
    </div>
  )
}

export type SeriesDef = {
  key: string
  name: string
  color: string
  kind?: 'line' | 'area' | 'bar'
  /** Formats this series' values in the hover read-out (defaults to the chart's yFormat). */
  format?: (n: number) => string
}

/**
 * Time trend: lines, soft areas and/or columns on ONE value axis (never two). A vertical guide follows
 * the pointer and the read-out lists every series at that point.
 */
export function TrendChart({
  data, xKey, series, yFormat, xFormat, tipTitle, height = 240, stacked = false, footer,
}: {
  data: Record<string, unknown>[]
  xKey: string
  series: SeriesDef[]
  yFormat: (n: number) => string
  xFormat: (x: string) => string
  tipTitle?: (x: string) => string
  height?: number
  stacked?: boolean
  footer?: (row: Record<string, unknown>) => string | undefined
}) {
  if (!data.length) return <EmptyChart height={height} />
  const bars = series.filter(s => s.kind === 'bar').length
  const interval = data.length > 8 ? 'preserveStartEnd' as const : 0
  return (
    <div style={{ height }} className="w-full -ml-1">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap={bars > 1 ? '22%' : '30%'}>
          <defs>
            {series.filter(s => s.kind === 'area').map(s => (
              <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.16} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey={xKey}
            tickFormatter={(v: string) => xFormat(String(v))}
            tick={{ fontSize: 11, fill: AXIS }}
            tickLine={false}
            axisLine={{ stroke: '#D1D5DB' }}
            interval={interval}
            minTickGap={22}
          />
          <YAxis
            tickFormatter={(v: number) => yFormat(v)}
            tick={{ fontSize: 11, fill: AXIS }}
            tickLine={false}
            axisLine={false}
            width={64}
            allowDecimals={false}
          />
          <Tooltip
            cursor={bars ? { fill: 'rgba(148,163,184,0.12)' } : { stroke: '#94A3B8', strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const row = (payload[0]?.payload ?? {}) as Record<string, unknown>
              return (
                <TipBox
                  title={tipTitle ? tipTitle(String(label)) : xFormat(String(label))}
                  rows={series.map(s => ({
                    name: s.name,
                    color: s.color,
                    value: (s.format ?? yFormat)(Number(row[s.key] ?? 0)),
                  }))}
                  footer={footer?.(row)}
                />
              )
            }}
          />
          {series.map(s => {
            if (s.kind === 'bar') {
              return (
                <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} maxBarSize={24}
                  radius={stacked ? 0 : [4, 4, 0, 0]} stackId={stacked ? 'a' : undefined} isAnimationActive={false} />
              )
            }
            if (s.kind === 'area') {
              return (
                <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2}
                  fill={`url(#fill-${s.key})`} dot={false}
                  activeDot={{ r: 4.5, stroke: '#fff', strokeWidth: 2, fill: s.color }} isAnimationActive={false} />
              )
            }
            return (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2}
                strokeLinecap="round" strokeLinejoin="round" dot={data.length <= 2 ? { r: 4, stroke: '#fff', strokeWidth: 2, fill: s.color } : false}
                activeDot={{ r: 4.5, stroke: '#fff', strokeWidth: 2, fill: s.color }} isAnimationActive={false} />
            )
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Columns for named groups (departments, buckets…), one value axis. */
export function ColumnChart({
  data, xKey, series, yFormat, height = 240, colors,
}: {
  data: Record<string, unknown>[]
  xKey: string
  series: SeriesDef[]
  yFormat: (n: number) => string
  height?: number
  /** Colour per column (single series only), e.g. an ordered ramp for age buckets. */
  colors?: string[]
}) {
  if (!data.length) return <EmptyChart height={height} />
  return (
    <div style={{ height }} className="w-full -ml-1">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} interval={0} />
          <YAxis tickFormatter={(v: number) => yFormat(v)} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={64} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'rgba(148,163,184,0.12)' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const row = (payload[0]?.payload ?? {}) as Record<string, unknown>
              const i = data.indexOf(row)
              return <TipBox title={String(label)} rows={series.map(s => ({
                name: s.name, value: (s.format ?? yFormat)(Number(row[s.key] ?? 0)),
                color: colors && series.length === 1 ? colors[i] ?? s.color : s.color,
              }))} />
            }}
          />
          {series.map(s => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} maxBarSize={44} radius={[4, 4, 0, 0]} isAnimationActive={false}
              label={series.length === 1 ? { position: 'top', fontSize: 11, fill: '#374151', formatter: (v: unknown) => yFormat(Number(v)) } : undefined}
              shape={colors && series.length === 1 ? ((props: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                const { x, y, width, height: h, index } = props
                const r = Math.min(4, width / 2, Math.max(0, h))
                const c = colors[index] ?? s.color
                if (!(h > 0)) return <g />
                return <path d={`M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + h} Z`} fill={c} />
              }) : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Ranked bars (HTML: long names wrap nicely, values sit at the bar tip) ─────────────────────

export type RankItem = { label: string; value: number; display: string; sub?: string; href?: string; title?: string }

export function RankedBars({ items, color = SERIES[0], limit = 8, emptyText }: {
  items: RankItem[]; color?: string; limit?: number; emptyText?: string
}) {
  const [all, setAll] = useState(false)
  if (!items.length) return <EmptyChart height={160} text={emptyText} />
  const shown = all ? items : items.slice(0, limit)
  const max = Math.max(...items.map(i => Math.abs(i.value)), 1)
  return (
    <div className="flex flex-col gap-2.5">
      {shown.map((it, idx) => {
        const label = (
          <span className="text-[12.5px] text-text-primary truncate" title={it.title ?? it.label}>{it.label}</span>
        )
        return (
          <div key={`${it.label}-${idx}`} className="group" title={`${it.label}: ${it.display}${it.sub ? ` · ${it.sub}` : ''}`}>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              {it.href ? <Link href={it.href} className="min-w-0 truncate hover:underline">{label}</Link> : <span className="min-w-0 truncate">{label}</span>}
              <span className="text-[12.5px] font-semibold text-text-primary tabular-nums shrink-0">
                {it.display}
                {it.sub && <span className="font-normal text-text-secondary ml-1.5">{it.sub}</span>}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-300 group-hover:opacity-85"
                style={{ width: `${Math.max(1.5, (Math.abs(it.value) / max) * 100)}%`, background: color }}
              />
            </div>
          </div>
        )
      })}
      {items.length > limit && (
        <button type="button" onClick={() => setAll(a => !a)} className="self-start text-[12px] font-medium text-primary hover:underline mt-1">
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  )
}

// ── One whole, split into parts ───────────────────────────────────────────────────────────

export type Part = { label: string; value: number; color: string; display: string; dark?: boolean }

export function SegmentedBar({ parts, total }: { parts: Part[]; total?: number }) {
  const sum = total ?? parts.reduce((a, p) => a + Math.max(0, p.value), 0)
  if (sum <= 0) return <EmptyChart height={90} />
  const shown = parts.filter(p => p.value > 0)
  return (
    <div>
      <div className="flex gap-[2px] h-7" role="img" aria-label={parts.map(p => `${p.label} ${p.display}`).join(', ')}>
        {shown.map(p => {
          const share = (p.value / sum) * 100
          return (
            <div
              key={p.label}
              className="h-full rounded-[4px] flex items-center px-2 min-w-[3px] hover:brightness-105"
              style={{ width: `${share}%`, background: p.color }}
              title={`${p.label}: ${p.display} (${share.toFixed(1)}%)`}
            >
              {share >= 14 && (
                <span className="text-[11px] font-semibold truncate" style={{ color: p.dark ? '#0b0b0b' : '#fff' }}>
                  {Math.round(share)}%
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3">
        {parts.map(p => (
          <div key={p.label} className="flex items-center gap-1.5 text-[12px]">
            <span className="inline-block w-2.5 h-2.5 rounded-[3px]" style={{ background: p.color }} />
            <span className="text-text-secondary">{p.label}</span>
            <span className="font-semibold text-text-primary tabular-nums">{p.display}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Calendar heat map (one cell per day) ─────────────────────────────────────────────────

export type HeatDay = { d: string; value: number | null; tip: string }

/** Weeks run left to right, Monday at the top. `value` is 0–1; null means not a work day. */
export function CalendarHeat({ days, scaleLabel }: { days: HeatDay[]; scaleLabel: [string, string] }) {
  const [hover, setHover] = useState<HeatDay | null>(null)
  const weeks = useMemo(() => {
    if (!days.length) return [] as (HeatDay | null)[][]
    const first = days[0].d
    const [y, m, d] = first.split('-').map(Number)
    const lead = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
    const cells: (HeatDay | null)[] = [...Array(lead).fill(null), ...days]
    const out: (HeatDay | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
    return out
  }, [days])
  if (!days.length) return <EmptyChart height={140} />
  const values = days.map(d => d.value).filter((v): v is number => v != null)
  const lo = Math.min(...values, 1), hi = Math.max(...values, 0)
  const bin = (v: number) => {
    if (hi - lo < 0.0001) return RAMP.length - 2
    return Math.min(RAMP.length - 1, Math.max(1, Math.round(((v - lo) / (hi - lo)) * (RAMP.length - 2)) + 1))
  }
  const cell = weeks.length > 30 ? 11 : weeks.length > 16 ? 15 : weeks.length > 8 ? 20 : 26
  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <div className="flex flex-col gap-[2px] pt-0 shrink-0" style={{ fontSize: 10 }}>
          {['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((l, i) => (
            <span key={i} className="text-text-secondary leading-none flex items-center" style={{ height: cell }}>{l}</span>
          ))}
        </div>
        <div className="flex gap-[2px]">
          {weeks.map((w, wi) => (
            <div key={wi} className="flex flex-col gap-[2px]">
              {Array.from({ length: 7 }).map((_, di) => {
                const c = w[di]
                if (!c) return <span key={di} style={{ width: cell, height: cell }} />
                const bg = c.value == null ? '#F1F5F9' : RAMP[bin(c.value)]
                return (
                  <span
                    key={di}
                    tabIndex={0}
                    onMouseEnter={() => setHover(c)}
                    onFocus={() => setHover(c)}
                    onMouseLeave={() => setHover(null)}
                    onBlur={() => setHover(null)}
                    className={cn('rounded-[3px] outline-none', hover?.d === c.d && 'ring-2 ring-slate-500 ring-offset-1')}
                    style={{ width: cell, height: cell, background: bg }}
                    aria-label={c.tip}
                    title={c.tip}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
        <p className="text-[12px] text-text-secondary min-h-[18px]">{hover ? hover.tip : 'Point at a day to see it.'}</p>
        <div className="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <span>{scaleLabel[0]}</span>
          {RAMP.slice(1).map(c => <span key={c} className="inline-block w-3 h-3 rounded-[3px]" style={{ background: c }} />)}
          <span>{scaleLabel[1]}</span>
          <span className="inline-block w-3 h-3 rounded-[3px] ml-2" style={{ background: '#F1F5F9' }} />
          <span>Not a work day</span>
        </div>
      </div>
    </div>
  )
}

// ── Table ────────────────────────────────────────────────────────────────────────────────

export function DataTable<Row>({
  table, compact, maxHeight, searchable, pageSize,
}: {
  table: TableSpec<Row>
  compact?: boolean
  maxHeight?: number
  searchable?: boolean
  pageSize?: number
}) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return table.rows
    return table.rows.filter(r => table.columns.some(c => {
      const v = cellValue(c, r)
      return v != null && String(v).toLowerCase().includes(needle)
    }))
  }, [q, table])

  const sorted = useMemo(
    () => sortRows(filtered, table.columns.find(c => c.key === sortKey) as Column<Row> | undefined, dir),
    [filtered, sortKey, dir, table.columns],
  )
  const pages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1
  const safePage = Math.min(page, pages - 1)
  const rows = pageSize ? sorted.slice(safePage * pageSize, (safePage + 1) * pageSize) : sorted

  const click = (key: string, numeric: boolean) => {
    if (sortKey === key) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setDir(numeric ? 'desc' : 'asc') }
    setPage(0)
  }

  const pad = compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
  return (
    <div>
      {searchable && (
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="relative w-full sm:w-72">
            <span className="material-icons text-[18px] text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2">search</span>
            <input
              value={q}
              onChange={e => { setQ(e.target.value); setPage(0) }}
              placeholder="Search this report"
              className="input h-9 text-[13px]"
              style={{ paddingLeft: 36 }}
            />
          </div>
          <p className="text-[12px] text-text-secondary">
            {filtered.length === table.rows.length ? `${table.rows.length} rows` : `${filtered.length} of ${table.rows.length} rows`}
          </p>
        </div>
      )}
      <div className="overflow-auto rounded-xl border border-divider" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full text-[12.5px] border-collapse">
          <thead className="sticky top-0 z-[1]">
            <tr className="bg-slate-50">
              {table.columns.map(c => {
                const numeric = isNumericKind(c.kind)
                const active = sortKey === c.key
                return (
                  <th key={c.key} className={cn(pad, 'font-medium text-text-secondary whitespace-nowrap border-b border-divider', numeric ? 'text-right' : 'text-left')}>
                    <button type="button" onClick={() => click(c.key, numeric)} className={cn('inline-flex items-center gap-0.5 hover:text-text-primary', active && 'text-text-primary')}>
                      {c.label}
                      <span className="material-icons text-[14px]" style={{ opacity: active ? 1 : 0.25 }}>
                        {active && dir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                      </span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={table.columns.length} className="px-3 py-8 text-center text-text-secondary">Nothing to show for this period.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-divider last:border-0 hover:bg-slate-50/70">
                {table.columns.map(c => {
                  const numeric = isNumericKind(c.kind)
                  return (
                    <td key={c.key} className={cn(pad, numeric ? 'text-right tabular-nums whitespace-nowrap' : 'text-left', 'text-text-primary')}>
                      <span className={displayCell(c.kind, cellValue(c, r)).length <= 14 ? 'whitespace-nowrap' : undefined}>{displayCell(c.kind, cellValue(c, r))}</span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          {table.totals && rows.length > 0 && (
            <tfoot className="sticky bottom-0">
              <tr className="bg-slate-50 font-semibold">
                {table.columns.map((c, i) => {
                  const v = table.totals![c.key]
                  const numeric = isNumericKind(c.kind)
                  return (
                    <td key={c.key} className={cn(pad, 'border-t border-divider', numeric ? 'text-right tabular-nums whitespace-nowrap' : 'text-left')}>
                      {i === 0 && v == null ? 'Total' : v == null ? '' : displayCell(c.kind, v)}
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {pageSize && pages > 1 && (
        <div className="flex items-center justify-end gap-2 mt-3 text-[12px] text-text-secondary">
          <button type="button" disabled={safePage === 0} onClick={() => setPage(p => p - 1)} className="h-8 px-3 rounded-lg border border-divider disabled:opacity-40 hover:bg-slate-50">Previous</button>
          <span>Page {safePage + 1} of {pages}</span>
          <button type="button" disabled={safePage >= pages - 1} onClick={() => setPage(p => p + 1)} className="h-8 px-3 rounded-lg border border-divider disabled:opacity-40 hover:bg-slate-50">Next</button>
        </div>
      )}
      {table.note && <p className="text-[11.5px] text-text-secondary mt-2">{table.note}</p>}
    </div>
  )
}

/** Small "needs attention" row used on the overview. */
export function AttentionRow({ icon, tone, label, value, href }: {
  icon: string; tone: keyof typeof STATUS | 'neutral'; label: string; value: string; href?: string
}) {
  const color = tone === 'neutral' ? '#64748B' : STATUS[tone]
  const inner = (
    <div className="flex items-center gap-3 py-2.5 px-1 border-b border-divider last:border-0 group">
      <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}1a` }}>
        <span className="material-icons text-[18px]" style={{ color }}>{icon}</span>
      </span>
      <span className="flex-1 text-[13px] text-text-primary group-hover:underline">{label}</span>
      <span className="text-[14px] font-semibold text-text-primary tabular-nums">{value}</span>
      {href && <span className="material-icons text-[18px] text-slate-300">chevron_right</span>}
    </div>
  )
  return href ? <Link href={href} className="block no-underline">{inner}</Link> : inner
}
