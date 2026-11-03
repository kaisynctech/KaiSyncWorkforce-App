'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useExporter, useInsights, useOrgFilters } from '@/components/insights/InsightsContext'
import { useDownloads } from '@/components/insights/useDownloads'
import { Loadable } from '@/components/insights/dash'
import { Card, DataTable, StatTile } from '@/components/insights/viz'
import { REPORTS, type ReportDef, type ReportOutput } from '@/components/insights/reports'
import { describeRange, todaySA } from '@/lib/insights/period'

export default function LibraryReportPage() {
  const params = useParams<{ key: string }>()
  const def = REPORTS.find(r => r.key === params?.key)
  if (!def) {
    return (
      <Card className="p-10 text-center">
        <p className="text-[14px] text-text-primary">That report does not exist.</p>
        <Link href="/dashboard/reports/library" className="text-[13px] text-primary hover:underline">Back to the report library</Link>
      </Card>
    )
  }
  return def.org ? <WithOrg def={def} /> : <Report def={def} />
}

function WithOrg({ def }: { def: ReportDef }) {
  useOrgFilters()
  return <Report def={def} />
}

function Report({ def }: { def: ReportDef }) {
  const { companyId, companyName, companyCode, filters, refreshKey, setOptions } = useInsights()
  const { csv, pdf } = useDownloads()
  const [out, setOut] = useState<ReportOutput | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const asAt = def.asAt ? `As at ${describeRange({ from: todaySA(), to: todaySA() })}` : undefined

  useEffect(() => {
    if (!companyId) return
    let alive = true
    setLoading(true)
    setError(null)
    def.load(createClient(), companyId, {
      from: filters.range.from, to: filters.range.to,
      branch: def.org ? filters.branch : '', department: def.org ? filters.department : '',
    }).then(o => {
      if (!alive) return
      setOut(o)
      if (o.options) setOptions(o.options)
    }).catch((e: unknown) => {
      if (!alive) return
      const msg = e instanceof Error ? e.message : ''
      setError(/NOT_ALLOWED|permission|not allowed/i.test(msg) ? 'You do not have access to these reports.' : 'The report could not be loaded. Try again.')
    }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [def, companyId, filters.range.from, filters.range.to, filters.branch, filters.department, refreshKey, setOptions])

  useExporter(out ? {
    csv: () => csv(def.title, out.tables, { asAt }),
    pdf: def.pdfLayout === 'salary-schedule' ? async () => {
      const [{ buildSalarySchedulePdf, salaryScheduleTitle }, { companyLetterhead }] = await Promise.all([
        import('@/lib/insights/salary-schedule-pdf'),
        import('@/lib/letterhead'),
      ])
      const lh = companyId ? await companyLetterhead(createClient(), companyId, companyName, companyCode) : null
      const title = salaryScheduleTitle(filters.range)
      const scope = [filters.branch, filters.department].filter(Boolean).join(' · ')
      buildSalarySchedulePdf({
        companyName: lh?.name || companyName,
        logo: lh?.logo ?? null,
        title,
        subtitle: scope || undefined,
        table: out.tables[0],
      }).save(`${title.replace(/[^\w]+/g, '_')}.pdf`)
    } : () => pdf(def.title, [
      ...(out.kpis?.length ? [{ kind: 'kpis' as const, items: out.kpis }] : []),
      ...out.tables.map(t => ({ kind: 'table' as const, table: t })),
    ], { compare: false, asAt }),
  } : null, [out, def, csv, pdf, asAt, filters.range, filters.branch, filters.department, companyName, companyCode, companyId])

  return (
    <div>
      <Link href="/dashboard/reports/library" className="inline-flex items-center gap-1 text-[12.5px] text-text-secondary hover:text-text-primary no-underline">
        <span className="material-icons text-[16px]">arrow_back</span> Report library
      </Link>
      <div className="flex items-start gap-3 mt-2 mb-4">
        <span className="w-10 h-10 rounded-xl bg-[#1E3A5F]/[0.07] flex items-center justify-center shrink-0">
          <span className="material-icons text-[20px] text-[#1E3A5F]">{def.icon}</span>
        </span>
        <div>
          <h2 className="text-[18px] font-semibold text-text-primary leading-tight">{def.title}</h2>
          <p className="text-[12.5px] text-text-secondary mt-0.5">{def.description}{asAt ? ` ${asAt}.` : ''}</p>
        </div>
      </div>
      <Loadable loading={loading} error={error} hasData={!!out}>
        {out && (
          <>
            {out.kpis && out.kpis.length > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                {out.kpis.map(k => <StatTile key={k.label} label={k.label} value={k.value} hint={k.sub} />)}
              </div>
            )}
            <div className="space-y-6">
              {out.tables.map(t => (
                <Card key={t.title} className="p-4 sm:p-5">
                  {out.tables.length > 1 && <h3 className="text-[14px] font-semibold text-text-primary mb-3">{t.title}</h3>}
                  <DataTable table={t} searchable={t.rows.length > 12} pageSize={50} />
                </Card>
              ))}
            </div>
          </>
        )}
      </Loadable>
    </div>
  )
}
