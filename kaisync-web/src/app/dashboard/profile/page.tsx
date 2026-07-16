'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getInitials } from '@/lib/utils'
import type { Employee } from '@/types/database'

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

export default function ProfilePage() {
  const [employee, setEmployee]   = useState<Employee | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [empId, setEmpId]         = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [notLinked, setNotLinked] = useState(false)

  // Personal
  const [firstName,   setFirstName]   = useState('')
  const [lastName,    setLastName]    = useState('')
  const [phone,       setPhone]       = useState('')
  const [idNumber,    setIdNumber]    = useState('')

  // Banking
  const [bankName,       setBankName]       = useState('')
  const [accountNumber,  setAccountNumber]  = useState('')
  const [branchCode,     setBranchCode]     = useState('')

  useEffect(() => { init() }, [])

  async function init() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setNotLinked(true); setLoading(false); return }

    setCompanyId(member.companyId)
    setEmpId(member.employeeId)

    const { data } = await supabase
      .from('employees')
      .select('*')
      .eq('id', member.employeeId)
      .eq('company_id', member.companyId)
      .maybeSingle()

    if (data) {
      const emp = data as Employee
      setEmployee(emp)
      setFirstName(emp.name ?? '')
      setLastName(emp.surname ?? '')
      setPhone(emp.phone ?? '')
      setIdNumber(emp.id_number ?? '')
      setBankName(emp.bank_name ?? '')
      setAccountNumber(emp.bank_account ?? '')
      setBranchCode(emp.bank_branch_code ?? '')
    }
    setLoading(false)
  }

  async function save() {
    if (!employee || !companyId || !empId) return
    setSaving(true)
    setSaved(false)
    setSaveError(null)

    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('employee_update_profile', {
      p_employee_id:      empId,
      p_company_id:       companyId,
      p_first_name:       firstName !== employee.name          ? firstName      : null,
      p_last_name:        lastName  !== employee.surname        ? lastName       : null,
      p_phone:            phone     !== (employee.phone ?? '')  ? phone          : null,
      p_id_number:        idNumber  !== (employee.id_number ?? '') ? idNumber   : null,
      p_bank_name:        bankName  !== (employee.bank_name ?? '')  ? bankName  : null,
      p_bank_account:     accountNumber !== (employee.bank_account ?? '') ? accountNumber : null,
      p_bank_branch_code: branchCode !== (employee.bank_branch_code ?? '') ? branchCode : null,
    })

    if (error) {
      setSaveError(error.message)
    } else {
      setSaved(true)
      await init()
      setTimeout(() => setSaved(false), 3000)
    }
    setSaving(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-[14px] text-text-secondary">Loading…</div>
  )

  if (notLinked) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
        <p className="text-[13px] text-text-secondary">Your account is not linked to an employee record.</p>
      </div>
    </div>
  )

  const fullName = employee ? `${employee.name} ${employee.surname}`.trim() : '—'

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">My Profile</h1>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl">

        {/* Avatar card */}
        <div className="bg-surface border border-divider rounded-xl p-4 flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center shrink-0">
            <span className="text-white text-[22px] font-bold">{getInitials(fullName)}</span>
          </div>
          <div className="min-w-0">
            <p className="text-[18px] font-bold text-text-primary truncate">{fullName}</p>
            {employee?.position && (
              <p className="text-[13px] text-text-secondary">{employee.position}</p>
            )}
            <div className="flex gap-2 mt-1 flex-wrap">
              {employee?.access_level && (
                <span className="text-[11px] font-semibold px-2 py-[3px] rounded-full bg-primary/10 text-primary capitalize">
                  {employee.access_level}
                </span>
              )}
              {employee?.employment_type && (
                <span className="text-[11px] px-2 py-[3px] rounded-full bg-surface-elevated border border-divider text-text-secondary capitalize">
                  {employee.employment_type}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Success banner */}
        {saved && (
          <div className="rounded-xl px-4 py-3 bg-success-dark border border-success/30 flex items-center gap-2">
            <span className="material-icons text-success text-[18px]">check_circle</span>
            <p className="text-[13px] font-semibold text-success">Profile updated</p>
          </div>
        )}

        {/* Error banner */}
        {saveError && (
          <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
            <p className="text-[13px] font-semibold text-error">{saveError}</p>
          </div>
        )}

        {/* Personal Information */}
        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Personal Information</p>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="First Name">
                <input className="input" type="text" value={firstName}
                  onChange={e => setFirstName(e.target.value)} />
              </FormField>
              <FormField label="Last Name">
                <input className="input" type="text" value={lastName}
                  onChange={e => setLastName(e.target.value)} />
              </FormField>
            </div>
            <FormField label="Phone">
              <input className="input" type="tel" value={phone}
                onChange={e => setPhone(e.target.value)} />
            </FormField>
            <FormField label="ID / Passport Number">
              <input className="input" type="text" value={idNumber}
                onChange={e => setIdNumber(e.target.value)} />
            </FormField>
            <FormField label="Email">
              <p className="text-[13px] text-text-disabled py-2 px-3 bg-surface-elevated rounded-lg border border-divider">
                {employee?.email ?? '—'}
              </p>
            </FormField>
            <FormField label="Employment Type">
              <p className="text-[13px] text-text-disabled py-2 px-3 bg-surface-elevated rounded-lg border border-divider capitalize">
                {employee?.employment_type ?? '—'}
              </p>
            </FormField>
          </div>
        </div>

        {/* Banking Details */}
        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Banking Details</p>
            <p className="text-[11px] text-text-disabled mt-0.5">
              Changes to banking details are logged for security
            </p>
          </div>
          <div className="p-4 space-y-4">
            <FormField label="Bank Name">
              <input className="input" type="text" value={bankName}
                onChange={e => setBankName(e.target.value)} />
            </FormField>
            <FormField label="Account Number">
              <input className="input" type="text" value={accountNumber}
                onChange={e => setAccountNumber(e.target.value)} />
            </FormField>
            <FormField label="Branch Code">
              <input className="input" type="text" value={branchCode}
                onChange={e => setBranchCode(e.target.value)} />
            </FormField>
          </div>
        </div>

        {/* Save button inside scroll area */}
        <button
          onClick={save}
          disabled={saving}
          className="w-full h-12 rounded-xl font-bold text-[15px] text-white bg-primary disabled:opacity-50 hover:bg-primary-dark transition-colors"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>

        {/* Bottom padding for mobile */}
        <div className="h-4" />

      </div>
    </div>
  )
}
