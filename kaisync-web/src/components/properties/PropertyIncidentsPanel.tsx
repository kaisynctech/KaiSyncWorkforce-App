'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type IncidentRow = {
  id: string
  title: string | null
  description: string
  severity: string
  status: string
  is_closed: boolean | null
  occurred_at: string
}

type Props = {
  companyId: string
  siteId: string
  canReport: boolean
}

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

function isOpen(row: IncidentRow): boolean {
  if (row.is_closed === true) return false
  const status = row.status.toLowerCase()
  return status === 'open' || status === 'investigating'
}

export function PropertyIncidentsPanel({ companyId, siteId, canReport }: Props) {
  const [rows, setRows] = useState<IncidentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error: loadErr } = await supabase
      .from('incident_reports')
      .select('id, title, description, severity, status, is_closed, occurred_at')
      .eq('company_id', companyId)
      .eq('site_id', siteId)
      .order('occurred_at', { ascending: false })
      .limit(200)
    if (loadErr) {
      setError(loadErr.message)
      setRows([])
    } else {
      setRows((data ?? []) as IncidentRow[])
    }
    setLoading(false)
  }, [companyId, siteId])

  useEffect(() => { void load() }, [load])

  const openCount = rows.filter(isOpen).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-text-secondary">
          {loading ? 'Loading incidents…' : `${openCount} open · ${rows.length} listed`}
        </p>
        {canReport && (
          <Link
            href={`/dashboard/incidents/new?siteId=${siteId}`}
            className="btn-outlined h-9 px-3 text-[13px] inline-flex items-center"
          >
            Report incident
          </Link>
        )}
      </div>
      {error && <p className="text-[12px] text-error">{error}</p>}
      {!loading && rows.length === 0 && !error && (
        <p className="text-[13px] text-text-secondary">No incidents recorded for this property.</p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto border border-divider rounded-xl">
          <table className="w-full" style={{ minWidth: 560 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">When</th>
                <th className="data-th text-left">Incident</th>
                <th className="data-th text-left">Severity</th>
                <th className="data-th text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-b border-divider">
                  <td className="data-td text-[12px] whitespace-nowrap">{fmtDate(row.occurred_at)}</td>
                  <td className="data-td text-[13px]">
                    <Link href={`/dashboard/incidents/${row.id}`} className="text-primary hover:underline font-medium">
                      {row.title?.trim() || row.description.slice(0, 80)}
                    </Link>
                  </td>
                  <td className="data-td text-[12px] capitalize">{row.severity}</td>
                  <td className="data-td text-[12px] capitalize">{row.is_closed ? 'Closed' : row.status.replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
