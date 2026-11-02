'use client'

import { useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { describeRange, previousRange } from '@/lib/insights/period'
import { downloadCsv, fileSlug, tablesToCsv, type TableSpec } from '@/lib/insights/table'
import type { PdfSection } from '@/lib/insights/pdf'
import { useInsights } from './InsightsContext'

/** CSV and branded-PDF downloads that carry the company, period and filters. */
export function useDownloads() {
  const { companyId, companyName, companyCode, filters, orgFilters } = useInsights()

  const context = useCallback((opts?: { compare?: boolean; asAt?: string }) => {
    const lines: string[] = []
    if (opts?.compare !== false) lines.push(`Compared with ${describeRange(previousRange(filters.range))}`)
    if (orgFilters) {
      lines.push(`Site: ${filters.branch || 'All sites'}  ·  Department: ${filters.department || 'All departments'}`)
    }
    if (opts?.asAt) lines.push(opts.asAt)
    return lines
  }, [filters, orgFilters])

  const csv = useCallback((title: string, tables: TableSpec<any>[], opts?: { asAt?: string }) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const header = [
      `${companyName || 'Company'} — ${title}`,
      `Period: ${describeRange(filters.range)} (${filters.range.from} to ${filters.range.to})`,
      ...context({ compare: false, asAt: opts?.asAt }),
    ]
    downloadCsv(tablesToCsv(tables, header), `${fileSlug(title)}_${filters.range.from}_${filters.range.to}.csv`)
  }, [companyName, filters, context])

  const pdf = useCallback(async (title: string, sections: PdfSection[], opts?: { compare?: boolean; asAt?: string }) => {
    if (!companyId) return
    const [{ companyLetterhead }, { downloadInsightsPdf }] = await Promise.all([
      import('@/lib/letterhead'),
      import('@/lib/insights/pdf'),
    ])
    const letterhead = await companyLetterhead(createClient(), companyId, companyName, companyCode)
    downloadInsightsPdf({
      letterhead,
      title,
      period: describeRange(filters.range),
      context: context(opts),
      sections,
      fileName: `${fileSlug(title)}_${filters.range.from}_${filters.range.to}.pdf`,
    })
  }, [companyId, companyName, companyCode, filters, context])

  return { csv, pdf }
}
