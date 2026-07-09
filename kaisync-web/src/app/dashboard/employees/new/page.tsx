'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { SectionCard, FormField, entryClass } from '@/components/SectionCard'
import { FormSelect } from '@/components/FormSelect'
import { FormDateInput } from '@/components/FormDateInput'
import { Toggle } from '@/components/Toggle'
import type { Branch, ShiftTemplate, Employee } from '@/types/database'

const EMPLOYMENT_TYPES = ['Permanent', 'Contract', 'Part-Time', 'Student']
const ACCESS_LEVELS = ['employee', 'manager', 'hr', 'owner']

export default function CreateEmployeePage() {
  const router = useRouter()

  // Context
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [managers, setManagers] = useState<Pick<Employee, 'id' | 'name' | 'surname'>[]>([])

  // Personal
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [idNumber, setIdNumber] = useState('')

  // Employment
  const [position, setPosition] = useState('')
  const [branchId, setBranchId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [employmentType, setEmploymentType] = useState('Permanent')
  const [workerType, setWorkerType] = useState('')
  const [accessLevel, setAccessLevel] = useState('employee')
  const [managerId, setManagerId] = useState('')
  const [employmentDate, setEmploymentDate] = useState('')

  // Rates
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

  // Invite
  const [sendInvite, setSendInvite] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadContext() }, [])

  async function loadContext() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: emp } = await supabase
      .from('employees')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (!emp) return
    setCompanyId(emp.company_id)

    const [br, tmpl, mgr] = await Promise.all([
      supabase.from('branches').select('id, name, address').eq('company_id', emp.company_id).order('name'),
      supabase.from('shift_templates').select('id, name, summary').eq('company_id', emp.company_id).order('name'),
      supabase.from('employees').select('id, name, surname')
        .eq('company_id', emp.company_id)
        .eq('is_active', true)
        .in('access_level', ['owner', 'manager', 'hr'])
        .order('name'),
    ])

    setBranches((br.data ?? []) as Branch[])
    setTemplates((tmpl.data ?? []) as ShiftTemplate[])
    setManagers((mgr.data ?? []) as Pick<Employee, 'id' | 'name' | 'surname'>[])
  }

  const daysNum = parseFloat(workDays) || 5
  const hoursNum = parseFloat(dailyHours) || 8
  const salaryNum = parseFloat(monthlySalary) || 0
  const weeklyDays = daysNum * (52 / 12)
  const computedDailyRate = salaryNum / weeklyDays
  const computedHourlyRate = computedDailyRate / hoursNum

  const selectedTemplate = templates.find(t => t.id === templateId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!companyId || !firstName.trim() || !lastName.trim()) {
      setError('First name and last name are required.')
      return
    }
    setSaving(true)
    setError(null)

    const supabase = createClient()
    const { data, error: insertError } = await supabase
      .from('employees')
      .insert({
        company_id: companyId,
        name: firstName.trim(),
        surname: lastName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        id_number: idNumber.trim() || null,
        position: position.trim() || null,
        branch_id: branchId || null,
        shift_template_id: templateId || null,
        employment_type: employmentType,
        worker_type: workerType || null,
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
        is_active: true,
      })
      .select()
      .single()

    if (insertError) {
      setError(insertError.message)
      setSaving(false)
      return
    }

    if (sendInvite && data) {
      try { await supabase.rpc('send_employee_invite', { employee_id: data.id }) } catch { /* no-op */ }
    }

    router.push(`/dashboard/employees/${data.id}`)
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-4 max-w-2xl mx-auto pb-8">
      {/* Back nav */}
      <div className="flex items-center gap-2 mb-1">
        <Link href="/dashboard/employees" className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <h1 className="text-[19px] font-bold text-text-primary">New Employee</h1>
      </div>

      {/* PERSONAL INFO */}
      <SectionCard title="PERSONAL INFO">
        <FormField label="First name *">
          <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
            placeholder="First name" required className={entryClass} />
        </FormField>
        <FormField label="Last name *">
          <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
            placeholder="Last name" required className={entryClass} />
        </FormField>
        <FormField label="Email">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="employee@email.com" className={entryClass} />
        </FormField>
        <FormField label="Phone">
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="+27..." className={entryClass} />
        </FormField>
        <FormField label="ID / Passport number" hint="The employee uses this + company code to sign in.">
          <input type="text" value={idNumber} onChange={e => setIdNumber(e.target.value)}
            placeholder="e.g. 9001015009087" className={entryClass} />
        </FormField>
      </SectionCard>

      {/* EMPLOYMENT */}
      <SectionCard title="EMPLOYMENT">
        <FormField label="Position / Role">
          <input type="text" value={position} onChange={e => setPosition(e.target.value)}
            placeholder="e.g. Cleaner, Guard, Technician" className={entryClass} />
        </FormField>

        <FormSelect label="Branch" value={branchId} onChange={e => setBranchId(e.target.value)}>
          <option value="">Select branch (optional)</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </FormSelect>

        <div>
          <FormSelect label="Time Template" value={templateId} onChange={e => setTemplateId(e.target.value)}>
            <option value="">Select shift template (optional)</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </FormSelect>
          {selectedTemplate?.summary && (
            <div className="mt-2 bg-surface rounded-sm px-[10px] py-[6px] border border-primary/20">
              <p className="text-[13px] text-primary">{selectedTemplate.summary}</p>
            </div>
          )}
        </div>

        <FormSelect label="Employment type" value={employmentType} onChange={e => setEmploymentType(e.target.value)}>
          {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </FormSelect>

        <FormSelect label="Access level" value={accessLevel} onChange={e => setAccessLevel(e.target.value)}>
          {ACCESS_LEVELS.map(l => (
            <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
          ))}
        </FormSelect>

        <FormSelect
          label="Reports to (manager)"
          value={managerId}
          onChange={e => setManagerId(e.target.value)}
          hint="Links this person to a manager for attendance, teams, and project visibility."
        >
          <option value="">None</option>
          {managers.map(m => (
            <option key={m.id} value={m.id}>{m.name} {m.surname}</option>
          ))}
        </FormSelect>

        <FormDateInput label="Employment date" value={employmentDate}
          onChange={e => setEmploymentDate(e.target.value)} />
      </SectionCard>

      {/* RATES & HOURS */}
      <SectionCard title="RATES & HOURS">
        <FormField label="Monthly salary (R)">
          <input type="number" value={monthlySalary} onChange={e => setMonthlySalary(e.target.value)}
            placeholder="0.00" step="0.01" min="0" className={entryClass} />
        </FormField>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-[14px] font-medium text-text-primary">Pay by hour/day instead</p>
          </div>
          <Toggle checked={payByHour} onChange={setPayByHour} />
        </div>

        {payByHour && (
          <FormSelect label="Pay basis" value={payBasis} onChange={e => setPayBasis(e.target.value)}>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
          </FormSelect>
        )}

        <FormField label="PAYE rate %">
          <input type="number" value={payeRate} onChange={e => setPayeRate(e.target.value)}
            placeholder="Company default" step="0.01" min="0" max="100" className={entryClass} />
        </FormField>

        <div className="flex items-center justify-between py-1">
          <p className="text-[14px] font-medium text-text-primary">Exempt from UIF</p>
          <Toggle checked={exemptUif} onChange={setExemptUif} />
        </div>

        <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase pt-1">
          Monthly deductions (R)
        </p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Medical aid">
            <input type="number" value={medicalAid} onChange={e => setMedicalAid(e.target.value)}
              placeholder="0.00" step="0.01" min="0" className={entryClass} />
          </FormField>
          <FormField label="Pension">
            <input type="number" value={pension} onChange={e => setPension(e.target.value)}
              placeholder="0.00" step="0.01" min="0" className={entryClass} />
          </FormField>
          <FormField label="Union">
            <input type="number" value={union} onChange={e => setUnion(e.target.value)}
              placeholder="0.00" step="0.01" min="0" className={entryClass} />
          </FormField>
        </div>

        <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase pt-1">
          Work schedule
        </p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Work days per week">
            <input type="number" value={workDays} onChange={e => setWorkDays(e.target.value)}
              placeholder="5" step="0.5" min="1" max="7" className={entryClass} />
          </FormField>
          <FormField label="Daily hours">
            <input type="number" value={dailyHours} onChange={e => setDailyHours(e.target.value)}
              placeholder="8" step="0.5" min="1" max="24" className={entryClass} />
          </FormField>
        </div>

        {salaryNum > 0 && (
          <>
            <div className="border-t border-divider pt-3">
              <p className="text-[11px] text-text-secondary mb-2">Auto-calculated from monthly salary</p>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Daily rate (R)">
                  <input readOnly value={computedDailyRate.toFixed(2)}
                    className={`${entryClass} bg-surface-elevated text-primary cursor-default`} />
                </FormField>
                <FormField label="Hourly rate (R)">
                  <input readOnly value={computedHourlyRate.toFixed(2)}
                    className={`${entryClass} bg-surface-elevated text-primary cursor-default`} />
                </FormField>
              </div>
            </div>
          </>
        )}
      </SectionCard>

      {/* INVITE */}
      <SectionCard>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[15px] font-medium text-text-primary">Send email invite</p>
            <p className="text-[11px] text-text-secondary">Employee will receive a login link</p>
          </div>
          <Toggle checked={sendInvite} onChange={setSendInvite} />
        </div>
      </SectionCard>

      {error && <p className="text-error text-[13px] px-1">{error}</p>}

      <button
        type="submit"
        disabled={saving || !firstName.trim() || !lastName.trim()}
        className="w-full h-[52px] bg-primary text-white rounded-md font-semibold text-[15px] hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {saving ? 'Creating…' : 'Create Employee'}
      </button>
    </form>
  )
}
