'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface Incident {
  id: string
  title: string
  severity: string | null
  status: string | null
  incident_date: string | null
  location: string | null
  description: string | null
  created_at: string
}

const SEVERITY_STYLES: Record<string, string> = {
  low:      'bg-surface-elevated text-text-secondary border border-divider',
  medium:   'bg-warning/10 text-warning',
  high:     'bg-error/10 text-error',
  critical: 'bg-error text-white',
}
const STATUS_STYLES: Record<string, string> = {
  open:       'bg-primary/10 text-primary',
  under_review:'bg-warning/10 text-warning',
  resolved:   'bg-success/10 text-success',
  closed:     'bg-surface-elevated text-text-secondary',
}

export default function EmployeeIncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('employee_get_own_incidents', {
      p_employee_id: member.employeeId,
      p_company_id:  member.companyId,
    })
    setIncidents((data as Incident[]) ?? [])
    setLoading(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">My Incidents</h1>
        <Link href="/dashboard/employee/incidents/new"
          className="flex items-center gap-1.5 bg-primary text-white text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors">
          <span className="material-icons text-[16px]">add</span>Report
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        {incidents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-secondary">
            <span className="material-icons text-[48px] text-text-disabled">report_off</span>
            <p className="text-[14px]">No incidents reported</p>
          </div>
        ) : (
          <div className="divide-y divide-divider">
            {incidents.map(inc => (
              <Link key={inc.id} href={`/dashboard/employee/incidents/${inc.id}`}
                className="flex items-start gap-3 px-4 py-4 hover:bg-surface-elevated transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[14px] font-semibold text-text-primary truncate">{inc.title}</p>
                    {inc.severity && (
                      <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${SEVERITY_STYLES[inc.severity] ?? 'bg-surface-elevated text-text-secondary'}`}>
                        {inc.severity}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {inc.status && (
                      <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${STATUS_STYLES[inc.status] ?? 'bg-surface-elevated text-text-secondary'}`}>
                        {inc.status.replace(/_/g, ' ')}
                      </span>
                    )}
                    {inc.incident_date && (
                      <span className="text-[12px] text-text-disabled">
                        {new Date(inc.incident_date).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                    {inc.location && (
                      <span className="text-[12px] text-text-disabled truncate">{inc.location}</span>
                    )}
                  </div>
                  {inc.description && (
                    <p className="text-[12px] text-text-secondary mt-1 line-clamp-2">{inc.description}</p>
                  )}
                </div>
                <span className="material-icons text-text-disabled text-[20px] shrink-0 mt-1">chevron_right</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
