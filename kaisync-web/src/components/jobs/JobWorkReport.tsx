'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type CardRow = {
  id: string
  employee_id: string | null
  start_time: string | null
  end_time: string | null
  work_performed: string | null
  materials_used: string | null
  is_completed: boolean | null
  updated_at: string | null
  employee: { name: string | null; surname: string | null; employee_number: string | null } | null
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg',
  })
}

function duration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  if (!Number.isFinite(mins) || mins <= 0) return null
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ')
}

/**
 * The technician's job card on the office job page: what they did (Work performed),
 * materials used, actual start/end and whether they marked it complete.
 */
export function JobWorkReport({ companyId, jobId }: { companyId: string; jobId: string }) {
  const [cards, setCards] = useState<CardRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: e } = await createClient()
      .from('job_cards')
      .select('id, employee_id, start_time, end_time, work_performed, materials_used, is_completed, updated_at, employee:employee_id(name, surname, employee_number)')
      .eq('company_id', companyId)
      .eq('job_id', jobId)
      .order('updated_at', { ascending: false })
    if (e) { setError(e.message); setCards([]); return }
    setCards((data ?? []) as unknown as CardRow[])
  }, [companyId, jobId])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void load() })
    return () => { cancelled = true }
  }, [load])

  if (cards === null) return null

  return (
    <div className="bg-surface rounded-xl p-4 border border-divider space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase">Work report</p>
        <button type="button" onClick={() => void load()} className="text-primary text-[12px] hover:underline">Refresh</button>
      </div>
      {error && <p className="text-[12px] text-error" role="alert">{error}</p>}
      {cards.length === 0 && !error && (
        <p className="text-[13px] text-text-secondary">The technician has not filled in the job card yet.</p>
      )}
      {cards.map(c => {
        const who = c.employee ? `${c.employee.name ?? ''} ${c.employee.surname ?? ''}`.trim() : 'Technician'
        const took = duration(c.start_time, c.end_time)
        return (
          <div key={c.id} className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-secondary">
              <span className="text-text-primary font-medium">{who}{c.employee?.employee_number ? ` · ${c.employee.employee_number}` : ''}</span>
              {c.is_completed
                ? <span className="text-success font-semibold">Marked complete</span>
                : <span>In progress</span>}
              <span>Last saved {fmt(c.updated_at)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Actual start</p>
                <p className="text-[13px] text-text-primary mt-0.5">{fmt(c.start_time)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Actual end</p>
                <p className="text-[13px] text-text-primary mt-0.5">{fmt(c.end_time)}{took ? ` (${took})` : ''}</p>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Work performed</p>
              <p className="text-[13px] text-text-primary mt-0.5 whitespace-pre-wrap">{c.work_performed?.trim() || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Materials used</p>
              <p className="text-[13px] text-text-primary mt-0.5 whitespace-pre-wrap">{c.materials_used?.trim() || '—'}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
