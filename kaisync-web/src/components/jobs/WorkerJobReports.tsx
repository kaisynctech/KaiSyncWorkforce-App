'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { enqueueJobCard } from '@/lib/offline/job-queue'
import { networkLooksDown } from '@/lib/offline/meta'
import { ReportForm, ReportView, inputFromReport } from '@/components/jobs/ReportParts'
import { workerListReports, workerSaveReport, type JobReport, type ReportInput } from '@/lib/job-reports'

type Props = { companyId: string; employeeId: string; jobId: string; sessionToken: string | null; onJobFinished?: () => void }

/**
 * Technician: every report on this job (theirs and their team's), a new report per visit, and edit their own.
 * Without signal the report is kept on the phone and sent as a job card when back online
 * (the database turns that job card into a report).
 */
export function WorkerJobReports({ companyId, employeeId, jobId, sessionToken, onJobFinished }: Props) {
  const [reports, setReports] = useState<JobReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<JobReport | 'new' | null>(null)

  const load = useCallback(async () => {
    const res = await workerListReports(createClient(), companyId, employeeId, jobId, sessionToken)
    if (!res.ok) {
      setError(networkLooksDown(res.message) ? 'No signal: reports will show when you are back online.' : res.message)
      setReports(prev => prev ?? [])
      return
    }
    setError(null)
    setReports(res.data)
    setEditing(prev => prev ?? (res.data.length === 0 ? 'new' : null))
  }, [companyId, employeeId, jobId, sessionToken])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void load() })
    return () => { cancelled = true }
  }, [load])

  async function saveOffline(value: ReportInput) {
    await enqueueJobCard({
      companyId, employeeId, jobId,
      payload: {
        work_performed: value.workPerformed, materials_used: value.materialsUsed || null,
        start_time: value.startTime, end_time: value.endTime, is_completed: value.marksJobComplete,
        photo_urls: [], client_signature_url: null,
      },
    })
    setEditing(null)
    setNotice('No signal: the report is saved on this phone and will be sent when you are back online.')
  }

  async function save(value: ReportInput) {
    setBusy(true); setError(null); setNotice(null)
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) { await saveOffline(value); return }
      const res = await workerSaveReport(createClient(), companyId, employeeId, jobId, value, sessionToken,
        editing && editing !== 'new' ? editing.id : undefined)
      if (!res.ok) {
        if (networkLooksDown(res.message)) { await saveOffline(value); return }
        setError(res.message); return
      }
      setEditing(null)
      setNotice('Report saved. The office can see it now.')
      await load()
      if (value.marksJobComplete) onJobFinished?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the report.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-surface border border-divider rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
        <p className="section-label">Work reports</p>
        {editing === null && (
          <button type="button" onClick={() => { setNotice(null); setEditing('new') }}
            className="bg-primary text-white font-semibold text-[12px] px-3 h-8 rounded-lg">
            New report
          </button>
        )}
      </div>
      <div className="px-4 py-2">
        <p className="text-[12px] text-text-secondary py-1">
          Write a report for each visit: what you did, what you found and what is still outstanding. The office (and the client) can read it.
        </p>
        {error && <p className="text-[12px] text-error py-1" role="alert">{error}</p>}
        {notice && !error && <p className="text-[12px] text-success py-1" aria-live="polite">{notice}</p>}
        {editing !== null && (
          <div className="py-2">
            <ReportForm busy={busy} onSave={v => void save(v)}
              initial={editing === 'new' ? undefined : inputFromReport(editing)}
              saveLabel={editing === 'new' ? 'Submit report' : 'Save changes'}
              onCancel={reports && reports.length > 0 ? () => setEditing(null) : undefined} />
          </div>
        )}
        {reports === null ? (
          <p className="text-[13px] text-text-secondary py-2">Loading…</p>
        ) : (
          <div className="divide-y divide-divider">
            {reports.map(r => (
              <ReportView key={r.id} report={r} actions={r.mine && editing === null ? (
                <button type="button" className="text-primary" onClick={() => { setNotice(null); setEditing(r) }}>Edit</button>
              ) : undefined} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
