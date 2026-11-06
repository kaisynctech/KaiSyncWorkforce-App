'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import { MoneyNotices, type MoneyNotice } from '@/components/money/MoneyNotices'
import { XeroMark, useXeroStatuses } from '@/components/xero/XeroMark'
import type { FinanceInvoice } from '@/lib/finance-types'
import {
  ResponsiveDataView,
  DataCard,
  DataCardTitle,
  DataCardMeta,
  DataCardRow,
} from '@/components/ui/ResponsiveDataView'

type InvoiceRow = FinanceInvoice & {
  invoice_type?: string | null
  client_deals?: { title: string } | null
}

const STATUS_BADGE: Record<string, string> = {
  draft:            'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  sent:             'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  viewed:           'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  partially_paid:   'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  paid:             'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  overdue:          'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  voided:           'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  cancelled:        'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

const ALL_STATUSES = ['draft', 'sent', 'viewed', 'partially_paid', 'paid', 'overdue', 'voided', 'cancelled']

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-500'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

export default function MoneyInvoicesPage() {
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <MoneyInvoicesInner />
    </Suspense>
  )
}

function MoneyInvoicesInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const clientFilter = searchParams.get('client') ?? searchParams.get('client_id')
  const jobFilter = searchParams.get('job_id')
  const dealFilter = searchParams.get('deal_id') ?? searchParams.get('project_id')

  const [rows, setRows]       = useState<InvoiceRow[]>([])
  const [notices, setNotices] = useState<MoneyNotice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [status, setStatus]   = useState('all')
  const [filterLabels, setFilterLabels] = useState<{ client?: string; job?: string; deal?: string }>({})
  const [companyId, setCompanyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)

    let q = supabase
      .from('finance_invoices')
      .select(`
        id, invoice_number, status, currency,
        total_amount, amount_paid, balance_due,
        issue_date, due_date, paid_date,
        client_id, job_id, deal_id, project_id,
        clients(name),
        client_deals!finance_invoices_deal_id_fkey(title)
      `)
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })

    if (clientFilter) q = q.eq('client_id', clientFilter)
    if (jobFilter) q = q.eq('job_id', jobFilter)
    if (dealFilter) q = q.or(`deal_id.eq.${dealFilter},project_id.eq.${dealFilter}`)

    const [listRes, actionRes] = await Promise.all([
      q,
      (supabase.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: Array<{
        ref_id: string
        client_name: string
        action_type: string
        summary: string
        created_at: string
      }> | null }>)('hr_get_client_action_items', { p_company_id: member.companyId }),
    ])
    const data = listRes.data
    setRows((data ?? []) as unknown as InvoiceRow[])
    setNotices((actionRes.data ?? [])
      .filter(item => item.action_type.startsWith('invoice_'))
      .map(item => ({
        id: `${item.action_type}-${item.ref_id}`,
        label: item.action_type === 'invoice_overdue' ? 'Invoice overdue' : 'Invoice outstanding',
        title: item.client_name || 'Client',
        detail: item.summary,
        when: item.created_at,
        tone: item.action_type === 'invoice_overdue' ? 'red' as const : 'amber' as const,
        onOpen: () => router.push(`/dashboard/money/invoices/${item.ref_id}`),
      })))

    const labels: { client?: string; job?: string; deal?: string } = {}
    if (clientFilter) {
      const { data: c } = await supabase.from('clients').select('name').eq('id', clientFilter).maybeSingle()
      if (c?.name) labels.client = c.name
    }
    if (jobFilter) {
      const { data: j } = await supabase.from('jobs').select('title, job_code').eq('id', jobFilter).maybeSingle()
      if (j) labels.job = j.job_code ? `${j.job_code} · ${j.title}` : j.title
    }
    if (dealFilter) {
      const { data: d } = await supabase.from('client_deals').select('title, project_code').eq('id', dealFilter).maybeSingle()
      if (d) labels.deal = d.project_code ? `${d.project_code} · ${d.title}` : d.title
    }
    setFilterLabels(labels)
    setLoading(false)
  }, [clientFilter, jobFilter, dealFilter])

  useEffect(() => { void load() }, [load])

  const filtered = rows.filter(r => {
    if (status !== 'all' && r.status !== status) return false
    if (search) {
      const q = search.toLowerCase()
      const client = (r.clients as { name: string } | null)?.name ?? ''
      return (
        (r.invoice_number ?? '').toLowerCase().includes(q) ||
        client.toLowerCase().includes(q)
      )
    }
    return true
  })

  const xero = useXeroStatuses(companyId, 'invoice', filtered.slice(0, 300).map(r => r.id))
  const xeroMark = (r: InvoiceRow) => (
    <XeroMark companyId={companyId} kind="invoice" id={r.id} state={xero.statuses?.[r.id]} connected={xero.connected}
      canSend={!['draft', 'cancelled', 'voided'].includes(r.status)} onChanged={() => void xero.reload()} />
  )

  const hasScopeFilter = !!(clientFilter || jobFilter || dealFilter)

  function clearScopeFilters() {
    router.replace('/dashboard/money/invoices')
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">Invoices</h1>
        <Link href="/dashboard/money/invoices/new" className="btn-primary h-9 px-3 text-[13px] flex items-center gap-1">
          <span className="material-icons text-[16px]">add</span>Invoice
        </Link>
      </div>

      <div className="flex gap-2 px-4 py-2 border-b border-divider shrink-0 flex-wrap bg-surface items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search number or client…"
          className="h-9 px-3 border border-border rounded-md text-[13px] bg-background flex-1 min-w-[180px]"
        />
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="h-9 px-3 border border-border rounded-md text-[13px] bg-background"
        >
          <option value="all">All statuses</option>
          {ALL_STATUSES.map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        {hasScopeFilter && (
          <div className="flex flex-wrap gap-1.5 items-center">
            {filterLabels.client && (
              <span className="h-8 px-2.5 rounded-md bg-surface-elevated border border-divider text-[12px] text-text-primary flex items-center">
                Client: {filterLabels.client}
              </span>
            )}
            {filterLabels.job && (
              <span className="h-8 px-2.5 rounded-md bg-surface-elevated border border-divider text-[12px] text-text-primary flex items-center">
                Job: {filterLabels.job}
              </span>
            )}
            {filterLabels.deal && (
              <span className="h-8 px-2.5 rounded-md bg-surface-elevated border border-divider text-[12px] text-text-primary flex items-center">
                Project: {filterLabels.deal}
              </span>
            )}
            <button
              type="button"
              onClick={clearScopeFilters}
              className="h-8 px-2.5 text-[12px] text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      <MoneyNotices items={notices} />

      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
        ) : (
          <ResponsiveDataView
            table={
              <table className="w-full" style={{ minWidth: 860 }}>
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider sticky top-0">
                    <th className="data-th text-left">Number</th>
                    <th className="data-th text-left">Client</th>
                    <th className="data-th text-left">Project</th>
                    <th className="data-th text-left">Issue Date</th>
                    <th className="data-th text-left">Due</th>
                    <th className="data-th text-left">Status</th>
                    <th className="data-th text-right">Total</th>
                    <th className="data-th text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr
                      key={r.id}
                      className="border-b border-divider hover:bg-surface-elevated cursor-pointer transition-colors"
                      onClick={() => router.push(`/dashboard/money/invoices/${r.id}`)}
                    >
                      <td className="data-td text-[13px] font-medium text-text-primary">
                        <span className="inline-flex items-center gap-1.5">
                          {r.invoice_number || <span className="text-text-disabled italic">draft</span>}
                          {(xero.statuses?.[r.id] || !['draft', 'cancelled', 'voided'].includes(r.status)) && xeroMark(r)}
                        </span>
                      </td>
                      <td className="data-td text-[13px] text-text-secondary">
                        {(r.clients as { name: string } | null)?.name ?? '—'}
                      </td>
                      <td className="data-td text-[13px] text-text-secondary">
                        {(r.client_deals as { title: string } | null)?.title ?? '—'}
                      </td>
                      <td className="data-td text-[13px] text-text-secondary">{r.issue_date ?? '—'}</td>
                      <td className="data-td text-[13px] text-text-secondary">{r.due_date ?? '—'}</td>
                      <td className="data-td"><StatusBadge status={r.status} /></td>
                      <td className="data-td text-[13px] text-right text-text-primary">{fmtMoney(r.total_amount, r.currency)}</td>
                      <td className="data-td text-[13px] text-right font-medium text-text-primary">{fmtMoney(r.balance_due, r.currency)}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center text-[13px] text-text-secondary py-14">
                        <span className="material-icons text-[32px] text-text-disabled block mb-1">receipt_long</span>
                        No invoices found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            }
            mobile={
              filtered.length === 0 ? (
                <div className="text-center text-[13px] text-text-secondary py-14">
                  <span className="material-icons text-[32px] text-text-disabled block mb-1">receipt_long</span>
                  No invoices found
                </div>
              ) : (
                <>
                  {filtered.map(r => (
                    <DataCard
                      key={r.id}
                      onClick={() => router.push(`/dashboard/money/invoices/${r.id}`)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <DataCardTitle>
                            <span className="inline-flex items-center gap-1.5">{r.invoice_number || 'Draft'}{(xero.statuses?.[r.id] || !['draft', 'cancelled', 'voided'].includes(r.status)) && xeroMark(r)}</span>
                          </DataCardTitle>
                          <DataCardMeta>
                            {(r.clients as { name: string } | null)?.name ?? '—'}
                          </DataCardMeta>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>
                      <DataCardRow label="Total" value={fmtMoney(r.total_amount, r.currency)} />
                      <DataCardRow label="Balance" value={fmtMoney(r.balance_due, r.currency)} />
                      <DataCardRow label="Due" value={r.due_date ?? '—'} />
                    </DataCard>
                  ))}
                </>
              )
            }
          />
        )}
      </div>
    </div>
  )
}
