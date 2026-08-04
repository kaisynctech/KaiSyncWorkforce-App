'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { cn } from '@/lib/utils'
import { SectionCard, FormField, entryClass } from '@/components/SectionCard'
import { FormSelect } from '@/components/FormSelect'
import { FormDateInput } from '@/components/FormDateInput'
import { Toggle } from '@/components/Toggle'
import { StepUpDialog } from '@/components/step-up-dialog'
import {
  CREATE_ACCESS_LEVELS,
  EMPLOYMENT_TYPES,
  normalizeAccessLevel,
  normalizeEmploymentType,
} from '@/lib/employee-taxonomy'
import { sendEmployeeInvite } from '@/lib/employee-invite'
import {
  deleteEmployee,
  getEmployee,
  listBranches,
  listManagerOptions,
  listShiftTemplates,
  setEmployeeActive,
  updateEmployee,
} from '@/lib/employees'
import type { Branch, ShiftTemplate, Employee } from '@/types/database'

const ACCOUNT_TYPES = ['Cheque', 'Savings', 'Transmission']

export default function EditEmployeePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [callerRole, setCallerRole] = useState<string | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [managers, setManagers] = useState<Pick<Employee, 'id' | 'name' | 'surname'>[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initialActive, setInitialActive] = useState(true)

  // Form state
  const [isActive, setIsActive] = useState(true)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [position, setPosition] = useState('')
  const [department, setDepartment] = useState('')
  const [branchId, setBranchId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [employmentType, setEmploymentType] = useState('permanent')
  const [accessLevel, setAccessLevel] = useState('employee')
  const [managerId, setManagerId] = useState('')
  const [employmentDate, setEmploymentDate] = useState('')
  const [inviteMsg, setInviteMsg] = useState<string | null>(null)
  const [monthlySalary, setMonthlySalary] = useState('')
  const [payByHour, setPayByHour] = useState(false)
  const [payBasis, setPayBasis] = useState('hourly')
  const [payeRate, setPayeRate] = useState('')
  const [exemptUif, setExemptUif] = useState(false)
  const [medicalAid, setMedicalAid] = useState('')
  const [pension, setPension] = useState('')
  const [union, setUnion] = useState('')
  const [workDays, setWorkDays] = useState('5')
  const [dailyHours, setDailyHours] = useState('8')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [bankBranchCode, setBankBranchCode] = useState('')
  const [accountType, setAccountType] = useState('')

  const [stepUpOpen, setStepUpOpen] = useState(false)
  const [stepUpBusy, setStepUpBusy] = useState(false)
  const [stepUpError, setStepUpError] = useState<string | null>(null)
  const stepUpResolverRef = useRef<((password: string | null) => void) | null>(null)

  function promptStepUpPassword(): Promise<string | null> {
    setStepUpError(null)
    setStepUpBusy(false)
    setStepUpOpen(true)
    return new Promise(resolve => {
      stepUpResolverRef.current = resolve
    })
  }

  function finishStepUpPrompt(password: string | null) {
    const resolve = stepUpResolverRef.current
    stepUpResolverRef.current = null
    setStepUpOpen(false)
    setStepUpBusy(false)
    setStepUpError(null)
    resolve?.(password)
  }

  useEffect(() => { loadData() }, [id])

  async function loadData() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)

    const [empRes, br, tmpl, mgr, roleRes] = await Promise.all([
      getEmployee(supabase, member.companyId, id),
      listBranches(supabase, member.companyId),
      listShiftTemplates(supabase, member.companyId),
      listManagerOptions(supabase, member.companyId, id),
      supabase.rpc('get_my_role', { p_company_id: member.companyId }),
    ])

    setCallerRole(typeof roleRes.data === 'string' ? roleRes.data : null)

    if (!empRes.ok) { setError(empRes.message); setLoading(false); return }
    const emp = empRes.data
    if (!emp) { setLoading(false); return }

    setEmployee(emp)
    if (br.ok) setBranches(br.data)
    if (tmpl.ok) setTemplates(tmpl.data)
    if (mgr.ok) setManagers(mgr.data)

    // Populate form
    setIsActive(emp.is_active)
    setInitialActive(emp.is_active)
    setFirstName(emp.name)
    setLastName(emp.surname)
    setEmail(emp.email ?? '')
    setPhone(emp.phone ?? '')
    setIdNumber(emp.id_number ?? '')
    setPosition(emp.position ?? '')
    setDepartment(emp.department ?? '')
    setBranchId(emp.branch_id ?? '')
    setTemplateId(emp.shift_template_id ?? '')
    setEmploymentType(normalizeEmploymentType(emp.employment_type))
    setAccessLevel(normalizeAccessLevel(emp.access_level))
    const raw = emp as Employee & {
      paye_rate_percent?: number | null
      uif_exempt?: boolean | null
      work_days_weekly?: number | null
      account_type?: string | null
    }
    setManagerId(emp.manager_id ?? '')
    setEmploymentDate(emp.employment_date ?? '')
    setMonthlySalary(emp.monthly_salary?.toString() ?? '')
    setPayByHour(emp.pay_by_hour ?? false)
    setPayBasis(emp.pay_basis ?? 'hourly')
    setPayeRate((raw.paye_rate_percent ?? emp.paye_rate)?.toString() ?? '')
    setExemptUif(raw.uif_exempt ?? emp.exempt_from_uif ?? false)
    setMedicalAid(emp.medical_aid_deduction?.toString() ?? '')
    setPension(emp.pension_deduction?.toString() ?? '')
    setUnion(emp.union_deduction?.toString() ?? '')
    setWorkDays((raw.work_days_weekly ?? emp.work_days_per_week)?.toString() ?? '5')
    setDailyHours(emp.daily_hours?.toString() ?? '8')
    setBankName(emp.bank_name ?? '')
    setAccountNumber(emp.bank_account ?? '')
    setBankBranchCode(emp.bank_branch_code ?? '')
    setAccountType(
      raw.account_type
        ? raw.account_type.charAt(0).toUpperCase() + raw.account_type.slice(1).toLowerCase()
        : ''
    )

    setLoading(false)
  }

  const daysNum = parseFloat(workDays) || 5
  const hoursNum = parseFloat(dailyHours) || 8
  const salaryNum = parseFloat(monthlySalary) || 0
  const computedDailyRate = salaryNum / (daysNum * 52 / 12)
  const computedHourlyRate = computedDailyRate / hoursNum

  async function handleSave() {
    if (!companyId || !firstName.trim() || !lastName.trim()) {
      setError('First name and last name are required.')
      return
    }
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const branchName = branchId
      ? (branches.find(b => b.id === branchId)?.name ?? null)
      : null

    const updated = await updateEmployee(
      supabase,
      id,
      {
        companyId,
        name: firstName,
        surname: lastName,
        email,
        phone,
        idNumber,
        position,
        department,
        branchId: branchId || null,
        branchName,
        shiftTemplateId: templateId || null,
        employmentType,
        workerType: 'employee',
        accessLevel,
        managerId: managerId || null,
        employmentDate: employmentDate || null,
        monthlySalary: salaryNum,
        payByHour,
        payBasis,
        payeRatePercent: payeRate ? parseFloat(payeRate) : null,
        uifExempt: exemptUif,
        medicalAidDeduction: medicalAid ? parseFloat(medicalAid) : 0,
        pensionDeduction: pension ? parseFloat(pension) : 0,
        unionDeduction: union ? parseFloat(union) : 0,
        workDaysWeekly: daysNum,
        dailyHours: hoursNum,
        hourlyRate: salaryNum ? computedHourlyRate : 0,
        dailyRate: salaryNum ? computedDailyRate : 0,
        bankName,
        bankAccount: accountNumber,
        bankBranchCode,
        accountType,
      },
      { promptPassword: promptStepUpPassword }
    )

    if (!updated.ok) {
      setSaving(false)
      setError(updated.message)
      return
    }

    // Active flag goes through audited RPC (also syncs company_relationships).
    if (isActive !== initialActive) {
      const activeResult = await setEmployeeActive(supabase, {
        companyId,
        employeeId: id,
        isActive,
      })
      if (!activeResult.ok) {
        setSaving(false)
        setError(activeResult.message)
        return
      }
    }

    setSaving(false)
    router.push(`/dashboard/employees/${id}`)
  }

  async function handleSendInvite() {
    if (!email.trim()) {
      setInviteMsg('Email is required to send an invite.')
      return
    }
    setInviteMsg(null)
    const supabase = createClient()
    const result = await sendEmployeeInvite(supabase, { employeeId: id, email })
    setInviteMsg(result.ok ? 'Invite sent.' : result.message)
  }

  async function handleToggleActive() {
    if (!companyId) return
    const next = !isActive
    const label = next ? 'reactivate' : 'deactivate'
    if (!confirm(`This will ${label} the employee. Continue?`)) return
    setArchiving(true)
    setError(null)
    const supabase = createClient()
    const result = await setEmployeeActive(supabase, {
      companyId,
      employeeId: id,
      isActive: next,
    })
    setArchiving(false)
    if (!result.ok) { setError(result.message); return }
    setIsActive(next)
    setInitialActive(next)
    if (!next) router.push('/dashboard/employees')
  }

  async function handleDelete() {
    if (!companyId) return
    const confirmed = confirm(
      'Permanently delete this employee? This cannot be undone. Related time punches for this employee will also be removed.'
    )
    if (!confirmed) return
    const typed = window.prompt('Type DELETE to confirm permanent removal:')
    if (typed !== 'DELETE') {
      setError('Delete cancelled — confirmation text did not match.')
      return
    }
    setDeleting(true)
    setError(null)
    const supabase = createClient()
    const result = await deleteEmployee(supabase, { companyId, employeeId: id })
    setDeleting(false)
    if (!result.ok) { setError(result.message); return }
    router.push('/dashboard/employees')
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-[14px] text-text-secondary">Loading…</div>
  }

  if (error === 'not_linked') return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
        <p className="text-[13px] text-text-secondary">
          Your account is not linked to an active employee record.<br/>
          Please contact your administrator.
        </p>
      </div>
    </div>
  )

  if (!employee) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <p className="text-[14px] text-text-secondary">Employee not found</p>
        <Link href="/dashboard/employees" className="text-primary text-[13px] hover:underline">Back to list</Link>
      </div>
    )
  }

  const fullName = `${firstName || employee.name} ${lastName || employee.surname}`

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sticky header */}
      <div className="bg-surface border-b border-divider shrink-0">
        <div className="flex items-center justify-between px-4 pt-4 pb-[10px] gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href={`/dashboard/employees/${id}`} className="text-text-secondary hover:text-text-primary transition-colors shrink-0">
              <span className="material-icons text-[20px]">arrow_back</span>
            </Link>
            <div className="min-w-0">
              <p className="text-[19px] font-bold text-text-primary truncate">{fullName}</p>
              <p className="text-[12px] text-text-secondary">Editing employee record</p>
            </div>
          </div>
          <div className={cn(
            'flex items-center gap-2 px-[10px] py-[6px] rounded-[10px] shrink-0',
            isActive ? 'bg-success-dark' : 'bg-error-dark'
          )}>
            <span className={cn('text-[12px] font-semibold', isActive ? 'text-[#166534]' : 'text-[#991B1B]')}>
              {isActive ? 'Active' : 'Inactive'}
            </span>
            <Toggle checked={isActive} onChange={setIsActive} />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 pb-[14px]">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || deleting}
            className="bg-primary text-white h-11 rounded-sm font-semibold text-[13px] hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={handleSendInvite}
            disabled={deleting}
            className="border border-primary text-primary h-11 rounded-sm font-medium text-[13px] hover:bg-primary/5 transition-colors disabled:opacity-50"
          >
            Send Invite
          </button>
          <button
            type="button"
            onClick={handleToggleActive}
            disabled={archiving || deleting}
            className={cn(
              'h-11 rounded-sm font-semibold text-[13px] disabled:opacity-50 transition-colors',
              isActive
                ? 'bg-warning text-white hover:opacity-90'
                : 'bg-success text-white hover:opacity-90'
            )}
          >
            {archiving ? '…' : isActive ? 'Archive' : 'Reactivate'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting || archiving}
            className="bg-error text-white h-11 rounded-sm font-semibold text-[13px] hover:opacity-90 disabled:opacity-50 transition-colors"
          >
            {deleting ? '…' : 'Delete'}
          </button>
        </div>

        {error && <p className="px-4 pb-[10px] text-error text-[13px]">{error}</p>}
        {inviteMsg && (
          <p className={cn(
            'px-4 pb-[10px] text-[13px]',
            inviteMsg === 'Invite sent.' ? 'text-success' : 'text-error'
          )}>
            {inviteMsg}
          </p>
        )}
      </div>

      {/* Scrollable form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-8">
        <SectionCard title="PERSONAL INFO">
          <FormField label="First name *">
            <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" className={entryClass} />
          </FormField>
          <FormField label="Last name *">
            <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" className={entryClass} />
          </FormField>
          <FormField label="Email">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="employee@email.com" className={entryClass} />
          </FormField>
          <FormField label="Phone">
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+27..." className={entryClass} />
          </FormField>
          <FormField label="ID / Passport number">
            <input type="text" value={idNumber} onChange={e => setIdNumber(e.target.value)} placeholder="e.g. 9001015009087" className={entryClass} />
          </FormField>
        </SectionCard>

        <SectionCard title="EMPLOYMENT">
          <FormField label="Position / Role">
            <input type="text" value={position} onChange={e => setPosition(e.target.value)} placeholder="e.g. Cleaner, Guard, Technician" className={entryClass} />
          </FormField>
          <FormField label="Department">
            <input type="text" value={department} onChange={e => setDepartment(e.target.value)} placeholder="e.g. Operations, Finance" className={entryClass} />
          </FormField>
          <FormSelect label="Branch" value={branchId} onChange={e => setBranchId(e.target.value)}>
            <option value="">None</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </FormSelect>
          <FormSelect label="Time Template" value={templateId} onChange={e => setTemplateId(e.target.value)}>
            <option value="">None</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </FormSelect>
          <FormSelect
            label="Employment type"
            value={employmentType}
            onChange={e => setEmploymentType(e.target.value)}
            hint="Contract kind: permanent, contract, part-time, or student."
          >
            {EMPLOYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </FormSelect>
          <FormSelect
            label="Access level"
            value={accessLevel}
            onChange={e => setAccessLevel(e.target.value)}
            hint={
              accessLevel === 'owner'
                ? 'Owner can only be changed via ownership transfer in Settings.'
                : 'App permissions. Owner is assigned via ownership transfer, not edit.'
            }
            disabled={accessLevel === 'owner'}
          >
            {accessLevel === 'owner' ? (
              <option value="owner">Owner</option>
            ) : (
              CREATE_ACCESS_LEVELS
                .filter(l => callerRole === 'owner' || l.value !== 'hr' || accessLevel === 'hr')
                .map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))
            )}
          </FormSelect>
          <FormSelect label="Reports to (manager)" value={managerId} onChange={e => setManagerId(e.target.value)}>
            <option value="">None</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.name} {m.surname}</option>)}
          </FormSelect>
          <FormDateInput label="Employment date" value={employmentDate} onChange={e => setEmploymentDate(e.target.value)} />
        </SectionCard>

        <SectionCard title="RATES & HOURS">
          <FormField label="Monthly salary (R)">
            <input type="number" value={monthlySalary} onChange={e => setMonthlySalary(e.target.value)} placeholder="0.00" step="0.01" min="0" className={entryClass} />
          </FormField>
          <div className="flex items-center justify-between py-1">
            <p className="text-[14px] font-medium text-text-primary">Pay by hour/day instead</p>
            <Toggle checked={payByHour} onChange={setPayByHour} />
          </div>
          {payByHour && (
            <FormSelect label="Pay basis" value={payBasis} onChange={e => setPayBasis(e.target.value)}>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
            </FormSelect>
          )}
          <FormField label="PAYE rate %">
            <input type="number" value={payeRate} onChange={e => setPayeRate(e.target.value)} placeholder="Company default" step="0.01" min="0" max="100" className={entryClass} />
          </FormField>
          <div className="flex items-center justify-between py-1">
            <p className="text-[14px] font-medium text-text-primary">Exempt from UIF</p>
            <Toggle checked={exemptUif} onChange={setExemptUif} />
          </div>
          <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase pt-1">Monthly deductions (R)</p>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Medical aid">
              <input type="number" value={medicalAid} onChange={e => setMedicalAid(e.target.value)} placeholder="0.00" step="0.01" min="0" className={entryClass} />
            </FormField>
            <FormField label="Pension">
              <input type="number" value={pension} onChange={e => setPension(e.target.value)} placeholder="0.00" step="0.01" min="0" className={entryClass} />
            </FormField>
            <FormField label="Union">
              <input type="number" value={union} onChange={e => setUnion(e.target.value)} placeholder="0.00" step="0.01" min="0" className={entryClass} />
            </FormField>
          </div>
          <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase pt-1">Work schedule</p>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Work days per week">
              <input type="number" value={workDays} onChange={e => setWorkDays(e.target.value)} placeholder="5" step="0.5" min="1" max="7" className={entryClass} />
            </FormField>
            <FormField label="Daily hours">
              <input type="number" value={dailyHours} onChange={e => setDailyHours(e.target.value)} placeholder="8" step="0.5" min="1" max="24" className={entryClass} />
            </FormField>
          </div>
          {salaryNum > 0 && (
            <div className="border-t border-divider pt-3">
              <p className="text-[11px] text-text-secondary mb-2">Auto-calculated from monthly salary</p>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Daily rate (R)">
                  <input readOnly value={computedDailyRate.toFixed(2)} className={`${entryClass} bg-surface-elevated text-primary cursor-default`} />
                </FormField>
                <FormField label="Hourly rate (R)">
                  <input readOnly value={computedHourlyRate.toFixed(2)} className={`${entryClass} bg-surface-elevated text-primary cursor-default`} />
                </FormField>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="BANKING DETAILS">
          <FormField label="Bank name">
            <input type="text" value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. Nedbank" className={entryClass} />
          </FormField>
          <FormField label="Account number">
            <input type="text" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="12-digit account number" className={entryClass} />
          </FormField>
          <FormField label="Branch code">
            <input type="text" value={bankBranchCode} onChange={e => setBankBranchCode(e.target.value)} placeholder="6-digit branch code" className={entryClass} />
          </FormField>
          <FormSelect label="Account type" value={accountType} onChange={e => setAccountType(e.target.value)}>
            <option value="">Not set</option>
            {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </FormSelect>
        </SectionCard>
      </div>

      <StepUpDialog
        open={stepUpOpen}
        busy={stepUpBusy}
        error={stepUpError}
        onCancel={() => finishStepUpPrompt(null)}
        onVerify={password => {
          setStepUpBusy(true)
          finishStepUpPrompt(password)
        }}
      />
    </div>
  )
}
