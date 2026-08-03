'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { SectionCard, FormField, entryClass } from '@/components/SectionCard'
import { FormSelect } from '@/components/FormSelect'
import { FormDateInput } from '@/components/FormDateInput'
import { calcLeaveTotalDays, LEAVE_TYPES } from '@/lib/leave-policy'
import {
  getCompanyAnnualDays,
  loadLeaveSettings,
  resolveLeaveTypeOptions,
  type LeaveSettingsMap,
} from '@/lib/leave-settings'

function ApplyLeaveContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const employeeId = searchParams.get('employeeId')

  const [employeeName, setEmployeeName] = useState('')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [leaveSettings, setLeaveSettings] = useState<LeaveSettingsMap>({})
  const [usedByType, setUsedByType] = useState<Record<string, number>>({})
  const [backHref, setBackHref] = useState('/dashboard/employees')
  const [leaveType, setLeaveType] = useState('Annual Leave')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    if (!employeeId) { router.push('/dashboard/employees'); return }
    setBackHref(`/dashboard/employees/${employeeId}`)
    void loadEmployee(employeeId)
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
    const cid = emp.company_id as string
    setCompanyId(cid)

    const yearStart = `${new Date().getFullYear()}-01-01`
    const [settingsRes, usedRes] = await Promise.all([
      loadLeaveSettings(supabase, cid),
      supabase
        .from('leave_requests')
        .select('leave_type, total_days')
        .eq('employee_id', empId)
        .eq('status', 'approved')
        .gte('start_date', yearStart),
    ])
    if (settingsRes.ok) setLeaveSettings(settingsRes.data)
    const used: Record<string, number> = {}
    for (const row of (usedRes.data ?? []) as { leave_type: string; total_days: number }[]) {
      used[row.leave_type] = (used[row.leave_type] ?? 0) + (row.total_days ?? 0)
    }
    setUsedByType(used)
  }

  async function submit() {
    if (!employeeId || !companyId || !startDate || !endDate || !reason.trim()) {
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
    const totalDays = calcLeaveTotalDays(startDate, endDate)

    const { error: insertErr } = await supabase.from('leave_requests').insert({
      company_id: companyId,
      employee_id: employeeId,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      half_day_start: false,
      half_day_end: false,
      total_days: totalDays,
      status: 'pending',
      reason: reason.trim(),
    })

    if (insertErr) {
      setError(insertErr.message)
      setIsBusy(false)
      return
    }
    router.push(`/dashboard/employees/${employeeId}`)
  }

  const totalDays = startDate && endDate ? calcLeaveTotalDays(startDate, endDate) : 0
  const typeOptions = resolveLeaveTypeOptions(leaveSettings)
  const annual = getCompanyAnnualDays(leaveType, leaveSettings)
  const used = usedByType[leaveType] ?? 0
  const remaining = Math.max(0, annual - used)

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
          {(typeOptions.length ? typeOptions : LEAVE_TYPES.map(t => ({ key: t.key, label: t.label }))).map(t => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </FormSelect>

        <div className="bg-surface-elevated rounded-lg px-3 py-2 text-[13px] flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <span className="text-text-secondary">Annual: </span>
            <span className="font-semibold text-text-primary">{annual}</span>
          </span>
          <span>
            <span className="text-text-secondary">Used YTD: </span>
            <span className="font-semibold text-text-primary">{used}</span>
          </span>
          <span>
            <span className="text-text-secondary">Remaining: </span>
            <span className={`font-semibold ${remaining <= 0 ? 'text-error' : 'text-success'}`}>
              {remaining}
            </span>
          </span>
        </div>

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
        onClick={() => void submit()}
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
