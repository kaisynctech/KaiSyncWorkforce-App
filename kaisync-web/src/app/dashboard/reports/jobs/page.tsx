'use client'

import { useMemo } from 'react'
import { useExporter, useInsights, useInsightsRpc } from '@/components/insights/InsightsContext'
import { useDownloads } from '@/components/insights/useDownloads'
import { d, kpiTable, Loadable, n, pointTitle, rollUp, SectionTitle } from '@/components/insights/dash'
import { AttentionRow, Card, ChartCard, ColumnChart, RankedBars, SegmentedBar, SERIES, StatTile, TrendChart } from '@/components/insights/viz'
import { count, countShort, days, moneyShort, pct, signedPct, words } from '@/lib/insights/format'
import { describeRange, grainFor, pointLabel, previousRange } from '@/lib/insights/period'
import type { TableSpec } from '@/lib/insights/table'
import type { JobsResult } from '@/lib/insights/types'

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low', 'none']

export default function JobsInsightsPage() {
  const { filters } = useInsights()
  const { data, loading, error } = useInsightsRpc<JobsResult>('insights_jobs')
  const { csv, pdf } = useDownloads()
  const compare = describeRange(previousRange(filters.range))
  // Jobs come back by week; long ranges read better by month.
  const grain = grainFor(filters.range) === 'month' ? 'month' : 'week'

  const k = data?.kpis
  const p = data?.previous

  const trend = useMemo(() => rollUp(data?.weekly ?? [], 'week', grain === 'month' ? 'month' : 'day', ['opened', 'completed']), [data, grain])

  const priority = useMemo(() => [...(data?.by_priority ?? [])]
    .sort((a, b) => PRIORITY_ORDER.indexOf(a.name) - PRIORITY_ORDER.indexOf(b.name))
    .map(r => ({ ...r, label: words(r.name === 'none' ? 'Not set' : r.name), avg: n(r.avg_days) })), [data])

  const tables = useMemo(() => {
    if (!data || !k || !p) return null
    const summary = kpiTable('Headline figures', [
      { measure: 'Jobs completed', now: count(k.completed), before: count(p.completed), change: signedPct(d(k, p, 'completed')) },
      { measure: 'Value of completed jobs', now: moneyShort(k.completed_value), before: moneyShort(p.completed_value), change: signedPct(d(k, p, 'completed_value')) },
      { measure: 'Jobs opened', now: count(k.opened), before: count(p.opened), change: signedPct(d(k, p, 'opened')) },
      { measure: 'Finished on time', now: pct(k.on_time_rate), before: pct(p.on_time_rate), change: signedPct(d(k, p, 'on_time_rate')) },
      { measure: 'Average days to complete', now: days(k.avg_days_to_complete), before: days(p.avg_days_to_complete), change: signedPct(d(k, p, 'avg_days_to_complete')) },
      { measure: 'Average hours to respond', now: `${count(k.avg_hours_to_respond)} h`, before: `${count(p.avg_hours_to_respond)} h`, change: signedPct(d(k, p, 'avg_hours_to_respond')) },
      { measure: 'Callbacks', now: pct(k.callback_rate), before: pct(p.callback_rate), change: signedPct(d(k, p, 'callback_rate')) },
      { measure: 'Cancelled', now: count(k.cancelled), before: count(p.cancelled), change: signedPct(d(k, p, 'cancelled')) },
    ])
    const trendT: TableSpec<Record<string, unknown>> = {
      title: grain === 'week' ? 'Each week' : 'Each month',
      columns: [
        { key: 'week', label: grain === 'week' ? 'Week of' : 'Month', kind: 'day' },
        { key: 'opened', label: 'Opened', kind: 'count' },
        { key: 'completed', label: 'Completed', kind: 'count' },
      ],
      rows: trend,
    }
    const clients: TableSpec<JobsResult['by_client'][number]> = {
      title: 'By client',
      columns: [
        { key: 'name', label: 'Client', width: 2.2 },
        { key: 'opened', label: 'Opened', kind: 'count' },
        { key: 'completed', label: 'Completed', kind: 'count' },
        { key: 'value', label: 'Completed value', kind: 'money', width: 1.4 },
      ],
      rows: data.by_client,
    }
    const techs: TableSpec<JobsResult['by_technician'][number]> = {
      title: 'Technician productivity',
      columns: [
        { key: 'name', label: 'Technician', width: 2 },
        { key: 'department', label: 'Department', width: 1.6 },
        { key: 'completed', label: 'Completed', kind: 'count' },
        { key: 'avg_days', label: 'Average days', kind: 'days' },
        { key: 'callbacks', label: 'Callbacks', kind: 'count' },
        { key: 'value', label: 'Value', kind: 'money', width: 1.4 },
      ],
      rows: data.by_technician,
    }
    const services: TableSpec<JobsResult['by_service'][number]> = {
      title: 'By service',
      columns: [
        { key: 'name', label: 'Service', width: 2 },
        { key: 'opened', label: 'Opened', kind: 'count' },
        { key: 'completed', label: 'Completed', kind: 'count' },
      ],
      rows: data.by_service,
    }
    const prio: TableSpec<(typeof priority)[number]> = {
      title: 'By priority',
      columns: [
        { key: 'label', label: 'Priority', width: 2 },
        { key: 'opened', label: 'Opened', kind: 'count' },
        { key: 'avg_days', label: 'Average days to complete', kind: 'days', width: 1.6 },
      ],
      rows: priority,
    }
    const open: TableSpec<{ name: string; count: number }> = {
      title: 'Open work right now',
      columns: [{ key: 'name', label: 'Status', kind: 'words', width: 2 }, { key: 'count', label: 'Jobs', kind: 'count' }],
      rows: data.status_now,
    }
    return { summary, trendT, clients, techs, services, prio, open }
  }, [data, k, p, trend, grain, priority])

  useExporter(tables ? {
    csv: () => csv('Jobs and operations', [tables.summary, tables.trendT, tables.open, tables.clients, tables.techs, tables.services, tables.prio]),
    pdf: () => pdf('Jobs and operations', [
      { kind: 'kpis', items: [
        { label: 'Jobs completed', value: count(k?.completed), sub: `${signedPct(d(k, p, 'completed'))} vs previous` },
        { label: 'Completed value', value: moneyShort(k?.completed_value), sub: `${signedPct(d(k, p, 'completed_value'))} vs previous` },
        { label: 'Finished on time', value: pct(k?.on_time_rate) },
        { label: 'Open right now', value: count(data?.open_now), sub: `${count(data?.overdue_now)} overdue · ${count(data?.unassigned_now)} unassigned` },
      ] },
      { kind: 'columns', title: grain === 'week' ? 'Jobs opened and completed each week' : 'Jobs opened and completed each month',
        labels: trend.map(r => pointLabel(String(r.week), grain)),
        series: [
          { name: 'Opened', color: SERIES[1], values: trend.map(r => n(r.opened)) },
          { name: 'Completed', color: SERIES[0], values: trend.map(r => n(r.completed)) },
        ], format: v => countShort(v) },
      { kind: 'table', table: tables.summary },
      { kind: 'bars', title: 'Completed value by client', items: (data?.by_client ?? []).map(c => ({ label: c.name, value: n(c.value), display: moneyShort(c.value) })) },
      { kind: 'table', table: tables.techs },
      { kind: 'table', table: tables.clients },
      { kind: 'table', table: tables.services },
      { kind: 'table', table: tables.prio },
      { kind: 'table', table: tables.open },
    ]),
  } : null, [tables, csv, pdf])

  const statusParts = (data?.status_now ?? []).map((s, i) => ({
    label: words(s.name), value: n(s.count), color: SERIES[i % SERIES.length], display: count(s.count), dark: SERIES[i % SERIES.length] === SERIES[3],
  }))

  return (
    <Loadable loading={loading} error={error} hasData={!!data}>
      {data && k && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile hero label="Jobs completed" icon="task_alt" value={count(k.completed)} delta={d(k, p, 'completed')} compare={compare}
              spark={trend.map(r => n(r.completed))} />
            <StatTile label="Value of completed jobs" icon="paid" value={moneyShort(k.completed_value)} delta={d(k, p, 'completed_value')} compare={compare} />
            <StatTile label="Finished on time" icon="alarm_on" value={pct(k.on_time_rate)} delta={d(k, p, 'on_time_rate')} compare={compare}
              hint="Completed by the planned end date" />
            <StatTile label="Average days to complete" icon="hourglass_bottom" value={k.avg_days_to_complete == null ? '—' : `${k.avg_days_to_complete}`}
              delta={d(k, p, 'avg_days_to_complete')} goodWhenUp={false} compare={compare} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
            <StatTile label="Jobs opened" icon="add_task" value={count(k.opened)} delta={d(k, p, 'opened')} goodWhenUp={null} compare={compare} />
            <StatTile label="Hours to first response" icon="bolt" value={k.avg_hours_to_respond == null ? '—' : `${k.avg_hours_to_respond}`}
              delta={d(k, p, 'avg_hours_to_respond')} goodWhenUp={false} compare={compare} />
            <StatTile label="Callbacks" icon="replay" value={pct(k.callback_rate)} delta={d(k, p, 'callback_rate')} goodWhenUp={false} compare={compare}
              hint="Jobs that needed a return visit" />
            <StatTile label="Cancelled" icon="block" value={count(k.cancelled)} delta={d(k, p, 'cancelled')} goodWhenUp={false} compare={compare} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mt-4">
            <ChartCard
              className="lg:col-span-2"
              title={grain === 'week' ? 'Opened and completed each week' : 'Opened and completed each month'}
              legend={[{ label: 'Opened', color: SERIES[1] }, { label: 'Completed', color: SERIES[0] }]}
              table={tables?.trendT}
            >
              <TrendChart
                data={trend}
                xKey="week"
                series={[
                  { key: 'opened', name: 'Opened', color: SERIES[1], kind: 'bar' },
                  { key: 'completed', name: 'Completed', color: SERIES[0], kind: 'bar' },
                ]}
                yFormat={v => countShort(v)}
                xFormat={x => pointLabel(x, grain)}
                tipTitle={x => pointTitle(x, grain)}
                height={260}
              />
            </ChartCard>
            <ChartCard title="Open work right now" subtitle={`${count(data.open_now)} jobs not finished`} table={tables?.open}>
              <SegmentedBar parts={statusParts} />
              <div className="mt-4">
                <AttentionRow icon="event_busy" tone="critical" label="Past their planned end date" value={count(data.overdue_now)} href="/dashboard/jobs" />
                <AttentionRow icon="person_search" tone="warning" label="Nobody assigned" value={count(data.unassigned_now)} href="/dashboard/jobs" />
              </div>
            </ChartCard>
          </div>

          <SectionTitle sub="Who the work was for and who did it">Clients and technicians</SectionTitle>
          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="Completed value by client" table={tables?.clients}>
              <RankedBars items={data.by_client.map(c => ({
                label: c.name, value: n(c.value), display: moneyShort(c.value), sub: `${count(c.completed)} of ${count(c.opened)} done`,
              }))} />
            </ChartCard>
            <ChartCard title="Jobs completed by technician" table={tables?.techs}>
              <RankedBars emptyText="No completed jobs with a technician" items={data.by_technician.map(t => ({
                label: t.name, value: n(t.completed), display: `${count(t.completed)} jobs`,
                sub: `${t.avg_days == null ? '—' : `${t.avg_days} days avg`}${t.callbacks ? ` · ${t.callbacks} callback${t.callbacks === 1 ? '' : 's'}` : ''}`,
                href: `/dashboard/employees/${t.employee_id}`, title: t.department ?? undefined,
              }))} />
            </ChartCard>
          </div>

          <SectionTitle sub="What kind of work came in, and how fast it was done">Work mix</SectionTitle>
          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="Jobs by service" legend={[{ label: 'Opened', color: SERIES[1] }, { label: 'Completed', color: SERIES[0] }]} table={tables?.services}>
              <ColumnChart
                data={data.by_service as unknown as Record<string, unknown>[]}
                xKey="name"
                series={[{ key: 'opened', name: 'Opened', color: SERIES[1] }, { key: 'completed', name: 'Completed', color: SERIES[0] }]}
                yFormat={v => countShort(v)}
              />
            </ChartCard>
            <ChartCard title="Average days to complete, by priority" subtitle="Critical work should be the fastest" table={tables?.prio}>
              <ColumnChart
                data={priority.filter(r => r.avg_days != null) as unknown as Record<string, unknown>[]}
                xKey="label"
                series={[{ key: 'avg', name: 'Average days', color: SERIES[0] }]}
                yFormat={v => (Number.isInteger(v) ? String(v) : v.toFixed(1))}
              />
            </ChartCard>
          </div>
        </>
      )}
      {data && !k && <Card className="p-8 text-center text-text-secondary">No jobs yet.</Card>}
    </Loadable>
  )
}
