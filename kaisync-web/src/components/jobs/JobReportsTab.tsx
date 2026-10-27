'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SearchPicker } from '@/components/SearchPicker'
import { ReportForm, ReportView, inputFromReport } from '@/components/jobs/ReportParts'
import {
  listJobReports, removeReport, saveOfficeReport, setReportVisibleToClient, type JobReport,
} from '@/lib/job-reports'

type Person = { id: string; name: string; surname?: string | null }

/** Office view of a job's work reports: every technician's reports, add/edit, and what the client may see. */
export function JobReportsTab({ companyId, jobId, people, canEdit, onChanged }: {
  companyId: string
  jobId: string
  people: Person[]
  canEdit: boolean
  /** Called after a report that finishes the job is saved, so the page can reload the status. */
  onChanged?: () => void
}) {
  const [reports, setReports] = useState<JobReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<JobReport | 'new' | null>(null)
  const [author, setAuthor] = useState('')

  const load = useCallback(async () => {
    const res = await listJobReports(createClient(), companyId, jobId)
    if (!res.ok) { setError(res.message); setReports([]); return }
    setError(null)
    setReports(res.data)
  }, [companyId, jobId])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void load() })
    return () => { cancelled = true }
  }, [load])

  const options = useMemo(() => people.map(p => ({ id: p.id, label: `${p.name} ${p.surname ?? ''}`.trim() })), [people])

  async function toggle(r: JobReport) {
    const res = await setReportVisibleToClient(createClient(), companyId, r.id, !(r.visible_to_client ?? true))
    if (!res.ok) { setError(res.message); return }
    setReports(prev => prev?.map(x => x.id === r.id ? { ...x, visible_to_client: !(r.visible_to_client ?? true) } : x) ?? null)
  }

  async function remove(r: JobReport) {
    if (!window.confirm(`Delete the report of ${r.report_date} by ${r.author ?? 'the office'}? This cannot be undone.`)) return
    const res = await removeReport(createClient(), companyId, r.id)
    if (!res.ok) { setError(res.message); return }
    await load()
  }

  const total = reports?.length ?? 0
  const shown = reports?.filter(r => r.visible_to_client !== false).length ?? 0

  return (
    <div className="bg-surface rounded-xl p-4 border border-divider space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase">Work reports</p>
          {total > 0 && <p className="text-[12px] text-text-secondary">{total} report{total === 1 ? '' : 's'} · {shown} shown to the client</p>}
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={() => void load()} className="text-primary text-[12px] hover:underline">Refresh</button>
          {canEdit && editing === null && (
            <button type="button" onClick={() => { setAuthor(''); setEditing('new') }} className="btn-primary h-8 px-3 text-[12px]">Add report</button>
          )}
        </div>
      </div>
      {error && <p className="text-[12px] text-error" role="alert">{error}</p>}

      {editing !== null && (
        <div className="rounded-lg border border-primary/40 p-3">
          <ReportForm
            busy={busy}
            initial={editing === 'new' ? undefined : inputFromReport(editing)}
            saveLabel={editing === 'new' ? 'Add report' : 'Save report'}
            onCancel={() => setEditing(null)}
            extra={
              <SearchPicker label="Technician (leave empty for an office note)" noun="employee" options={options}
                value={author} onChange={setAuthor} />
            }
            onSave={async value => {
              setBusy(true)
              const res = await saveOfficeReport(createClient(), companyId, jobId, { ...value, employeeId: author || null },
                editing === 'new' ? undefined : editing.id)
              setBusy(false)
              if (!res.ok) { setError(res.message); return }
              setEditing(null)
              await load()
              if (value.marksJobComplete) onChanged?.()
            }}
          />
        </div>
      )}

      {reports === null ? (
        <p className="text-[13px] text-text-secondary">Loading…</p>
      ) : reports.length === 0 ? (
        <p className="text-[13px] text-text-secondary">No reports yet. Technicians add them from the job on their phone.</p>
      ) : (
        <div className="divide-y divide-divider">
          {reports.map(r => (
            <ReportView key={r.id} report={r} actions={canEdit ? (
              <>
                <button type="button" className="text-text-secondary hover:text-text-primary" onClick={() => void toggle(r)}>
                  {r.visible_to_client === false ? 'Show to client' : 'Hide from client'}
                </button>
                <button type="button" className="text-primary" onClick={() => { setAuthor(r.employee_id ?? ''); setEditing(r) }}>Edit</button>
                <button type="button" className="text-error" onClick={() => void remove(r)}>Delete</button>
              </>
            ) : undefined} />
          ))}
        </div>
      )}
    </div>
  )
}
