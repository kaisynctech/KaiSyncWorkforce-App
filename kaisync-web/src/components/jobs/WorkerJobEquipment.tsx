'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  STATUS_LABEL,
  equipmentName,
  workerJobEquipment,
  workerJobWhere,
  workerSetEquipment,
  type JobEquipmentStatus,
  type WorkerEquipmentRow,
  type WorkerJobWhere,
} from '@/lib/job-equipment'

type Props = { companyId: string; employeeId: string; jobId: string; sessionToken: string | null }

const STATUSES: JobEquipmentStatus[] = ['done', 'not_done', 'pending']

/**
 * Technician job card: where the job is (area, service) and the units to service, each marked
 * Done or Not done with a note. Needs a connection; the rest of the job card works offline.
 */
export function WorkerJobEquipment({ companyId, employeeId, jobId, sessionToken }: Props) {
  const [rows, setRows] = useState<WorkerEquipmentRow[]>([])
  const [where, setWhere] = useState<WorkerJobWhere | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const supabase = createClient()
    const [eq, w] = await Promise.all([
      workerJobEquipment(supabase, companyId, employeeId, jobId, sessionToken),
      workerJobWhere(supabase, companyId, employeeId, jobId, sessionToken),
    ])
    setLoaded(true)
    if (!eq.ok) { setError(eq.message); return }
    setError(null)
    setRows(eq.data)
    setNotes(Object.fromEntries(eq.data.map(r => [r.id, r.notes ?? ''])))
    if (w.ok) setWhere(w.data)
  }, [companyId, employeeId, jobId, sessionToken])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void load() })
    return () => { cancelled = true }
  }, [load])

  async function mark(row: WorkerEquipmentRow, status: JobEquipmentStatus) {
    setBusy(row.id)
    const note = notes[row.id] ?? ''
    const res = await workerSetEquipment(createClient(), companyId, employeeId, row.id, status, note, sessionToken)
    setBusy(null)
    if (!res.ok) { setError(res.message); return }
    setError(null)
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, status, notes: note || r.notes, done_at: status === 'pending' ? null : new Date().toISOString() } : r))
  }

  if (!loaded) return null
  const hasWhere = !!(where?.area_path || where?.service_name)
  if (!hasWhere && rows.length === 0 && !error) return null

  const done = rows.filter(r => r.status === 'done').length

  return (
    <div className="bg-surface border border-divider rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
        <p className="section-label">Service &amp; equipment</p>
        {rows.length > 0 && <span className="text-[12px] text-text-secondary">{done} of {rows.length} done</span>}
      </div>
      {hasWhere && (
        <div className="px-4 py-3 grid grid-cols-2 gap-3 border-b border-divider">
          <div>
            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Area</p>
            <p className="text-[13px] text-text-primary mt-0.5">{where?.area_path || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Service</p>
            <p className="text-[13px] text-text-primary mt-0.5">{where?.service_name || '—'}</p>
          </div>
          {where?.service_description && (
            <p className="col-span-2 text-[12px] text-text-secondary whitespace-pre-wrap">{where.service_description}</p>
          )}
        </div>
      )}
      <div className="divide-y divide-divider">
        {rows.map(r => (
          <div key={r.id} className="px-4 py-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={`text-[13px] ${r.status === 'done' ? 'text-text-secondary' : 'text-text-primary'}`}>{equipmentName(r)}</p>
                {r.area_name && <p className="text-[11px] text-text-secondary">{r.area_name}</p>}
              </div>
              <span className={`text-[11px] font-semibold shrink-0 ${r.status === 'done' ? 'text-success' : r.status === 'not_done' ? 'text-error' : 'text-text-secondary'}`}>
                {STATUS_LABEL[r.status]}
              </span>
            </div>
            <input className="input w-full text-[13px]" type="text" placeholder="Note (optional), e.g. gas low, filter replaced"
              aria-label={`Note for ${equipmentName(r)}`} maxLength={2000}
              value={notes[r.id] ?? ''} onChange={e => setNotes(prev => ({ ...prev, [r.id]: e.target.value }))} />
            <div className="flex gap-2">
              {STATUSES.filter(s => s !== r.status).map(s => (
                <button key={s} type="button" disabled={busy === r.id} onClick={() => void mark(r, s)}
                  className={`h-9 px-3 rounded-lg text-[12px] font-semibold disabled:opacity-50 ${s === 'done' ? 'bg-primary text-white' : 'border border-divider text-text-primary'}`}>
                  {s === 'done' ? 'Mark done' : s === 'not_done' ? 'Could not do' : 'Undo'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="px-4 py-2 text-[12px] text-error" role="alert">{error === 'Failed to fetch' ? 'Equipment needs a connection. Try again when online.' : error}</p>}
    </div>
  )
}
