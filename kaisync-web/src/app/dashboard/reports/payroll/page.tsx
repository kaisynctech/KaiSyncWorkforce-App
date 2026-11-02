'use client'

import { useEffect, useMemo } from 'react'
import { useExporter, useInsights, useInsightsRpc, useOrgFilters } from '@/components/insights/InsightsContext'
import { useDownloads } from '@/components/insights/useDownloads'
import { d, kpiTable, Loadable, n, SectionTitle } from '@/components/insights/dash'
import { ChartCard, RankedBars, SegmentedBar, SERIES, STATUS, StatTile, TrendChart } from '@/components/insights/viz'
import { count, hours, money, moneyShort, signedPct } from '@/lib/insights/format'
import { describeRange, pointLabel, previousRange } from '@/lib/insights/period'
import type { TableSpec } from '@/lib/insights/table'
import type { PayrollResult } from '@/lib/insights/types'

export default function PayrollInsightsPage() {
  useOrgFilters()
  const { filters, setOptions } = useInsights()
  const { data, loading, error } = useInsightsRpc<PayrollResult>('insights_payroll', { org: true })
  const { csv, pdf } = useDownloads()
  const compare = describeRange(previousRange(filters.range))
  const k = data?.kpis
  const p = data?.previous

  useEffect(() => {
    if (data) setOptions({ branches: data.branches ?? [], departments: data.departments ?? [] })
  }, [data, setOptions])

  const monthly = useMemo(() => (data?.monthly ?? []).map(m => ({
    month: m.month, gross: n(m.gross), net: n(m.net), deductions: n(m.deductions), overtime_pay: n(m.overtime_pay), people: n(m.people),
  })), [data])

  const tables = useMemo(() => {
    if (!data || !k || !p) return null
    const summary = kpiTable('Headline figures', [
      { measure: 'Gross pay', now: money(k.gross), before: money(p.gross), change: signedPct(d(k, p, 'gross')) },
      { measure: 'Deductions', now: money(k.deductions), before: money(p.deductions), change: signedPct(d(k, p, 'deductions')) },
      { measure: 'Net pay', now: money(k.net), before: money(p.net), change: signedPct(d(k, p, 'net')) },
      { measure: 'Overtime pay', now: money(k.overtime_pay), before: money(p.overtime_pay), change: signedPct(d(k, p, 'overtime_pay')) },
      { measure: 'Overtime hours paid', now: hours(k.overtime_hours), before: hours(p.overtime_hours), change: signedPct(d(k, p, 'overtime_hours')) },
      { measure: 'People paid', now: count(k.people), before: count(p.people), change: signedPct(d(k, p, 'people')) },
      { measure: 'Payslips', now: count(k.payslips), before: count(p.payslips), change: signedPct(d(k, p, 'payslips')) },
      { measure: 'Average gross per payslip', now: money(k.avg_gross), before: money(p.avg_gross), change: signedPct(d(k, p, 'avg_gross')) },
    ])
    const monthT: TableSpec<(typeof monthly)[number]> = {
      title: 'Each month',
      columns: [
        { key: 'month', label: 'Month', kind: 'day' },
        { key: 'people', label: 'People', kind: 'count' },
        { key: 'gross', label: 'Gross', kind: 'money', width: 1.3 },
        { key: 'deductions', label: 'Deductions', kind: 'money', width: 1.3 },
        { key: 'net', label: 'Net', kind: 'money', width: 1.3 },
        { key: 'overtime_pay', label: 'Overtime pay', kind: 'money', width: 1.2 },
      ],
      rows: monthly,
      totals: {
        gross: monthly.reduce((a, r) => a + r.gross, 0), deductions: monthly.reduce((a, r) => a + r.deductions, 0),
        net: monthly.reduce((a, r) => a + r.net, 0), overtime_pay: monthly.reduce((a, r) => a + r.overtime_pay, 0),
      },
    }
    const dept: TableSpec<PayrollResult['by_department'][number]> = {
      title: 'By department',
      columns: [
        { key: 'name', label: 'Department', width: 2 },
        { key: 'people', label: 'People', kind: 'count' },
        { key: 'gross', label: 'Gross', kind: 'money', width: 1.3 },
        { key: 'net', label: 'Net', kind: 'money', width: 1.3 },
        { key: 'overtime_pay', label: 'Overtime pay', kind: 'money', width: 1.2 },
        { key: 'overtime_hours', label: 'Overtime hours', kind: 'hours' },
      ],
      rows: data.by_department,
      totals: { people: k.people, gross: k.gross, net: k.net, overtime_pay: k.overtime_pay, overtime_hours: k.overtime_hours },
    }
    const site: TableSpec<PayrollResult['by_branch'][number]> = {
      title: 'By site',
      columns: [
        { key: 'name', label: 'Site', width: 2 },
        { key: 'people', label: 'People', kind: 'count' },
        { key: 'gross', label: 'Gross', kind: 'money', width: 1.3 },
        { key: 'overtime_pay', label: 'Overtime pay', kind: 'money', width: 1.2 },
      ],
      rows: data.by_branch,
      totals: { people: k.people, gross: k.gross, overtime_pay: k.overtime_pay },
    }
    return { summary, monthT, dept, site }
  }, [data, k, p, monthly])

  useExporter(tables ? {
    csv: () => csv('Payroll summary', [tables.summary, tables.monthT, tables.dept, tables.site]),
    pdf: () => pdf('Payroll summary', [
      { kind: 'kpis', items: [
        { label: 'Gross pay', value: moneyShort(k?.gross), sub: `${signedPct(d(k, p, 'gross'))} vs previous` },
        { label: 'Net pay', value: moneyShort(k?.net) },
        { label: 'Deductions', value: moneyShort(k?.deductions) },
        { label: 'People paid', value: count(k?.people), sub: `${count(k?.payslips)} payslips` },
      ] },
      { kind: 'columns', title: 'Net pay and deductions each month', labels: monthly.map(m => pointLabel(m.month, 'month')),
        series: [
          { name: 'Net pay', color: SERIES[0], values: monthly.map(m => m.net) },
          { name: 'Deductions', color: SERIES[1], values: monthly.map(m => m.deductions) },
        ], format: v => moneyShort(v) },
      { kind: 'table', table: tables.summary },
      { kind: 'table', table: tables.monthT },
      { kind: 'bars', title: 'Gross pay by department', items: (data?.by_department ?? []).map(r => ({ label: r.name, value: n(r.gross), display: moneyShort(r.gross) })) },
      { kind: 'table', table: tables.dept },
      { kind: 'table', table: tables.site },
      { kind: 'note', text: 'Each payslip counts in the period its pay period ends. Rejected payslips are left out.' },
    ]),
  } : null, [tables, csv, pdf])

  const statusParts = [
    { label: 'Waiting for approval', value: n(k?.pending), color: STATUS.warning, display: count(k?.pending), dark: true },
    { label: 'Approved', value: n(k?.approved), color: SERIES[0], display: count(k?.approved) },
    { label: 'Paid', value: n(k?.paid), color: STATUS.good, display: count(k?.paid) },
  ]

  return (
    <Loadable loading={loading} error={error} hasData={!!data}>
      {data && k && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile hero label="Gross pay" icon="payments" value={moneyShort(k.gross)} delta={d(k, p, 'gross')} goodWhenUp={null} compare={compare}
              spark={monthly.map(m => m.gross)} />
            <StatTile label="Net pay" icon="account_balance_wallet" value={moneyShort(k.net)} delta={d(k, p, 'net')} goodWhenUp={null} compare={compare} />
            <StatTile label="Deductions" icon="request_quote" value={moneyShort(k.deductions)} delta={d(k, p, 'deductions')} goodWhenUp={null} compare={compare}
              hint={k.gross ? `${Math.round((n(k.deductions) / n(k.gross)) * 100)}% of gross` : undefined} />
            <StatTile label="People paid" icon="groups" value={count(k.people)} delta={d(k, p, 'people')} goodWhenUp={null} compare={compare}
              hint={`${count(k.payslips)} payslips`} href="/dashboard/payroll" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
            <StatTile label="Average gross per payslip" icon="person" value={moneyShort(k.avg_gross)} delta={d(k, p, 'avg_gross')} goodWhenUp={null} compare={compare} />
            <StatTile label="Overtime pay" icon="more_time" value={moneyShort(k.overtime_pay)} delta={d(k, p, 'overtime_pay')} goodWhenUp={false} compare={compare}
              hint={`${hours(k.overtime_hours)} paid`} />
            <StatTile label="Waiting for approval" icon="pending" value={count(k.pending)} hint="Payslips not yet approved" href="/dashboard/payroll" />
            <StatTile label="Paid" icon="verified" value={count(k.paid)} hint={`${count(k.approved)} approved, not yet paid`} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mt-4">
            <ChartCard
              className="lg:col-span-2"
              title="Net pay and deductions each month"
              subtitle="Together they make up gross pay"
              legend={[{ label: 'Net pay', color: SERIES[0] }, { label: 'Deductions', color: SERIES[1] }]}
              table={tables?.monthT}
            >
              <TrendChart
                data={monthly}
                xKey="month"
                stacked
                series={[
                  { key: 'net', name: 'Net pay', color: SERIES[0], kind: 'bar' },
                  { key: 'deductions', name: 'Deductions', color: SERIES[1], kind: 'bar' },
                ]}
                yFormat={v => moneyShort(v)}
                xFormat={x => pointLabel(x, 'month')}
                tipTitle={x => pointLabel(x, 'month')}
                footer={r => `Gross ${moneyShort(r.gross)} · ${count(r.people)} people`}
                height={260}
              />
            </ChartCard>
            <ChartCard title="Payslips by status" subtitle={`${count(k.payslips)} payslips in the period`}>
              <SegmentedBar parts={statusParts} />
            </ChartCard>
          </div>

          <SectionTitle sub="Where the wage bill sits">Departments and sites</SectionTitle>
          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="Gross pay by department" table={tables?.dept}>
              <RankedBars items={data.by_department.map(r => ({
                label: r.name, value: n(r.gross), display: moneyShort(r.gross), sub: `${count(r.people)} people`,
              }))} />
            </ChartCard>
            <ChartCard title="Gross pay by site" table={tables?.site}>
              <RankedBars items={data.by_branch.map(r => ({
                label: r.name, value: n(r.gross), display: moneyShort(r.gross), sub: `${count(r.people)} people`,
              }))} />
            </ChartCard>
          </div>
          <div className="grid lg:grid-cols-2 gap-4 mt-4">
            <ChartCard title="Overtime pay by department" table={tables?.dept}>
              <RankedBars color={SERIES[1]} emptyText="No overtime paid" items={data.by_department.filter(r => n(r.overtime_pay) > 0).map(r => ({
                label: r.name, value: n(r.overtime_pay), display: moneyShort(r.overtime_pay), sub: hours(r.overtime_hours),
              }))} />
            </ChartCard>
            <ChartCard title="Gross per person in the period, by department" table={tables?.dept}>
              <RankedBars color={SERIES[2]} items={data.by_department
                .filter(r => n(r.people) > 0)
                .map(r => ({ label: r.name, value: n(r.gross) / n(r.people), display: moneyShort(n(r.gross) / n(r.people)) }))
                .sort((a, b) => b.value - a.value)} />
            </ChartCard>
          </div>
          <p className="text-[11.5px] text-text-secondary mt-6">
            Each payslip counts in the period its pay period ends. Rejected payslips are left out.
          </p>
        </>
      )}
    </Loadable>
  )
}
