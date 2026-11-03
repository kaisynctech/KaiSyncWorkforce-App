'use client'

import { useEffect, useMemo } from 'react'
import { useExporter, useInsights, useInsightsRpc, useOrgFilters } from '@/components/insights/InsightsContext'
import { useDownloads } from '@/components/insights/useDownloads'
import { d, kpiTable, Loadable, n, pointTitle, rollUp, SectionTitle } from '@/components/insights/dash'
import { CalendarHeat, ChartCard, RankedBars, SegmentedBar, SERIES, STATUS, StatTile, TrendChart } from '@/components/insights/viz'
import { count, countShort, dayLong, hours, pct, plural, signedPct, vsPrevious } from '@/lib/insights/format'
import { describeRange, eachDay, grainFor, pointLabel, previousRange } from '@/lib/insights/period'
import type { TableSpec } from '@/lib/insights/table'
import type { PeopleGroup, PeopleResult } from '@/lib/insights/types'

export default function PeopleInsightsPage() {
  useOrgFilters()
  const { filters, setOptions } = useInsights()
  const { data, loading, error } = useInsightsRpc<PeopleResult>('insights_people', { org: true })
  const { csv, pdf } = useDownloads()
  const grain = grainFor(filters.range)
  const compare = describeRange(previousRange(filters.range))

  useEffect(() => {
    if (data) setOptions({ branches: data.branches ?? [], departments: data.departments ?? [] })
  }, [data, setOptions])

  const k = data?.kpis
  const p = data?.previous
  const head = n(k?.headcount) || 1

  // Daily presence with every calendar day, so quiet days show as gaps rather than vanishing.
  const daily = useMemo(() => {
    const byDay = new Map((data?.daily ?? []).map(r => [r.d, r]))
    return eachDay(filters.range).map(day => {
      const r = byDay.get(day)
      return { d: day, present: n(r?.present), late: n(r?.late), hours: n(r?.hours), overtime: n(r?.overtime) }
    })
  }, [data, filters.range])

  const series = useMemo(() => {
    const rolled = rollUp(daily, 'd', grain, ['present', 'late', 'hours', 'overtime'])
    // For weeks and months show the average people per day, so the line keeps its meaning.
    return grain === 'day' ? rolled : (rolled.map(r => ({ ...r, present: Math.round(n(r.present) / Math.max(1, n(r._days))) })) as Record<string, unknown>[])
  }, [daily, grain])

  const heat = useMemo(() => {
    const threshold = Math.max(1, Math.ceil(head * 0.2))
    return daily.map(r => {
      const dow = new Date(`${r.d}T12:00:00Z`).getUTCDay()
      const work = dow !== 0 && dow !== 6 && r.present >= threshold
      const rate = r.present / head
      return {
        d: r.d,
        value: work ? rate : null,
        tip: `${dayLong(r.d)}: ${count(r.present)} at work${work ? ` (${pct(rate * 100)})` : ''}${r.late ? ` · ${r.late} late` : ''}`,
      }
    })
  }, [daily, head])

  const groupTable = (title: string, rows: PeopleGroup[], first: string): TableSpec<PeopleGroup> => ({
    title,
    columns: [
      { key: 'name', label: first, width: 2 },
      { key: 'headcount', label: 'People', kind: 'count' },
      { key: 'present_days', label: 'Days at work', kind: 'count' },
      { key: 'late_days', label: 'Late days', kind: 'count' },
      { key: 'hours', label: 'Hours', kind: 'hours' },
      { key: 'overtime', label: 'Overtime', kind: 'hours' },
    ],
    rows,
  })

  const tables = useMemo(() => {
    if (!data || !k || !p) return null
    const summary = kpiTable('Headline figures', [
      { measure: 'Attendance rate', now: pct(k.attendance_rate), before: pct(p.attendance_rate), change: signedPct(d(k, p, 'attendance_rate')) },
      { measure: 'Late arrivals (days)', now: count(k.late_days), before: count(p.late_days), change: signedPct(d(k, p, 'late_days')) },
      { measure: 'Late rate', now: pct(k.late_rate), before: pct(p.late_rate), change: signedPct(d(k, p, 'late_rate')) },
      { measure: 'Average minutes late', now: count(k.avg_minutes_late), before: count(p.avg_minutes_late), change: signedPct(d(k, p, 'avg_minutes_late')) },
      { measure: 'Hours worked', now: hours(k.hours), before: hours(p.hours), change: signedPct(d(k, p, 'hours')) },
      { measure: 'Overtime hours', now: hours(k.overtime_hours), before: hours(p.overtime_hours), change: signedPct(d(k, p, 'overtime_hours')) },
      { measure: 'Absent days', now: count(k.absent_days), before: count(p.absent_days), change: signedPct(d(k, p, 'absent_days')) },
      { measure: 'Leave days', now: count(k.leave_days), before: count(p.leave_days), change: signedPct(d(k, p, 'leave_days')) },
      { measure: 'People', now: count(k.headcount), before: count(p.headcount), change: signedPct(d(k, p, 'headcount')) },
      { measure: 'Work days', now: count(k.work_days), before: count(p.work_days), change: '' },
    ])
    const dailyT: TableSpec<Record<string, unknown>> = {
      title: grain === 'day' ? 'Each day' : grain === 'week' ? 'Each week' : 'Each month',
      columns: [
        { key: 'd', label: grain === 'day' ? 'Day' : grain === 'week' ? 'Week of' : 'Month', kind: 'day' },
        { key: 'present', label: grain === 'day' ? 'At work' : 'At work (avg per day)', kind: 'count' },
        { key: 'late', label: 'Late', kind: 'count' },
        { key: 'hours', label: 'Hours', kind: 'hours' },
        { key: 'overtime', label: 'Overtime', kind: 'hours' },
      ],
      rows: series,
    }
    const dept = groupTable('By department', data.by_department, 'Department')
    const site = groupTable('By site', data.by_branch, 'Site')
    const late: TableSpec<Record<string, unknown>> = {
      title: 'Most late arrivals',
      columns: [
        { key: 'name', label: 'Person', width: 2 }, { key: 'department', label: 'Department', width: 1.5 },
        { key: 'late_days', label: 'Late days', kind: 'count' }, { key: 'minutes_late', label: 'Minutes late', kind: 'minutes' },
      ],
      rows: data.top_late as unknown as Record<string, unknown>[],
    }
    const ot: TableSpec<Record<string, unknown>> = {
      title: 'Most overtime',
      columns: [
        { key: 'name', label: 'Person', width: 2 }, { key: 'department', label: 'Department', width: 1.5 },
        { key: 'overtime', label: 'Overtime', kind: 'hours' },
      ],
      rows: data.top_overtime as unknown as Record<string, unknown>[],
    }
    const leave: TableSpec<Record<string, unknown>> = {
      title: 'Leave by type',
      columns: [{ key: 'type', label: 'Type', width: 2 }, { key: 'days', label: 'Days', kind: 'count' }],
      rows: data.leave_by_type as unknown as Record<string, unknown>[],
    }
    return { summary, dailyT, dept, site, late, ot, leave }
  }, [data, k, p, series, grain])

  useExporter(tables ? {
    csv: () => csv('People and attendance', [tables.summary, tables.dailyT, tables.dept, tables.site, tables.late, tables.ot, tables.leave]),
    pdf: () => pdf('People and attendance', [
      { kind: 'kpis', items: [
        { label: 'Attendance rate', value: pct(k?.attendance_rate), sub: vsPrevious(d(k, p, 'attendance_rate')) },
        { label: 'Late arrivals', value: count(k?.late_days), sub: `${pct(k?.late_rate)} of days at work` },
        { label: 'Hours worked', value: hours(k?.hours), sub: vsPrevious(d(k, p, 'hours')) },
        { label: 'Overtime', value: hours(k?.overtime_hours), sub: vsPrevious(d(k, p, 'overtime_hours')) },
      ] },
      { kind: 'columns', title: grain === 'day' ? 'People at work each day' : 'Average people at work per day', labels: series.map(r => pointLabel(String(r.d), grain)),
        series: [{ name: 'At work', color: SERIES[0], values: series.map(r => n(r.present)) }], format: v => countShort(v) },
      { kind: 'table', table: tables.summary },
      { kind: 'table', table: tables.dept },
      { kind: 'table', table: tables.site },
      { kind: 'table', table: tables.late },
      { kind: 'table', table: tables.ot },
      { kind: 'table', table: tables.leave },
      { kind: 'note', text: 'A work day is a weekday when at least a fifth of the team clocked in. Late means more than 5 minutes after the start of the person\'s shift. Days run from 05:00 to 05:00.' },
    ]),
  } : null, [tables, csv, pdf])

  const presence = [
    { label: 'At work', value: n(k?.present_days), color: SERIES[0], display: count(k?.present_days) },
    { label: 'On leave', value: n(k?.leave_days), color: SERIES[2], display: count(k?.leave_days) },
    { label: 'Absent', value: n(k?.absent_days), color: STATUS.critical, display: count(k?.absent_days) },
  ]

  return (
    <Loadable loading={loading} error={error} hasData={!!data}>
      {data && k && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile hero className="col-span-2 lg:col-span-1" label="Attendance rate" icon="how_to_reg" value={pct(k.attendance_rate)} delta={d(k, p, 'attendance_rate')} compare={compare}
              spark={heat.filter(h => h.value != null).map(h => n(h.value))} />
            <StatTile label="Late arrivals" icon="schedule" value={count(k.late_days)} delta={d(k, p, 'late_days')} goodWhenUp={false} compare={compare}
              hint={`${pct(k.late_rate)} of days at work · ${count(k.avg_minutes_late)} min on average`} />
            <StatTile label="Hours worked" icon="timer" value={countShort(k.hours)} delta={d(k, p, 'hours')} goodWhenUp={null} compare={compare} />
            <StatTile label="Overtime hours" icon="more_time" value={countShort(k.overtime_hours)} delta={d(k, p, 'overtime_hours')} goodWhenUp={null} compare={compare} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
            <StatTile label="People" icon="badge" value={count(k.headcount)} hint={`${count(data.on_site_now)} clocked in right now`} />
            <StatTile label="Absent days" icon="person_off" value={count(k.absent_days)} delta={d(k, p, 'absent_days')} goodWhenUp={false} compare={compare} />
            <StatTile label="Leave days" icon="beach_access" value={count(k.leave_days)} delta={d(k, p, 'leave_days')} goodWhenUp={null} compare={compare}
              hint={`${count(data.pending_leave)} requests waiting`} href="/dashboard/leave" />
            <StatTile label="Work days" icon="event_available" value={count(k.work_days)} hint="Weekdays when the team worked" />
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mt-4">
            <ChartCard
              className="lg:col-span-2"
              title={grain === 'day' ? 'People at work each day' : `Average people at work per day, by ${grain}`}
              subtitle={`Out of ${count(k.headcount)} people`}
              table={tables?.dailyT}
            >
              <TrendChart
                data={series}
                xKey="d"
                series={[{ key: 'present', name: 'At work', color: SERIES[0], kind: grain === 'day' ? 'area' : 'bar' }]}
                yFormat={v => countShort(v)}
                xFormat={x => pointLabel(x, grain)}
                tipTitle={x => pointTitle(x, grain)}
                footer={r => `${count(r.late)} late · ${hours(r.overtime)} overtime`}
                height={260}
              />
            </ChartCard>
            <ChartCard title="Where the days went" subtitle="Every expected work day, split three ways">
              <div className="pt-2">
                <SegmentedBar parts={presence} />
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[11.5px] text-text-secondary">Expected days</p>
                    <p className="text-[18px] font-semibold text-text-primary">{count(k.expected_days)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[11.5px] text-text-secondary">Average late by</p>
                    <p className="text-[18px] font-semibold text-text-primary">{k.avg_minutes_late == null ? '—' : `${count(k.avg_minutes_late)} min`}</p>
                  </div>
                </div>
              </div>
            </ChartCard>
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mt-4">
            <ChartCard className="lg:col-span-2" title="Attendance calendar" subtitle="Darker means more of the team came in">
              <CalendarHeat days={heat} scaleLabel={['Fewer', 'More']} />
            </ChartCard>
            <ChartCard title={grain === 'day' ? 'Late arrivals each day' : `Late arrivals by ${grain}`} table={tables?.dailyT}>
              <TrendChart
                data={series}
                xKey="d"
                series={[{ key: 'late', name: 'Late', color: SERIES[1], kind: 'bar' }]}
                yFormat={v => countShort(v)}
                xFormat={x => pointLabel(x, grain)}
                tipTitle={x => pointTitle(x, grain)}
                height={220}
              />
            </ChartCard>
          </div>

          <SectionTitle sub="Hours and lateness for each part of the business">Teams and sites</SectionTitle>
          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="Hours by department" table={tables?.dept}>
              <RankedBars items={data.by_department.map(g => ({
                label: g.name, value: n(g.hours), display: hours(g.hours),
                sub: `${count(g.headcount)} people · ${count(g.late_days)} late`,
              }))} />
            </ChartCard>
            <ChartCard title="Hours by site" table={tables?.site}>
              <RankedBars items={data.by_branch.map(g => ({
                label: g.name, value: n(g.hours), display: hours(g.hours),
                sub: `${count(g.headcount)} people · ${count(g.late_days)} late`,
              }))} />
            </ChartCard>
          </div>

          <SectionTitle sub="The people to talk to first">People to watch</SectionTitle>
          <div className="grid lg:grid-cols-3 gap-4">
            <ChartCard title="Most late arrivals" table={tables?.late}>
              <RankedBars color={SERIES[1]} emptyText="Nobody was late" items={data.top_late.map(r => ({
                label: r.name, value: n(r.late_days), display: plural(r.late_days, 'day', 'days'), sub: `${count(r.minutes_late)} min`,
                href: `/dashboard/employees/${r.employee_id}`, title: r.department ?? undefined,
              }))} />
            </ChartCard>
            <ChartCard title="Most overtime" table={tables?.ot}>
              <RankedBars emptyText="No overtime" items={data.top_overtime.map(r => ({
                label: r.name, value: n(r.overtime), display: hours(r.overtime),
                href: `/dashboard/employees/${r.employee_id}`, title: r.department ?? undefined,
              }))} />
            </ChartCard>
            <ChartCard title="Leave taken by type" subtitle="Approved leave days in the period" table={tables?.leave}>
              <RankedBars color={SERIES[2]} emptyText="No leave taken" items={data.leave_by_type.map(r => ({
                label: r.type, value: n(r.days), display: plural(r.days, 'day', 'days'),
              }))} />
            </ChartCard>
          </div>
          <p className="text-[11.5px] text-text-secondary mt-6">
            A work day is a weekday when at least a fifth of the team clocked in. Late means more than 5 minutes after the start of the person&apos;s shift. Days run from 05:00 to 05:00.
          </p>
        </>
      )}
    </Loadable>
  )
}
