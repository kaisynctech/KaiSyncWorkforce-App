'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { submitManualTimesheet } from '@/lib/manual-timesheet'

export type TimesheetEmployee = {
  id: string
  name: string
  surname: string
  employee_code?: string | null
}

type Props = {
  companyId: string
  employeeId?: string
  employees?: TimesheetEmployee[]
  sessionToken?: string | null
  onSaved: (workDate: string) => void
}

export function ManualTimesheetForm({
  companyId,
  employeeId,
  employees,
  sessionToken,
  onSaved,
}: Props) {
  const [pickedId, setPickedId] = useState(employeeId ?? '')
  const [workDate, setWorkDate] = useState('')
  const [timeIn, setTimeIn] = useState('')
  const [timeOut, setTimeOut] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const targetId = employees ? pickedId : (employeeId ?? '')

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(null)
    const supabase = createClient()
    const result = await submitManualTimesheet(supabase, {
      companyId,
      employeeId: targetId,
      workDate,
      timeIn,
      timeOut,
      notes,
      sessionToken,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setSaved(`Saved ${workDate}, ${timeIn} to ${timeOut}.`)
    setNotes('')
    onSaved(workDate)
  }

  return (
    <form
      className="rounded-lg border border-divider bg-surface p-3 space-y-2"
      onSubmit={e => { e.preventDefault(); void save() }}
    >
      <div>
        <p className="text-[13px] font-semibold text-text-primary">Add timesheet</p>
        <p className="text-[12px] text-text-secondary">
          Enter a date with a time in and time out. The day is added to attendance and payroll.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {employees && (
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
                  {emp.name} {emp.surname}{emp.employee_code ? ` · ${emp.employee_code}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
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
        <label className="flex flex-col gap-1 text-[11px] text-text-secondary flex-1 min-w-[160px]">
          Note
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional"
            className="h-9 px-2 border border-border rounded text-[13px] bg-background text-text-primary"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="h-9 px-3 rounded-lg bg-primary text-white text-[13px] font-medium disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save day'}
        </button>
      </div>
      {error && <p className="text-[12px] text-error">{error}</p>}
      {saved && <p className="text-[12px] text-text-primary">{saved}</p>}
    </form>
  )
}
