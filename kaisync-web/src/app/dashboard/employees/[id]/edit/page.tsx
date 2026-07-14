'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { cn } from '@/lib/utils'
import { SectionCard, FormField, entryClass } from '@/components/SectionCard'
import { FormSelect } from '@/components/FormSelect'
import { FormDateInput } from '@/components/FormDateInput'
import { Toggle } from '@/components/Toggle'
import type { Branch, ShiftTemplate, Employee } from '@/types/database'

const EMPLOYMENT_TYPES = ['Permanent', 'Contract', 'Part-Time', 'Student']
const ACCESS_LEVELS = ['employee', 'manager', 'hr', 'owner']
const ACCOUNT_TYPES = ['Cheque', 'Savings', 'Transmission']

export default function EditEmployeePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [managers, setManagers] = useState<Pick<Employee, 'id' | 'name' | 'surname'>[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [isActive, setIsActive] = useState(true)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [position, setPosition] = useState('')
  const [branchId, setBranchId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [employmentType, setEmploymentType] = useState('Permanent')
  const [accessLevel, setAccessLevel] = useState('employee')
  const [managerId, setManagerId] = useState('')
  const [employmentDate, setEmploymentDate] = useState('')
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
  const [accountType, setAccountType] = useState('Cheque')

  useEffect(() => { loadData() }, [id])

  async function loadData() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)

    const [empRes, br, tmpl, mgr] = await Promise.all([
      supabase.from('employees').select('*').eq('id', id).eq('company_id', member.companyId).maybeSingle(),
      supabase.from('branches').select('id, name').eq('company_id', member.companyId).order('name'),
      supabase.from('shift_templates').select('id, name, summary').eq('company_id', member.companyId).order('name'),
      supabase.from('employees').select('id, name, surname')
        .eq('company_id', member.companyId).eq('is_active', true)
        .in('access_level', ['owner', 'manager', 'hr']).order('name'),
    ])

    const emp = empRes.data as Employee | null
    if (!emp) { setLoading(false); return }

    setEmployee(emp)
    setBranches((br.data ?? []) as Branch[])
    setTemplates((tmpl.data ?? []) as ShiftTemplate[])
    setManagers((mgr.data ?? []) as Pick<Employee, 'id' | 'name' | 'surname'>[])

    // Populate form
    setIsActive(emp.is_active)
    setFirstName(emp.name)
    setLastName(emp.surname)
    setEmail(emp.email ?? '')
    setPhone(emp.phone ?? '')
    setIdNumber(emp.id_number ?? '')
    setPosition(emp.position ?? '')
    setBranchId(emp.branch_id ?? '')
    setTemplateId(emp.shift_template_id ?? '')
    setEmploymentType(emp.employment_type ?? 'Permanent')
    setAccessLevel(emp.access_level)
    setManagerId(emp.manager_id ?? '')
    setEmploymentDate(emp.employment_date ?? '')
    setMonthlySalary(emp.monthly_salary?.toString() ?? '')
    setPayByHour(emp.pay_by_hour ?? false)
    setPayBasis(emp.pay_basis ?? 'hourly')
    setPayeRate(emp.paye_rate?.toString() ?? '')
    setExemptUif(emp.exempt_from_uif ?? false)
    setMedicalAid(emp.medical_aid_deduction?.toString() ?? '')
    setPension(emp.pension_deduction?.toString() ?? '')
    setUnion(emp.union_deduction?.toString() ?? '')
    setWorkDays(emp.work_days_per_week?.toString() ?? '5')
    setDailyHours(emp.daily_hours?.toString() ?? '8')
    setBankName(emp.bank_name ?? '')
    setAccountNumber(emp.account_number ?? '')
    setBankBranchCode(emp.bank_branch_code ?? '')
    setAccountType(emp.account_type ?? 'Cheque')

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
    const { error: updateError } = await supabase
      .from('employees')
      .update({
        is_active: isActive,
        name: firstName.trim(),
        surname: lastName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        id_number: idNumber.trim() || null,
        position: position.trim() || null,
        branch_id: branchId || null,
        shift_template_id: templateId || null,
        employment_type: employmentType,
        access_level: accessLevel,
        manager_id: managerId || null,
        employment_date: employmentDate || null,
        monthly_salary: salaryNum || null,
        pay_by_hour: payByHour,
        pay_basis: payByHour ? payBasis : null,
        paye_rate: payeRate ? parseFloat(payeRate) : null,
        exempt_from_uif: exemptUif,
        medical_aid_deduction: medicalAid ? parseFloat(medicalAid) : null,
        pension_deduction: pension ? parseFloat(pension) : null,
        union_deduction: union ? parseFloat(union) : null,
        work_days_per_week: daysNum,
        daily_hours: hoursNum,
        hourly_rate: salaryNum ? computedHourlyRate : null,
        daily_rate: salaryNum ? computedDailyRate : null,
        bank_name: bankName.trim() || null,
        account_number: accountNumber.trim() || null,
        bank_branch_code: bankBranchCode.trim() || null,
        account_type: accountType || null,
      })
      .eq('id', id)

    setSaving(false)
    if (updateError) { setError(updateError.message); return }
    router.push(`/dashboard/employees/${id}`)
  }

  async function handleSendInvite() {
    const supabase = createClient()
    try { await supabase.rpc('send_employee_invite', { employee_id: id }) } catch { /* no-op */ }
  }

  async function handleArchive() {
    if (!confirm('This will deactivate the employee. Continue?')) return
    setArchiving(true)
    const supabase = createClient()
    await supabase.from('employees').update({ is_active: false }).eq('id', id)
    setArchiving(false)
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

        <div className="grid grid-cols-3 gap-2 px-4 pb-[14px]">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-primary text-white h-11 rounded-sm font-semibold text-[13px] hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={handleSendInvite}
            className="border border-primary text-primary h-11 rounded-sm font-medium text-[13px] hover:bg-primary/5 transition-colors"
          >
            Send Invite
          </button>
          <button
            type="button"
            onClick={handleArchive}
            disabled={archiving}
            className="bg-error text-white h-11 rounded-sm font-semibold text-[13px] hover:opacity-90 disabled:opacity-50 transition-colors"
          >
            {archiving ? '…' : 'Archive'}
          </button>
        </div>

        {error && <p className="px-4 pb-[10px] text-error text-[13px]">{error}</p>}
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
          <FormSelect label="Branch" value={branchId} onChange={e => setBranchId(e.target.value)}>
            <option value="">None</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </FormSelect>
          <FormSelect label="Time Template" value={templateId} onChange={e => setTemplateId(e.target.value)}>
            <option value="">None</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </FormSelect>
          <FormSelect label="Employment type" value={employmentType} onChange={e => setEmploymentType(e.target.value)}>
            {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </FormSelect>
          <FormSelect label="Access level" value={accessLevel} onChange={e => setAccessLevel(e.target.value)}>
            {ACCESS_LEVELS.map(l => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
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
            {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </FormSelect>
        </SectionCard>
      </div>
    </div>
  )
}
