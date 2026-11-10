'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { manualTimesheetIsOvernight } from '@/lib/manual-timesheet'
import { submitHrCorrectAttendance } from '@/lib/hr-correct-attendance'

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
}

type Props = {
  companyId: string
  employees: CorrectAttendanceEmployee[]
  prefill?: CorrectAttendancePrefill | null
  onSaved: (workDate: string) => void
}

export function CorrectAttendanceForm({
  companyId,
  employees,
  prefill,
  onSaved,
}: Props) {
  const [pickedId, setPickedId] = useState(prefill?.employeeId ?? '')
  const [workDate, setWorkDate] = useState(prefill?.workDate ?? '')
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
    setSaved(
      `Corrected ${workDate}, ${timeIn} to ${timeOut}${result.overnight ? ' the next day' : ''}.`,
    )
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
          Owner, HR, or a manager in scope can replace a day&apos;s punches with the correct times
          (forgotten clock-in/out, or marked absent then arrived). Requires a reason and is audited.
        </p>
      </div>
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
        <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
          Time in
          <input
            type="time"
            value={timeIn}
            onChange={e => setTimeIn(e.target.value)}
            className="h-9 px-2 border border-border rounded text-[13px] bg-background text-text-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
          Time out
          <input
            type="time"
            value={timeOut}
            onChange={e => setTimeOut(e.target.value)}
            className="h-9 px-2 border border-border rounded text-[13px] bg-background text-text-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-text-secondary flex-1 min-w-[180px]">
          Reason
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Required — e.g. forgot to clock out"
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
      {manualTimesheetIsOvernight(timeIn, timeOut) && (
        <p className="text-[12px] text-text-secondary">Ends the next day ({timeIn} to {timeOut}).</p>
      )}
      {error && <p className="text-[12px] text-error">{error}</p>}
      {saved && <p className="text-[12px] text-text-primary">{saved}</p>}
    </form>
  )
}
