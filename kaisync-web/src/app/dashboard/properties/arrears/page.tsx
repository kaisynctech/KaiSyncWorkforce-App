'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { KpiTile } from '@/components/ui/KpiTile'
import { ListPagination } from '@/components/properties/ListPagination'
import {
  arrearsBucket,
  arrearsBucketLabel,
  daysPastDue,
  paginateSlice,
  PROPERTY_LIST_PAGE_SIZE,
  totalPages,
  type ArrearsBucket,
} from '@/lib/property-list'

type ArrearsRow = {
  id: string
  invoice_number: string | null
  status: string
  balance_due: number
  total_amount: number
  due_date: string | null
  site_id: string | null
  lease_id: string | null
  sites?: { id: string; name: string } | null
  property_leases?: {
    id: string
    tenant_name: string | null
    unit_id: string | null
    units?: { unit_number: string } | null
  } | null
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 2 }).format(n)

const BUCKETS: ArrearsBucket[] = ['current', '1_30', '31_60', '61_plus']

export default function PropertyArrearsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<ArrearsRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bucketFilter, setBucketFilter] = useState<ArrearsBucket | 'all'>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) {
      setError('not_linked')
      setLoading(false)
      return
    }

    const { data, error: e } = await supabase
      .from('finance_invoices')
      .select(`
        id, invoice_number, status, balance_due, total_amount, due_date, site_id, lease_id,
        sites(id, name),
        property_leases(id, tenant_name, unit_id, units(unit_number))
      `)
      .eq('company_id', member.companyId)
      .eq('invoice_type', 'rent')
      .gt('balance_due', 0)
      .not('status', 'in', '("draft","cancelled","voided","paid")')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(5000)

    if (e) setError(e.message)
    setRows((data ?? []) as unknown as ArrearsRow[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const enriched = useMemo(() => {
    return rows.map(r => {
      const bucket = arrearsBucket(r.due_date)
      const days = daysPastDue(r.due_date)
      return { ...r, bucket, days }
    })
  }, [rows])

  const bucketTotals = useMemo(() => {
    const t: Record<ArrearsBucket, { count: number; amount: number }> = {
      current: { count: 0, amount: 0 },
      '1_30': { count: 0, amount: 0 },
      '31_60': { count: 0, amount: 0 },
      '61_plus': { count: 0, amount: 0 },
    }
    for (const r of enriched) {
      t[r.bucket].count += 1
      t[r.bucket].amount += Number(r.balance_due) || 0
    }
    return t
  }, [enriched])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter(r => {
      if (bucketFilter !== 'all' && r.bucket !== bucketFilter) return false
      if (!q) return true
      const site = r.sites?.name ?? ''
      const tenant = r.property_leases?.tenant_name ?? ''
      const unit = r.property_leases?.units?.unit_number ?? ''
      const inv = r.invoice_number ?? ''
      return site.toLowerCase().includes(q)
        || tenant.toLowerCase().includes(q)
        || unit.toLowerCase().includes(q)
        || inv.toLowerCase().includes(q)
    })
  }, [enriched, bucketFilter, search])

  useEffect(() => { setPage(1) }, [bucketFilter, search])

  const pageCount = totalPages(filtered.length, PROPERTY_LIST_PAGE_SIZE)
  const paged = useMemo(
    () => paginateSlice(filtered, Math.min(page, pageCount), PROPERTY_LIST_PAGE_SIZE),
    [filtered, page, pageCount],
  )

  const grandTotal = enriched.reduce((s, r) => s + (Number(r.balance_due) || 0), 0)

  if (error === 'not_linked') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[13px] text-text-secondary">Account not linked to an employee.</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-4 space-y-4 pb-12">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <button type="button" onClick={() => router.push('/dashboard/properties')} className="flex items-center gap-1 text-[13px] text-primary hover:underline mb-1">
              <span className="material-icons text-[16px]">arrow_back</span>
              Properties
            </button>
            <h1 className="text-[20px] font-semibold text-text-primary">Rent arrears aging</h1>
            <p className="text-[12px] text-text-secondary mt-0.5">
              Open rent invoices by days past due · total {fmtMoney(grandTotal)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {BUCKETS.map(b => (
            <button
              key={b}
              type="button"
              onClick={() => setBucketFilter(prev => prev === b ? 'all' : b)}
              className={`text-left rounded-xl ${bucketFilter === b ? 'ring-2 ring-primary' : ''}`}
            >
              <KpiTile
                value={bucketTotals[b].count}
                label={`${arrearsBucketLabel(b)} · ${fmtMoney(bucketTotals[b].amount)}`}
                bg={b === '61_plus' || b === '31_60' ? '#3F1D1D' : '#1E293B'}
                valueFg={b === '61_plus' || b === '31_60' ? '#F87171' : '#FCD34D'}
                labelFg={b === '61_plus' || b === '31_60' ? '#FCA5A5' : '#64748B'}
              />
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search property, tenant, unit, invoice…"
            className="flex-1 min-w-[200px] h-10 px-3 border border-border rounded-md text-[13px] bg-background"
          />
          <select
            value={bucketFilter}
            onChange={e => setBucketFilter(e.target.value as ArrearsBucket | 'all')}
            className="h-10 px-3 border border-border rounded-md text-[13px] bg-background"
          >
            <option value="all">All buckets</option>
            {BUCKETS.map(b => <option key={b} value={b}>{arrearsBucketLabel(b)}</option>)}
          </select>
        </div>

        {error && <p className="text-[13px] text-error">{error}</p>}

        {loading ? (
          <p className="text-center text-[13px] text-text-secondary py-8">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-[13px] text-text-secondary py-8">No arrears in this view.</p>
        ) : (
          <div className="overflow-x-auto border border-divider rounded-xl">
            <table className="w-full" style={{ minWidth: 720 }}>
              <thead>
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className="data-th text-left">Property</th>
                  <th className="data-th text-left">Tenant / unit</th>
                  <th className="data-th text-left">Invoice</th>
                  <th className="data-th text-left">Due</th>
                  <th className="data-th text-left">Aging</th>
                  <th className="data-th text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(r => (
                  <tr
                    key={r.id}
                    className="border-b border-divider hover:bg-surface-elevated cursor-pointer"
                    onClick={() => router.push(`/dashboard/money/invoices/${r.id}`)}
                  >
                    <td className="data-td text-[13px]">
                      {r.site_id ? (
                        <Link
                          href={`/dashboard/properties/${r.site_id}`}
                          className="text-primary hover:underline"
                          onClick={e => e.stopPropagation()}
                        >
                          {r.sites?.name ?? 'Property'}
                        </Link>
                      ) : (r.sites?.name ?? '—')}
                    </td>
                    <td className="data-td text-[12px] text-text-secondary">
                      {r.property_leases?.tenant_name ?? '—'}
                      {r.property_leases?.units?.unit_number
                        ? ` · ${r.property_leases.units.unit_number}`
                        : ''}
                    </td>
                    <td className="data-td text-[12px] text-primary">{r.invoice_number ?? r.id.slice(0, 8)}</td>
                    <td className="data-td text-[12px]">{r.due_date ?? '—'}</td>
                    <td className="data-td text-[12px]">
                      <span className={r.bucket === '61_plus' || r.bucket === '31_60' ? 'text-error' : ''}>
                        {arrearsBucketLabel(r.bucket)}
                        {r.days > 0 ? ` (${r.days}d)` : ''}
                      </span>
                    </td>
                    <td className="data-td text-[13px] text-right font-medium text-error">
                      {fmtMoney(Number(r.balance_due) || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 pb-3">
              <ListPagination
                page={Math.min(page, pageCount)}
                pageCount={pageCount}
                total={filtered.length}
                pageSize={PROPERTY_LIST_PAGE_SIZE}
                onPageChange={setPage}
                label="invoices"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
