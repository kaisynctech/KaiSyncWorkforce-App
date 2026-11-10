'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { manualTimesheetIsOvernight } from '@/lib/manual-timesheet'
import {
  submitHrCorrectAttendance,
  type HrCorrectMode,
} from '@/lib/hr-correct-attendance'

export type CorrectAttendanceEmployee = {
  id: string
  name: string
  surname: string
  employee_number?: string | null
}

export type CorrectAttendancePrefill = {
  employeeId?: string
  workDate?: string
  timeIn?: string
  timeOut?: string
  mode?: HrCorrectMode
}

type Props = {
  companyId: string
  employees: CorrectAttendanceEmployee[]
  prefill?: CorrectAttendancePrefill | null
  onSaved: (workDate: string) => void
}

const MODE_HELP: Record<HrCorrectMode, string> = {
  full_day: 'Set both times for a complete day (replaces that day’s punches).',
  in_only: 'Set or fix clock-in only. The employee clocks out themselves later.',
  out_only: 'Close an open shift when they forgot to clock out.',
}

export function CorrectAttendanceForm({
  companyId,
  employees,
  prefill,
  onSaved,
}: Props) {
  const [pickedId, setPickedId] = useState(prefill?.employeeId ?? '')
  const [workDate, setWorkDate] = useState(prefill?.workDate ?? '')
  const [mode, setMode] = useState<HrCorrectMode>(prefill?.mode ?? 'full_day')
  const [timeIn, setTimeIn] = useState(prefill?.timeIn ?? '')
  const [timeOut, setTimeOut] = useState(prefill?.timeOut ?? '')
  const [reason, setReason] = useState('')
  const [clearAbsence, setClearAbsence] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    if (!prefill) return
    if (prefill.employeeId) setPickedId(prefill.employeeId)
    if (prefill.workDate) setWorkDate(prefill.workDate)
    if (prefill.timeIn) setTimeIn(prefill.timeIn)
    if (prefill.timeOut) setTimeOut(prefill.timeOut)
    if (prefill.mode) setMode(prefill.mode)
    else if (prefill.timeIn && !prefill.timeOut) setMode('in_only')
    else if (!prefill.timeIn && prefill.timeOut) setMode('out_only')
  }, [prefill])

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(null)
    const supabase = createClient()
    const result = await submitHrCorrectAttendance(supabase, {
      companyId,
      employeeId: pickedId,
      workDate,
      mode,
      timeIn,
      timeOut,
      reason,
      clearAbsence,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    if (result.mode === 'in_only') {
      setSaved(`Clock-in set for ${workDate} at ${timeIn}. Employee can clock out themselves.`)
    } else if (result.mode === 'out_only') {
      setSaved(`Clock-out set for ${workDate} at ${timeOut}.`)
    } else {
      setSaved(
        `Corrected ${workDate}, ${timeIn} to ${timeOut}${result.overnight ? ' the next day' : ''}.`,
      )
    }
    setReason('')
    onSaved(workDate)
  }

  return (
    <form
      className="rounded-lg border border-divider bg-surface p-3 space-y-2"
      onSubmit={e => { e.preventDefault(); void save() }}
    >
      <div>
        <p className="text-[13px] font-semibold text-text-primary">Correct attendance</p>
        <p className="text-[12px] text-text-secondary">
          Owner, HR, or a manager in scope. Use clock-in only when they forgot the morning punch
          (or need the in time fixed) and will clock out themselves. Use clock-out only when they
          forgot to leave. Requires a reason and is audited.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 text-[12px] text-text-secondary">
        {(
          [
            ['full_day', 'Full day (in + out)'],
            ['in_only', 'Clock in only'],
            ['out_only', 'Clock out only'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="inline-flex items-center gap-1.5">
            <input
              type="radio"
              name="correct-mode"
              checked={mode === value}
              onChange={() => setMode(value)}
            />
            {label}
          </label>
        ))}
      </div>
      <p className="text-[11px] text-text-disabled">{MODE_HELP[mode]}</p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] text-text-secondary min-w-[180px]">
          Employee
          <select
            value={pickedId}
            onChange={e => setPickedId(e.target.value)}
            className="h-9 px-2 border border-border rounded text-[13px] bg-background text-text-primary"
          >
            <option value="">Select</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>
                {emp.name} {emp.surname}{emp.employee_number ? ` · ${emp.employee_number}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
          Date
          <input
            type="date"
            value={workDate}
            onChange={e => setWorkDate(e.target.value)}
            className="h-9 px-2 border border-border rounded text-[13px] bg-background text-text-primary"
          />
        </label>
        {mode !== 'out_only' && (
          <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
            Time in
            <input
              type="time"
              value={timeIn}
              onChange={e => setTimeIn(e.target.value)}
              className="h-9 px-2 border border-border rounded text-[13px] bg-background text-text-primary"
            />
          </label>
        )}
        {mode !== 'in_only' && (
          <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
            Time out
            <input
              type="time"
              value={timeOut}
              onChange={e => setTimeOut(e.target.value)}
              className="h-9 px-2 border border-border rounded text-[13px] bg-background text-text-primary"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-[11px] text-text-secondary flex-1 min-w-[180px]">
          Reason
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Required — e.g. forgot morning clock-in"
            className="h-9 px-2 border border-border rounded text-[13px] bg-background text-text-primary"
            required
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="h-9 px-3 rounded-lg bg-primary text-white text-[13px] font-medium disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save correction'}
        </button>
      </div>
      <label className="inline-flex items-center gap-2 text-[12px] text-text-secondary">
        <input
          type="checkbox"
          checked={clearAbsence}
          onChange={e => setClearAbsence(e.target.checked)}
          className="rounded border-border"
        />
        Clear absence for this date if one exists
      </label>
      {mode === 'full_day' && manualTimesheetIsOvernight(timeIn, timeOut) && (
        <p className="text-[12px] text-text-secondary">Ends the next day ({timeIn} to {timeOut}).</p>
      )}
      {error && <p className="text-[12px] text-error">{error}</p>}
      {saved && <p className="text-[12px] text-text-primary">{saved}</p>}
    </form>
  )
}
