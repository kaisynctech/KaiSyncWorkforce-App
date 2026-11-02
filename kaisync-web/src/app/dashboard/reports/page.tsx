'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useExporter, useInsights, useInsightsRpc } from '@/components/insights/InsightsContext'
import { useDownloads } from '@/components/insights/useDownloads'
import { d, kpiTable, Loadable, n, pointTitle, rollUp } from '@/components/insights/dash'
import { AttentionRow, Card, ChartCard, RAMP, SegmentedBar, SERIES, STATUS, StatTile, TrendChart } from '@/components/insights/viz'
import { count, countShort, hours, money, moneyShort, pct, signedPct, words } from '@/lib/insights/format'
import { describeRange, eachDay, grainFor, pointLabel, previousRange } from '@/lib/insights/period'
import type { TableSpec } from '@/lib/insights/table'
import type { HomeResult } from '@/lib/insights/types'

const SEVERITY: Record<string, string> = { low: RAMP[2], medium: STATUS.warning, high: STATUS.serious, critical: STATUS.critical }

export default function InsightsOverviewPage() {
  const { filters } = useInsights()
  const { data, loading, error } = useInsightsRpc<HomeResult>('insights_home')
  const { csv, pdf } = useDownloads()
  const compare = describeRange(previousRange(filters.range))
  const grain = grainFor(filters.range)
  const moneyGrain = grain === 'month' ? 'month' : 'week'

  const people = data?.people
  const jobs = data?.jobs
  const mon = data?.money
  const pay = data?.payroll

  const presence = useMemo(() => {
    const byDay = new Map((people?.daily ?? []).map(r => [r.d, r]))
    const daily = eachDay(filters.range).map(day => ({ d: day, present: n(byDay.get(day)?.present), late: n(byDay.get(day)?.late) }))
    const rolled = rollUp(daily, 'd', grain, ['present', 'late'])
    return grain === 'day' ? rolled : (rolled.map(r => ({ ...r, present: Math.round(n(r.present) / Math.max(1, n(r._days))) })) as Record<string, unknown>[])
  }, [people, filters.range, grain])

  const moneyTrend = useMemo(() => {
    const rows = moneyGrain === 'week' && mon?.weekly ? mon.weekly.map(r => ({ x: r.week, ...r })) : (mon?.monthly ?? []).map(r => ({ x: r.month, ...r }))
    return rows.map(r => ({ x: r.x, invoiced: n(r.invoiced), collected: n(r.collected) }))
  }, [mon, moneyGrain])

  const jobTrend = useMemo(() => rollUp(jobs?.weekly ?? [], 'week', grain === 'month' ? 'month' : 'day', ['opened', 'completed']), [jobs, grain])

  const summary = useMemo(() => {
    if (!people || !jobs || !mon || !pay) return null
    const P = people.kpis, Pp = people.previous, J = jobs.kpis, Jp = jobs.previous, M = mon.kpis, Mp = mon.previous, Y = pay.kpis, Yp = pay.previous
    return kpiTable('Business summary', [
      { measure: 'Attendance rate', now: pct(P.attendance_rate), before: pct(Pp.attendance_rate), change: signedPct(d(P, Pp, 'attendance_rate')) },
      { measure: 'Late arrivals (days)', now: count(P.late_days), before: count(Pp.late_days), change: signedPct(d(P, Pp, 'late_days')) },
      { measure: 'Hours worked', now: hours(P.hours), before: hours(Pp.hours), change: signedPct(d(P, Pp, 'hours')) },
      { measure: 'Jobs completed', now: count(J.completed), before: count(Jp.completed), change: signedPct(d(J, Jp, 'completed')) },
      { measure: 'Value of completed jobs', now: money(J.completed_value), before: money(Jp.completed_value), change: signedPct(d(J, Jp, 'completed_value')) },
      { measure: 'Jobs finished on time', now: pct(J.on_time_rate), before: pct(Jp.on_time_rate), change: signedPct(d(J, Jp, 'on_time_rate')) },
      { measure: 'Invoiced', now: money(M.invoiced), before: money(Mp.invoiced), change: signedPct(d(M, Mp, 'invoiced')) },
      { measure: 'Collected', now: money(M.collected), before: money(Mp.collected), change: signedPct(d(M, Mp, 'collected')) },
      { measure: 'Quote win rate', now: pct(M.win_rate), before: pct(Mp.win_rate), change: signedPct(d(M, Mp, 'win_rate')) },
      { measure: 'Gross pay', now: money(Y.gross), before: money(Yp.gross), change: signedPct(d(Y, Yp, 'gross')) },
      { measure: 'Net pay', now: money(Y.net), before: money(Yp.net), change: signedPct(d(Y, Yp, 'net')) },
      { measure: 'Incidents reported', now: count(data?.incidents.reported), before: count(data?.incidents.previous), change: signedPct(d({ v: data?.incidents.reported }, { v: data?.incidents.previous }, 'v')) },
    ])
  }, [people, jobs, mon, pay, data])

  const attentionT = useMemo<TableSpec<{ item: string; value: string }> | null>(() => {
    if (!data) return null
    return {
      title: 'Needs attention now',
      columns: [{ key: 'item', label: 'Item', width: 3 }, { key: 'value', label: 'Now' }],
      rows: [
        { item: 'Jobs past their planned end date', value: count(data.jobs.overdue_now) },
        { item: 'Open jobs', value: count(data.jobs.open_now) },
        { item: 'Money overdue from clients', value: money(data.money.ageing.overdue) },
        { item: 'Open incidents', value: count(data.incidents.open_now) },
        { item: 'Payslips waiting for approval', value: count(data.payroll.kpis.pending) },
        { item: 'People clocked in right now', value: count(data.on_site_now) },
      ],
    }
  }, [data])

  useExporter(summary && attentionT ? {
    csv: () => csv('Business summary', [summary, attentionT]),
    pdf: () => pdf('Business summary', [
      { kind: 'kpis', items: [
        { label: 'Attendance rate', value: pct(people?.kpis.attendance_rate), sub: `${signedPct(d(people?.kpis, people?.previous, 'attendance_rate'))} vs previous` },
        { label: 'Jobs completed', value: count(jobs?.kpis.completed), sub: `${moneyShort(jobs?.kpis.completed_value)} of work` },
        { label: 'Invoiced', value: moneyShort(mon?.kpis.invoiced), sub: `${moneyShort(mon?.kpis.collected)} collected` },
        { label: 'Gross pay', value: moneyShort(pay?.kpis.gross), sub: `${count(pay?.kpis.people)} people` },
      ] },
      { kind: 'columns', title: moneyGrain === 'week' ? 'Invoiced and collected each week' : 'Invoiced and collected each month',
        labels: moneyTrend.map(r => pointLabel(r.x, moneyGrain)),
        series: [
          { name: 'Invoiced', color: SERIES[0], values: moneyTrend.map(r => r.invoiced) },
          { name: 'Collected', color: SERIES[1], values: moneyTrend.map(r => r.collected) },
        ], format: v => moneyShort(v) },
      { kind: 'table', table: summary },
      { kind: 'table', table: attentionT },
    ]),
  } : null, [summary, attentionT, csv, pdf])

  return (
    <Loadable loading={loading} error={error} hasData={!!data}>
      {data && people && jobs && mon && pay && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <StatTile hero href="/dashboard/reports/people" label="Attendance rate" icon="how_to_reg" value={pct(people.kpis.attendance_rate)}
              delta={d(people.kpis, people.previous, 'attendance_rate')} compare={compare} spark={presence.map(r => n(r.present))} />
            <StatTile hero href="/dashboard/reports/jobs" label="Jobs completed" icon="task_alt" value={count(jobs.kpis.completed)}
              delta={d(jobs.kpis, jobs.previous, 'completed')} compare={compare} spark={jobTrend.map(r => n(r.completed))} />
            <StatTile hero href="/dashboard/reports/money" label="Invoiced" icon="receipt_long" value={moneyShort(mon.kpis.invoiced)}
              delta={d(mon.kpis, mon.previous, 'invoiced')} compare={compare} spark={moneyTrend.map(r => r.invoiced)} />
            <StatTile hero href="/dashboard/reports/payroll" label="Gross pay" icon="payments" value={moneyShort(pay.kpis.gross)}
              delta={d(pay.kpis, pay.previous, 'gross')} goodWhenUp={null} compare={compare} spark={(pay.monthly ?? []).map(r => n(r.gross))} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mt-4">
            <ChartCard
              className="lg:col-span-2"
              title={moneyGrain === 'week' ? 'Invoiced and collected each week' : 'Invoiced and collected each month'}
              legend={[{ label: 'Invoiced', color: SERIES[0] }, { label: 'Collected', color: SERIES[1] }]}
              action={<Link href="/dashboard/reports/money" className="text-[12px] font-medium text-primary hover:underline mr-1">Open</Link>}
            >
              <TrendChart
                data={moneyTrend}
                xKey="x"
                series={[
                  { key: 'invoiced', name: 'Invoiced', color: SERIES[0], kind: 'bar' },
                  { key: 'collected', name: 'Collected', color: SERIES[1], kind: 'bar' },
                ]}
                yFormat={v => moneyShort(v)}
                xFormat={x => pointLabel(x, moneyGrain)}
                tipTitle={x => pointTitle(x, moneyGrain)}
                height={250}
              />
            </ChartCard>
            <Card className="p-4 sm:p-5">
              <h3 className="text-[14px] font-semibold text-text-primary">Needs attention now</h3>
              <p className="text-[12px] text-text-secondary mb-2">As things stand today</p>
              <AttentionRow icon="event_busy" tone={jobs.overdue_now ? 'critical' : 'neutral'} label="Jobs past their planned end date" value={count(jobs.overdue_now)} href="/dashboard/jobs" />
              <AttentionRow icon="request_page" tone={n(mon.ageing.overdue) > 0 ? 'serious' : 'neutral'} label="Money overdue from clients" value={moneyShort(mon.ageing.overdue)} href="/dashboard/reports/money" />
              <AttentionRow icon="health_and_safety" tone={data.incidents.open_now ? 'warning' : 'neutral'} label="Open incidents" value={count(data.incidents.open_now)} href="/dashboard/incidents" />
              <AttentionRow icon="pending_actions" tone={pay.kpis.pending ? 'warning' : 'neutral'} label="Payslips waiting for approval" value={count(pay.kpis.pending)} href="/dashboard/payroll" />
              <AttentionRow icon="construction" tone="neutral" label="Open jobs" value={count(jobs.open_now)} href="/dashboard/jobs" />
              <AttentionRow icon="login" tone="neutral" label="People clocked in right now" value={count(data.on_site_now)} href="/dashboard/attendance" />
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-4 mt-4">
            <ChartCard
              title={grain === 'day' ? 'People at work each day' : `Average people at work per day, by ${grain}`}
              subtitle={`Out of ${count(people.kpis.headcount)} people`}
              action={<Link href="/dashboard/reports/people" className="text-[12px] font-medium text-primary hover:underline mr-1">Open</Link>}
            >
              <TrendChart
                data={presence}
                xKey="d"
                series={[{ key: 'present', name: 'At work', color: SERIES[0], kind: grain === 'day' ? 'area' : 'bar' }]}
                yFormat={v => countShort(v)}
                xFormat={x => pointLabel(x, grain)}
                tipTitle={x => pointTitle(x, grain)}
                footer={r => `${count(r.late)} late`}
                height={220}
              />
            </ChartCard>
            <ChartCard
              title={grain === 'month' ? 'Jobs opened and completed each month' : 'Jobs opened and completed each week'}
              legend={[{ label: 'Opened', color: SERIES[1] }, { label: 'Completed', color: SERIES[0] }]}
              action={<Link href="/dashboard/reports/jobs" className="text-[12px] font-medium text-primary hover:underline mr-1">Open</Link>}
            >
              <TrendChart
                data={jobTrend}
                xKey="week"
                series={[
                  { key: 'opened', name: 'Opened', color: SERIES[1], kind: 'bar' },
                  { key: 'completed', name: 'Completed', color: SERIES[0], kind: 'bar' },
                ]}
                yFormat={v => countShort(v)}
                xFormat={x => pointLabel(x, grain === 'month' ? 'month' : 'week')}
                tipTitle={x => pointTitle(x, grain === 'month' ? 'month' : 'week')}
                height={220}
              />
            </ChartCard>
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mt-4">
            <ChartCard title="Money owed to you" subtitle={`${moneyShort(mon.ageing.outstanding)} in total, as at today`}>
              <SegmentedBar parts={mon.ageing.buckets.map((b, i) => ({
                label: b.name, value: n(b.amount), color: [RAMP[1], RAMP[2], RAMP[3], RAMP[5], RAMP[6]][i] ?? RAMP[4],
                display: moneyShort(b.amount), dark: i < 2,
              }))} />
            </ChartCard>
            <ChartCard title="Incidents" subtitle={`${count(data.incidents.reported)} reported in the period · ${count(data.incidents.open_now)} still open`}>
              {data.incidents.by_severity.length ? (
                <SegmentedBar parts={data.incidents.by_severity.map(s => ({
                  label: words(s.name), value: n(s.count), color: SEVERITY[s.name] ?? RAMP[3], display: count(s.count), dark: s.name === 'medium' || s.name === 'low',
                }))} />
              ) : <p className="text-[13px] text-text-secondary py-6 text-center">No incidents reported in this period.</p>}
            </ChartCard>
            <Card className="p-4 sm:p-5">
              <h3 className="text-[14px] font-semibold text-text-primary">Ready-made reports</h3>
              <p className="text-[12px] text-text-secondary mb-3">Tables you can print or open in a spreadsheet</p>
              <div className="flex flex-col gap-1">
                {[
                  ['Attendance register', 'attendance-register'],
                  ['Late arrivals', 'late-arrivals'],
                  ['Jobs completed', 'jobs-completed'],
                  ['Debtors ageing', 'debtors-ageing'],
                  ['Payroll summary', 'payroll-summary'],
                ].map(([label, key]) => (
                  <Link key={key} href={`/dashboard/reports/library/${key}`} className="flex items-center gap-2 py-1.5 text-[13px] text-text-primary hover:underline no-underline">
                    <span className="material-icons text-[17px] text-slate-400">description</span>{label}
                  </Link>
                ))}
                <Link href="/dashboard/reports/library" className="text-[12.5px] font-medium text-primary hover:underline mt-1">All reports →</Link>
              </div>
            </Card>
          </div>

        </>
      )}
    </Loadable>
  )
}
