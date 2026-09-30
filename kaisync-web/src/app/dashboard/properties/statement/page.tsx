'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { propertyKindLabel } from '@/lib/properties'
import {
  buildOwnerStatements,
  statementTotals,
  type StatementInvoice,
  type StatementLease,
  type StatementSite,
  type StatementStay,
  type StatementUnit,
} from '@/lib/owner-statement'
import { localIsoDate, monthNightDates } from '@/lib/stay-calendar'

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 2 }).format(n)

function fmtPct(ratio: number | null): string {
  if (ratio == null) return '—'
  return `${Math.round(ratio * 100)}%`
}

export default function OwnerStatementPage() {
  const router = useRouter()
  const [month, setMonth] = useState(() => localIsoDate().slice(0, 7))
  const [rows, setRows] = useState<ReturnType<typeof buildOwnerStatements>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) {
      setError('not_linked')
      setRows([])
      setLoading(false)
      return
    }

    const [yearText, monthText] = month.split('-')
    const year = Number(yearText)
    const monthIndex = Number(monthText) - 1
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
      setError('Choose a valid month.')
      setLoading(false)
      return
    }
    const nights = monthNightDates(year, monthIndex)
    const start = nights[0]
    const end = nights[nights.length - 1]
    if (!start || !end) {
      setError('Choose a valid month.')
      setLoading(false)
      return
    }

    const [sitesRes, unitsRes, staysRes, leasesRes, invoicesRes] = await Promise.all([
      supabase
        .from('sites')
        .select('id, name, property_kind, is_active')
        .eq('company_id', member.companyId)
        .order('name')
        .limit(2000),
      supabase
        .from('units')
        .select('id, site_id')
        .eq('company_id', member.companyId)
        .limit(5000),
      supabase
        .from('property_stays')
        .select('site_id, unit_id, status, check_in_date, check_out_date')
        .eq('company_id', member.companyId)
        .lte('check_in_date', end)
        .gte('check_out_date', start)
        .limit(5000),
      supabase
        .from('property_leases')
        .select('site_id, unit_id, status, start_date, end_date')
        .eq('company_id', member.companyId)
        .in('status', ['active', 'ended'])
        .lte('start_date', end)
        .or(`end_date.is.null,end_date.gte.${start}`)
        .limit(5000),
      supabase
        .from('finance_invoices')
        .select('site_id, invoice_type, status, total_amount, amount_paid, balance_due')
        .eq('company_id', member.companyId)
        .in('invoice_type', ['rent', 'stay'])
        .gte('issue_date', start)
        .lte('issue_date', end)
        .limit(5000),
    ])

    const failed = [sitesRes.error, unitsRes.error, staysRes.error, leasesRes.error, invoicesRes.error].find(Boolean)
    if (failed) {
      setError(failed.message)
      setRows([])
      setLoading(false)
      return
    }

    setRows(buildOwnerStatements({
      sites: (sitesRes.data ?? []) as StatementSite[],
      units: (unitsRes.data ?? []) as StatementUnit[],
      stays: (staysRes.data ?? []) as StatementStay[],
      leases: (leasesRes.data ?? []) as StatementLease[],
      invoices: (invoicesRes.data ?? []) as StatementInvoice[],
      nights,
    }))
    setLoading(false)
  }, [month])

  useEffect(() => { void load() }, [load])

  const totals = useMemo(() => statementTotals(rows), [rows])

  if (error === 'not_linked') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[13px] text-text-secondary">Account not linked to an employee.</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-4 space-y-4 pb-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <button type="button" onClick={() => router.push('/dashboard/properties')} className="flex items-center gap-1 text-[13px] text-primary hover:underline mb-1">
              <span className="material-icons text-[16px]">arrow_back</span>
              Properties
            </button>
            <h1 className="text-[20px] font-semibold text-text-primary">Owner statement</h1>
            <p className="text-[12px] text-text-secondary mt-0.5">
              Occupancy for the month, plus rent and stay invoices issued in that month.
              Collected is what has been paid on those invoices.
            </p>
          </div>
          <label className="text-[12px] text-text-secondary">
            Month
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="mt-1 block h-10 px-3 border border-border rounded-md text-[13px] bg-background text-text-primary"
            />
          </label>
        </div>

        {error && <p className="text-[13px] text-error">{error}</p>}

        {loading ? (
          <p className="text-[13px] text-text-secondary">Loading statement…</p>
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-text-secondary">No properties to report for this month.</p>
        ) : (
          <div className="overflow-x-auto border border-divider rounded-xl">
            <table className="w-full" style={{ minWidth: 980 }}>
              <thead>
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className="data-th text-left">Property</th>
                  <th className="data-th text-left">Kind</th>
                  <th className="data-th text-right">Rooms</th>
                  <th className="data-th text-right">Occupancy</th>
                  <th className="data-th text-right">Rent billed</th>
                  <th className="data-th text-right">Rent collected</th>
                  <th className="data-th text-right">Stay billed</th>
                  <th className="data-th text-right">Stay collected</th>
                  <th className="data-th text-right">Still due</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.siteId} className="border-b border-divider">
                    <td className="data-td text-[13px] font-medium">
                      <Link href={`/dashboard/properties/${row.siteId}`} className="text-primary hover:underline">
                        {row.name}
                      </Link>
                    </td>
                    <td className="data-td text-[12px] text-text-secondary">{propertyKindLabel(row.kind)}</td>
                    <td className="data-td text-[13px] text-right">{row.rooms}</td>
                    <td className="data-td text-[13px] text-right" title={`${row.occupiedNights} of ${row.availableNights} room-nights`}>
                      {fmtPct(row.occupancyRatio)}
                    </td>
                    <td className="data-td text-[13px] text-right">{fmtMoney(row.rentBilled)}</td>
                    <td className="data-td text-[13px] text-right">{fmtMoney(row.rentCollected)}</td>
                    <td className="data-td text-[13px] text-right">{fmtMoney(row.stayBilled)}</td>
                    <td className="data-td text-[13px] text-right">{fmtMoney(row.stayCollected)}</td>
                    <td className="data-td text-[13px] text-right">{fmtMoney(row.outstanding)}</td>
                  </tr>
                ))}
                <tr className="bg-surface-elevated">
                  <td className="data-td text-[13px] font-semibold" colSpan={3}>All properties</td>
                  <td className="data-td text-[13px] text-right font-semibold">{fmtPct(totals.occupancyRatio)}</td>
                  <td className="data-td text-[13px] text-right font-semibold">{fmtMoney(totals.rentBilled)}</td>
                  <td className="data-td text-[13px] text-right font-semibold">{fmtMoney(totals.rentCollected)}</td>
                  <td className="data-td text-[13px] text-right font-semibold">{fmtMoney(totals.stayBilled)}</td>
                  <td className="data-td text-[13px] text-right font-semibold">{fmtMoney(totals.stayCollected)}</td>
                  <td className="data-td text-[13px] text-right font-semibold">{fmtMoney(totals.outstanding)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
