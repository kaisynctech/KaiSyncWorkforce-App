'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { loadPermissions } from '@/lib/permissions'
import { resolveHrNavFlags } from '@/lib/company-modules'
import { loadCompanyWorkspace } from '@/lib/employee-workspace'
import { useDashboardCompany } from '@/components/DashboardCompanyContext'
import { cn } from '@/lib/utils'
import {
  MONEY_ACTION_TABS,
  loadMoneyActionItems,
  openMoneyActionItem,
  moneyActionColor,
  visibleMoneyActionDomains,
  type MoneyActionDomain,
  type MoneyActionItem,
} from '@/lib/money-action-centre'

/**
 * Money Home → "Needs you today": the real to-dos (what the Action Centre listed), one tap each.
 * Each person only sees the groups their modules and permissions allow.
 */

export type MoneyTodoExtra = { tone: string; text: string; href: string; action: string }

const TYPE_LABEL: Record<string, string> = {
  invoice_overdue: 'Overdue',
  invoice_outstanding: 'Unpaid',
  quotation_pending: 'Quotation',
  quote_pending: 'Contractor quote',
  supplier_approval: 'Approve bill',
  payout_pending: 'Approve payout',
  payout_approved: 'Ready to pay',
  payment_hold: 'Payment hold',
  compliance_hold: 'Compliance hold',
  banking_pending: 'Check banking',
}

const SHOW_FIRST = 6

const PRIORITY: Record<string, number> = {
  invoice_overdue: 0, supplier_approval: 1, payout_pending: 1, payout_approved: 2,
  quotation_pending: 3, quote_pending: 3, compliance_hold: 4, payment_hold: 4, banking_pending: 5, invoice_outstanding: 6,
}

function fmtDate(d: string | null) {
  if (!d) return ''
  return new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short' }).format(new Date(d))
}

export function MoneyTodoList({ extra = [] }: { extra?: MoneyTodoExtra[] }) {
  const router = useRouter()
  const { company, employee } = useDashboardCompany()
  const [domains, setDomains] = useState<MoneyActionDomain[]>([])
  const [byDomain, setByDomain] = useState<Record<MoneyActionDomain, MoneyActionItem[]> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<MoneyActionDomain | 'all'>('all')
  const [showAll, setShowAll] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)

  const companyKey = company?.id ?? null
  const companyModules = company?.enabled_modules ?? null
  const contextAccess = employee?.access_level ?? null

  useEffect(() => {
    let live = true
    void (async () => {
      const empty = { invoices: [], quotes: [], approvals: [], suppliers: [] }
      try {
        const supabase = createClient()
        const member = await resolveCurrentMember(supabase)
        const companyId = companyKey ?? member?.companyId
        if (!companyId || !member) { if (live) setByDomain(empty); return }
        let workspaceModules: Record<string, boolean> = {}
        try {
          const workspace = await loadCompanyWorkspace(supabase, companyId)
          workspaceModules = (workspace?.enabled_modules ?? {}) as Record<string, boolean>
        } catch (wsErr) {
          console.error('money to-dos: workspace load failed', wsErr)
        }
        const flags = resolveHrNavFlags({ ...(companyModules ?? {}), ...workspaceModules })
        let accessLevel = contextAccess
        if (!accessLevel) {
          const { data: me } = await supabase.from('employees').select('access_level').eq('id', member.employeeId).maybeSingle()
          accessLevel = me?.access_level ?? null
        }
        const perms = await loadPermissions(supabase, companyId, accessLevel)
        const visible = visibleMoneyActionDomains(flags, perms)
        const items = await loadMoneyActionItems(supabase, companyId, visible)
        if (!live) return
        setDomains(visible)
        setByDomain(items)
      } catch (err) {
        console.error('money to-dos load failed', err)
        if (!live) return
        setError('Could not load your to-dos. Refresh the page to try again.')
        setByDomain(empty)
      }
    })()
    return () => { live = false }
  }, [companyKey, companyModules, contextAccess])

  const all = useMemo(() => {
    if (!byDomain) return []
    return domains.flatMap(d => byDomain[d] ?? [])
      // Most urgent first (overdue, then approvals, then waiting quotes, then unpaid), newest first within each.
      .sort((a, b) => (PRIORITY[a.action_type] ?? 9) - (PRIORITY[b.action_type] ?? 9) || (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  }, [byDomain, domains])

  const shown = filter === 'all' ? all : all.filter(i => i.domain === filter)
  const visibleRows = showAll ? shown : shown.slice(0, SHOW_FIRST)
  const total = all.length + extra.length

  async function open(item: MoneyActionItem) {
    setOpening(item.key)
    try { await openMoneyActionItem(item, router) } finally { setOpening(null) }
  }

  return (
    <section id="needs-you" className="bg-surface-card border border-divider rounded-2xl p-4 sm:p-5 flex flex-col gap-3 scroll-mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-text-primary">
          Needs you today{byDomain && <span className="text-text-secondary font-medium"> · {total}</span>}
        </h2>
      </div>

      {domains.length > 1 && all.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[{ id: 'all' as const, label: 'All', n: all.length },
            ...MONEY_ACTION_TABS.filter(t => domains.includes(t.id)).map(t => ({ id: t.id, label: t.label, n: byDomain?.[t.id]?.length ?? 0 }))]
            .map(t => (
              <button key={t.id} type="button" onClick={() => { setFilter(t.id); setShowAll(false) }}
                aria-pressed={filter === t.id}
                className={cn('inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[12.5px] font-semibold whitespace-nowrap border transition-colors',
                  filter === t.id ? 'bg-primary border-primary text-white' : 'bg-surface border-divider text-text-secondary hover:text-text-primary')}>
                {t.label}<span className={filter === t.id ? 'text-white/80' : 'text-text-secondary/80'}>{t.n}</span>
              </button>
            ))}
        </div>
      )}

      {!byDomain && <p className="text-[13px] text-text-secondary">Loading your to-dos…</p>}
      {error && <p className="text-[13px] text-error">{error}</p>}
      {byDomain && total === 0 && !error && <p className="text-[13px] text-text-secondary">Nothing waiting on you.</p>}

      {byDomain && visibleRows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {visibleRows.map(item => {
            const c = moneyActionColor(item.action_type)
            return (
              <li key={item.key}>
                <button type="button" onClick={() => void open(item)} disabled={opening === item.key}
                  className="w-full text-left flex items-start gap-3 border border-divider/70 rounded-xl px-3 py-2.5 min-h-[52px] hover:bg-surface-elevated/60 disabled:opacity-60">
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5" style={{ background: c.bg, color: c.fg }}>
                    {TYPE_LABEL[item.action_type] ?? item.action_type.replace(/_/g, ' ')}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13.5px] font-medium text-text-primary truncate">{item.title}</span>
                    <span className="block text-[12px] text-text-secondary line-clamp-2">{item.summary}</span>
                  </span>
                  <span className="shrink-0 flex flex-col items-end gap-1">
                    {item.created_at && <span className="text-[11.5px] text-text-secondary">{fmtDate(item.created_at)}</span>}
                    <span className="material-icons text-[18px] text-text-secondary">chevron_right</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {byDomain && shown.length > SHOW_FIRST && (
        <button type="button" onClick={() => setShowAll(v => !v)} className="self-start h-10 px-1 text-[13px] font-semibold text-primary">
          {showAll ? 'Show fewer' : `Show all ${shown.length}`}
        </button>
      )}

      {extra.length > 0 && filter === 'all' && (
        <ul className="flex flex-col gap-2">
          {extra.map(a => (
            <li key={a.text}>
              <Link href={a.href} prefetch={false} className="flex items-center gap-2.5 border border-divider/70 rounded-xl px-3 py-2.5 min-h-[48px] hover:bg-surface-elevated/60">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: a.tone }} />
                <span className="flex-1 text-[13px] text-text-primary">{a.text}</span>
                <span className="text-[12.5px] font-semibold text-primary">{a.action}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
