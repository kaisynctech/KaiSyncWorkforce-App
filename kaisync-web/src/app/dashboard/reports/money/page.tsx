'use client'

import { useMemo } from 'react'
import { useExporter, useInsights, useInsightsRpc } from '@/components/insights/InsightsContext'
import { useDownloads } from '@/components/insights/useDownloads'
import { d, kpiTable, Loadable, n, pointTitle, SectionTitle } from '@/components/insights/dash'
import { AttentionRow, ChartCard, ColumnChart, MUTED_FILL, RAMP, RankedBars, SegmentedBar, SERIES, STATUS, StatTile, TrendChart } from '@/components/insights/viz'
import { count, dec1, money, moneyShort, pct, signedPct, vsPrevious, words } from '@/lib/insights/format'
import { describeRange, grainFor, pointLabel, previousRange, todaySA } from '@/lib/insights/period'
import type { TableSpec } from '@/lib/insights/table'
import type { Debtor, MoneyResult } from '@/lib/insights/types'

const QUOTE_COLOURS: Record<string, string> = {
  accepted: STATUS.good, declined: STATUS.critical, expired: STATUS.serious,
  sent: SERIES[0], viewed: SERIES[2], draft: MUTED_FILL,
}
const AGE_COLOURS = [RAMP[1], RAMP[2], RAMP[3], RAMP[5], RAMP[6]]

export default function MoneyInsightsPage() {
  const { filters } = useInsights()
  const { data, loading, error } = useInsightsRpc<MoneyResult>('insights_money')
  const { csv, pdf } = useDownloads()
  const compare = describeRange(previousRange(filters.range))
  const grain = grainFor(filters.range) === 'month' ? 'month' : 'week'
  const k = data?.kpis
  const p = data?.previous
  const asAt = `Debtors as at ${describeRange({ from: todaySA(), to: todaySA() })}`

  const trend = useMemo(() => {
    if (!data) return []
    return grain === 'week'
      ? (data.weekly ?? []).map(r => ({ x: r.week, invoiced: n(r.invoiced), collected: n(r.collected), won: n(r.won) }))
      : data.monthly.map(r => ({ x: r.month, invoiced: n(r.invoiced), collected: n(r.collected), won: n(r.won) }))
  }, [data, grain])

  const tables = useMemo(() => {
    if (!data || !k || !p) return null
    const summary = kpiTable('Headline figures', [
      { measure: 'Invoiced', now: money(k.invoiced), before: money(p.invoiced), change: signedPct(d(k, p, 'invoiced')) },
      { measure: 'Collected', now: money(k.collected), before: money(p.collected), change: signedPct(d(k, p, 'collected')) },
      { measure: 'Invoices issued', now: count(k.invoices), before: count(p.invoices), change: signedPct(d(k, p, 'invoices')) },
      { measure: 'Average days to pay', now: dec1(k.avg_days_to_pay), before: dec1(p.avg_days_to_pay), change: signedPct(d(k, p, 'avg_days_to_pay')) },
      { measure: 'Quotes sent', now: `${count(k.quotes_sent)} (${moneyShort(k.quotes_sent_value)})`, before: `${count(p.quotes_sent)} (${moneyShort(p.quotes_sent_value)})`, change: signedPct(d(k, p, 'quotes_sent_value')) },
      { measure: 'Quotes won', now: `${count(k.quotes_won)} (${moneyShort(k.quotes_won_value)})`, before: `${count(p.quotes_won)} (${moneyShort(p.quotes_won_value)})`, change: signedPct(d(k, p, 'quotes_won_value')) },
      { measure: 'Quote win rate', now: pct(k.win_rate), before: pct(p.win_rate), change: signedPct(d(k, p, 'win_rate')) },
    ])
    const trendT: TableSpec<(typeof trend)[number]> = {
      title: grain === 'week' ? 'Each week' : 'Each month',
      columns: [
        { key: 'x', label: grain === 'week' ? 'Week of' : 'Month', kind: 'day' },
        { key: 'invoiced', label: 'Invoiced', kind: 'money' },
        { key: 'collected', label: 'Collected', kind: 'money' },
        { key: 'won', label: 'Quotes won', kind: 'money' },
      ],
      rows: trend,
      totals: { invoiced: trend.reduce((a, r) => a + r.invoiced, 0), collected: trend.reduce((a, r) => a + r.collected, 0), won: trend.reduce((a, r) => a + r.won, 0) },
    }
    const ageing: TableSpec<{ name: string; amount: number }> = {
      title: 'Money owed, by age',
      columns: [{ key: 'name', label: 'Age', width: 2 }, { key: 'amount', label: 'Amount', kind: 'money' }],
      rows: data.ageing.buckets,
      totals: { amount: data.ageing.outstanding },
      note: asAt,
    }
    const debtors: TableSpec<Debtor> = {
      title: 'Debtors',
      columns: [
        { key: 'name', label: 'Client', width: 2.2 },
        { key: 'current', label: 'Not yet due', kind: 'money', width: 1.2 },
        { key: 'd30', label: '1–30', kind: 'money', width: 1.1 },
        { key: 'd60', label: '31–60', kind: 'money', width: 1.1 },
        { key: 'd90', label: '61–90', kind: 'money', width: 1.1 },
        { key: 'd90plus', label: '90+', kind: 'money', width: 1.1 },
        { key: 'total', label: 'Total', kind: 'money', width: 1.2 },
        { key: 'oldest_days', label: 'Oldest (days)', kind: 'count', width: 0.8 },
      ],
      rows: data.ageing.debtors,
      totals: {
        current: sum(data.ageing.debtors, 'current'), d30: sum(data.ageing.debtors, 'd30'), d60: sum(data.ageing.debtors, 'd60'),
        d90: sum(data.ageing.debtors, 'd90'), d90plus: sum(data.ageing.debtors, 'd90plus'), total: sum(data.ageing.debtors, 'total'),
      },
      note: asAt,
    }
    const clients: TableSpec<MoneyResult['by_client'][number]> = {
      title: 'Sales by client',
      columns: [
        { key: 'name', label: 'Client', width: 2.2 },
        { key: 'invoices', label: 'Invoices', kind: 'count' },
        { key: 'invoiced', label: 'Invoiced', kind: 'money', width: 1.3 },
        { key: 'paid', label: 'Paid so far', kind: 'money', width: 1.3 },
      ],
      rows: data.by_client,
      totals: { invoices: sum(data.by_client, 'invoices'), invoiced: sum(data.by_client, 'invoiced'), paid: sum(data.by_client, 'paid') },
    }
    const quotes: TableSpec<MoneyResult['quote_status'][number]> = {
      title: 'Quotes made in the period, by where they are now',
      columns: [{ key: 'name', label: 'Status', kind: 'words', width: 2 }, { key: 'count', label: 'Quotes', kind: 'count' }, { key: 'value', label: 'Value', kind: 'money' }],
      rows: data.quote_status,
    }
    const lost: TableSpec<MoneyResult['lost_reasons'][number]> = {
      title: 'Why quotes were lost',
      columns: [{ key: 'name', label: 'Reason', width: 3 }, { key: 'count', label: 'Quotes', kind: 'count' }],
      rows: data.lost_reasons,
    }
    return { summary, trendT, ageing, debtors, clients, quotes, lost }
  }, [data, k, p, trend, grain, asAt])

  useExporter(tables ? {
    csv: () => csv('Sales and money', [tables.summary, tables.trendT, tables.ageing, tables.debtors, tables.clients, tables.quotes, tables.lost]),
    pdf: () => pdf('Sales and money', [
      { kind: 'kpis', items: [
        { label: 'Invoiced', value: moneyShort(k?.invoiced), sub: vsPrevious(d(k, p, 'invoiced')) },
        { label: 'Collected', value: moneyShort(k?.collected), sub: vsPrevious(d(k, p, 'collected')) },
        { label: 'Owed to you now', value: moneyShort(data?.ageing.outstanding), sub: `${moneyShort(data?.ageing.overdue)} overdue` },
        { label: 'Quote win rate', value: pct(k?.win_rate), sub: `${count(k?.quotes_won)} won · ${count(k?.quotes_lost)} lost` },
      ] },
      { kind: 'columns', title: grain === 'week' ? 'Invoiced and collected each week' : 'Invoiced and collected each month',
        labels: trend.map(r => pointLabel(r.x, grain)),
        series: [
          { name: 'Invoiced', color: SERIES[0], values: trend.map(r => r.invoiced) },
          { name: 'Collected', color: SERIES[1], values: trend.map(r => r.collected) },
        ], format: v => moneyShort(v) },
      { kind: 'table', table: tables.summary },
      { kind: 'table', table: tables.ageing },
      { kind: 'table', table: tables.debtors },
      { kind: 'table', table: tables.clients },
      { kind: 'table', table: tables.quotes },
      { kind: 'table', table: tables.lost },
      { kind: 'note', text: 'Customer invoices only; rent and guest stays have their own screens. Collected means payments recorded against invoices in the period.' },
    ], { asAt }),
  } : null, [tables, csv, pdf])

  const quoteParts = (data?.quote_status ?? []).map(q => ({
    label: words(q.name), value: n(q.count), color: QUOTE_COLOURS[q.name] ?? MUTED_FILL, display: `${count(q.count)} · ${moneyShort(q.value)}`,
    dark: q.name === 'draft',
  }))

  return (
    <Loadable loading={loading} error={error} hasData={!!data}>
      {data && k && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile hero className="col-span-2 lg:col-span-1" label="Invoiced" icon="receipt_long" value={moneyShort(k.invoiced)} delta={d(k, p, 'invoiced')} compare={compare}
              spark={trend.map(r => r.invoiced)} />
            <StatTile label="Collected" icon="savings" value={moneyShort(k.collected)} delta={d(k, p, 'collected')} compare={compare}
              hint={`${count(k.invoices)} invoices issued`} />
            <StatTile label="Owed to you now" icon="account_balance" value={moneyShort(data.ageing.outstanding)}
              hint={`${moneyShort(data.ageing.overdue)} of it overdue`} href="/dashboard/finance/invoices" />
            <StatTile label="Average days to pay" icon="update" value={dec1(k.avg_days_to_pay)}
              delta={d(k, p, 'avg_days_to_pay')} goodWhenUp={false} compare={compare} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
            <StatTile label="Quotes sent" icon="send" value={moneyShort(k.quotes_sent_value)} delta={d(k, p, 'quotes_sent_value')} compare={compare}
              hint={`${count(k.quotes_sent)} quotes`} />
            <StatTile label="Quotes won" icon="handshake" value={moneyShort(k.quotes_won_value)} delta={d(k, p, 'quotes_won_value')} compare={compare} />
            <StatTile label="Win rate" icon="emoji_events" value={pct(k.win_rate)} delta={d(k, p, 'win_rate')} compare={compare}
              hint={`${count(k.quotes_won)} won · ${count(k.quotes_lost)} lost`} />
            <StatTile label="Open quotes" icon="pending_actions" value={moneyShort(data.pipeline_now)} hint="Sent, still valid, not yet answered" />
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mt-4">
            <ChartCard
              className="lg:col-span-2"
              title={grain === 'week' ? 'Invoiced and collected each week' : 'Invoiced and collected each month'}
              legend={[{ label: 'Invoiced', color: SERIES[0] }, { label: 'Collected', color: SERIES[1] }]}
              table={tables?.trendT}
            >
              <TrendChart
                data={trend}
                xKey="x"
                series={[
                  { key: 'invoiced', name: 'Invoiced', color: SERIES[0], kind: 'bar' },
                  { key: 'collected', name: 'Collected', color: SERIES[1], kind: 'bar' },
                ]}
                yFormat={v => moneyShort(v)}
                xFormat={x => pointLabel(x, grain)}
                tipTitle={x => pointTitle(x, grain)}
                height={260}
              />
            </ChartCard>
            <ChartCard title="Money owed, by age" subtitle={asAt} table={tables?.ageing}>
              <ColumnChart
                data={data.ageing.buckets.map(b => ({ name: b.name.replace(' days', ''), amount: n(b.amount) }))}
                xKey="name"
                series={[{ key: 'amount', name: 'Owed', color: RAMP[4] }]}
                colors={AGE_COLOURS}
                yFormat={v => moneyShort(v)}
                height={230}
              />
              <div className="mt-2">
                <AttentionRow icon="warning_amber" tone="serious" label="Overdue" value={moneyShort(data.ageing.overdue)} href="/dashboard/finance/invoices" />
              </div>
            </ChartCard>
          </div>

          <SectionTitle sub="Who was invoiced, and who still owes">Clients</SectionTitle>
          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="Sales by client" subtitle="Invoiced in the period" table={tables?.clients}>
              <RankedBars items={data.by_client.map(c => ({
                label: c.name, value: n(c.invoiced), display: moneyShort(c.invoiced), sub: `${moneyShort(c.paid)} paid`,
              }))} />
            </ChartCard>
            <ChartCard title="Biggest debtors" subtitle={asAt} table={tables?.debtors}>
              <RankedBars color={RAMP[5]} emptyText="Nobody owes you money" items={data.ageing.debtors.map(c => ({
                label: c.name, value: n(c.total), display: moneyShort(c.total),
                sub: `${moneyShort(n(c.total) - n(c.current))} overdue`,
                href: c.client_id ? `/dashboard/clients/${c.client_id}` : undefined,
              }))} />
            </ChartCard>
          </div>

          <SectionTitle sub="How quotes turn into work">Quotes</SectionTitle>
          <div className="grid lg:grid-cols-3 gap-4">
            <ChartCard className="lg:col-span-2" title="Quotes made in the period" subtitle="Where each one stands now" table={tables?.quotes}>
              <SegmentedBar parts={quoteParts} />
            </ChartCard>
            <ChartCard title="Why quotes were lost" table={tables?.lost}>
              <RankedBars color={SERIES[1]} emptyText="No quotes lost" items={data.lost_reasons.map(r => ({
                label: r.name, value: n(r.count), display: count(r.count),
              }))} />
            </ChartCard>
          </div>
          <p className="text-[11.5px] text-text-secondary mt-6">
            Customer invoices only; rent and guest stays have their own screens. Collected means payments recorded against invoices in the period.
          </p>
        </>
      )}
    </Loadable>
  )
}

function sum<T>(rows: T[], key: keyof T): number {
  return Math.round(rows.reduce((a, r) => a + n(r[key]), 0) * 100) / 100
}
