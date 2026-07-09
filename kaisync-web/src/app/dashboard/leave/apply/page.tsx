'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { SectionCard, FormField, entryClass } from '@/components/SectionCard'
import { FormSelect } from '@/components/FormSelect'
import { FormDateInput } from '@/components/FormDateInput'

const DEFAULT_LEAVE_TYPES = ['Annual Leave', 'Sick Leave', 'Family Responsibility', 'Unpaid Leave']

function ApplyLeaveContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const employeeId = searchParams.get('employeeId')

  const [employeeName, setEmployeeName] = useState('')
  const [backHref, setBackHref] = useState('/dashboard/employees')
  const [leaveType, setLeaveType] = useState('Annual Leave')
  const [leaveTypes, setLeaveTypes] = useState<string[]>(DEFAULT_LEAVE_TYPES)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    if (!employeeId) { router.push('/dashboard/employees'); return }
    setBackHref(`/dashboard/employees/${employeeId}`)
    loadEmployee(employeeId)
  }, [employeeId])

  async function loadEmployee(empId: string) {
    const supabase = createClient()
    const { data: emp } = await supabase
      .from('employees')
      .select('name, surname, company_id')
      .eq('id', empId)
      .single()

    if (!emp) { router.push('/dashboard/employees'); return }
    setEmployeeName(`${emp.name} ${emp.surname}`)

    const { data: types } = await supabase
      .from('leave_types')
      .select('name')
      .eq('company_id', emp.company_id)
      .order('name')

    if (types && types.length > 0) {
      const names = types.map((t: { name: string }) => t.name)
      setLeaveTypes(names)
      setLeaveType(names[0])
    }
  }

  function calcTotalDays(start: string, end: string): number {
    if (!start || !end) return 0
    const s = new Date(start)
    const e = new Date(end)
    if (e < s) return 0
    return Math.round((e.getTime() - s.getTime()) / 86400000) + 1
  }

  async function submit() {
    if (!employeeId || !startDate || !endDate || !reason.trim()) {
      setError('Please fill in all required fields.')
      return
    }
    if (new Date(endDate) < new Date(startDate)) {
      setError('End date must be on or after start date.')
      return
    }
    setIsBusy(true)
    setError(null)
    const supabase = createClient()
    try {
      const { error: rpcError } = await supabase.rpc('apply_leave', {
        p_employee_id: employeeId,
        p_leave_type: leaveType,
        p_start_date: startDate,
        p_end_date: endDate,
        p_reason: reason.trim(),
      })
      if (rpcError) throw rpcError
      router.push(`/dashboard/employees/${employeeId}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to submit leave request.')
      setIsBusy(false)
    }
  }

  const totalDays = calcTotalDays(startDate, endDate)

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto pb-8 overflow-y-auto">
      <div className="flex items-center gap-2 mb-1">
        <Link href={backHref} className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <h1 className="text-[19px] font-bold text-text-primary">Apply Leave</h1>
      </div>

      <SectionCard title="LEAVE APPLICATION">
        <FormField label="Employee">
          <input
            readOnly
            value={employeeName}
            className={`${entryClass} text-text-secondary cursor-default`}
          />
        </FormField>

        <FormSelect
          label="Leave type"
          value={leaveType}
          onChange={e => setLeaveType(e.target.value)}
        >
          {leaveTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </FormSelect>

        <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-end">
          <FormDateInput
            label="Start date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
          <span className="text-text-secondary mb-3 text-[18px] self-end pb-3">–</span>
          <FormDateInput
            label="End date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
          />
        </div>

        <div className="bg-surface-elevated rounded-lg px-3 py-2 text-[13px]">
          <span className="text-text-secondary">Total days: </span>
          <span className="text-primary font-semibold">{totalDays}</span>
        </div>

        <FormField label="Reason *">
          <textarea
            rows={3}
            placeholder="Enter reason for leave…"
            value={reason}
            onChange={e => setReason(e.target.value)}
            className={`${entryClass} resize-none h-auto min-h-[80px] py-3`}
          />
        </FormField>
      </SectionCard>

      {error && <p className="text-error text-[13px] px-1">{error}</p>}

      <button
        onClick={submit}
        disabled={isBusy || !startDate || !endDate || !reason.trim()}
        className="w-full h-11 bg-primary text-white rounded-md font-semibold text-[15px] hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isBusy ? 'Submitting…' : 'Submit Leave Application'}
      </button>
    </div>
  )
}

export default function ApplyLeavePage() {
  return (
    <Suspense fallback={<div className="p-4 text-text-secondary text-[13px]">Loading…</div>}>
      <ApplyLeaveContent />
    </Suspense>
  )
}
