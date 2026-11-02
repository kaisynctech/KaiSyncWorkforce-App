'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { describeRange, previousRange } from '@/lib/insights/period'
import { DateRangePicker } from './DateRangePicker'
import { InsightsProvider, useInsights } from './InsightsContext'

const TABS = [
  { href: '/dashboard/reports',         label: 'Overview',            icon: 'space_dashboard' },
  { href: '/dashboard/reports/people',  label: 'People & attendance', icon: 'groups' },
  { href: '/dashboard/reports/jobs',    label: 'Jobs & operations',   icon: 'construction' },
  { href: '/dashboard/reports/money',   label: 'Sales & money',       icon: 'payments' },
  { href: '/dashboard/reports/payroll', label: 'Payroll',             icon: 'account_balance_wallet' },
  { href: '/dashboard/reports/library', label: 'Report library',      icon: 'library_books' },
]

/** Older screens under /reports keep their own headers. */
const OWN_LAYOUT = ['/dashboard/reports/commercial', '/dashboard/reports/project-profitability', '/dashboard/reports/sections']

export function InsightsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? ''
  if (OWN_LAYOUT.some(p => pathname.startsWith(p))) return <>{children}</>
  return (
    <InsightsProvider>
      <Frame pathname={pathname}>{children}</Frame>
    </InsightsProvider>
  )
}

function Frame({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { filters, setPreset, setCustom, setBranch, setDepartment, orgFilters, options, exporter, refresh } = useInsights()
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null)
  const [failed, setFailed] = useState(false)
  const prev = previousRange(filters.range)
  const active = (href: string) => (href === '/dashboard/reports' ? pathname === href : pathname.startsWith(href))

  const run = async (kind: 'csv' | 'pdf') => {
    const fn = kind === 'csv' ? exporter?.csv : exporter?.pdf
    if (!fn) return
    setBusy(kind)
    setFailed(false)
    try { await fn() } catch { setFailed(true) }
    setBusy(null)
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="bg-surface border-b border-divider shrink-0">
        <div className="px-4 sm:px-6 pt-4 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold text-text-primary leading-tight">Insights</h1>
            <p className="text-[12.5px] text-text-secondary mt-0.5">
              {describeRange(filters.range)} <span className="text-slate-300 mx-1">·</span> compared with {describeRange(prev)}
            </p>
          </div>
        </div>
        <nav className="px-2 sm:px-4 mt-2 flex gap-1 overflow-x-auto" aria-label="Insights sections">
          {TABS.map(t => (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                'flex items-center gap-1.5 px-3 h-10 text-[13px] whitespace-nowrap border-b-2 -mb-px no-underline transition-colors',
                active(t.href) ? 'border-[#1E3A5F] text-text-primary font-semibold' : 'border-transparent text-text-secondary hover:text-text-primary',
              )}
              aria-current={active(t.href) ? 'page' : undefined}
            >
              <span className="material-icons text-[17px]">{t.icon}</span>
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* One filter row scopes everything below it. */}
        <div className="px-4 sm:px-6 pt-4 pb-1 flex items-center gap-2 flex-wrap">
          <DateRangePicker preset={filters.preset} range={filters.range} onPreset={setPreset} onCustom={setCustom} />
          {orgFilters && (
            <>
              <select
                value={filters.branch}
                onChange={e => setBranch(e.target.value)}
                className="h-9 rounded-xl border border-divider bg-surface px-3 text-[13px] text-text-primary max-w-[220px]"
                aria-label="Site"
              >
                <option value="">All sites</option>
                {options.branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <select
                value={filters.department}
                onChange={e => setDepartment(e.target.value)}
                className="h-9 rounded-xl border border-divider bg-surface px-3 text-[13px] text-text-primary max-w-[220px]"
                aria-label="Department"
              >
                <option value="">All departments</option>
                {options.departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </>
          )}
          <button
            type="button"
            onClick={refresh}
            className="h-9 w-9 rounded-xl border border-divider bg-surface flex items-center justify-center text-slate-500 hover:text-text-primary"
            title="Refresh"
            aria-label="Refresh"
          >
            <span className="material-icons text-[18px]">refresh</span>
          </button>
          <div className="flex-1" />
          {failed && <span className="text-[12px] text-error">The download did not work. Try again.</span>}
          {exporter?.csv && (
            <button
              type="button"
              onClick={() => run('csv')}
              disabled={busy !== null}
              className="h-9 px-3 rounded-xl border border-divider bg-surface flex items-center gap-1.5 text-[13px] text-text-primary hover:border-slate-300 disabled:opacity-50"
            >
              <span className="material-icons text-[17px] text-slate-500">{busy === 'csv' ? 'hourglass_empty' : 'table_view'}</span>
              CSV
            </button>
          )}
          {exporter?.pdf && (
            <button
              type="button"
              onClick={() => run('pdf')}
              disabled={busy !== null}
              className="h-9 px-3 rounded-xl bg-[#1E3A5F] text-white flex items-center gap-1.5 text-[13px] font-medium hover:opacity-95 disabled:opacity-50"
            >
              <span className="material-icons text-[17px]">{busy === 'pdf' ? 'hourglass_empty' : 'picture_as_pdf'}</span>
              {busy === 'pdf' ? 'Preparing…' : 'PDF'}
            </button>
          )}
        </div>
        <div className="px-4 sm:px-6 pb-10 pt-3">{children}</div>
      </div>
    </div>
  )
}
