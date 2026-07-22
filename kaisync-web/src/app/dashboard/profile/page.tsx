'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getCodeSession } from '@/lib/auth/code-session'
import { prepareMediaUpload, consumeMediaUpload } from '@/lib/job-media'
import { loadCompanyWorkspace, moduleFlagsForCompany } from '@/lib/employee-workspace'
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

function trimOrNull(value: string): string | null {
  const t = value.trim()
  return t === '' ? null : t
}

type ProfileRpcRow = {
  name?: string | null
  surname?: string | null
  email?: string | null
  phone?: string | null
  id_number?: string | null
  position?: string | null
  employment_type?: string | null
  employment_type_label?: string | null
  bank_name?: string | null
  bank_account?: string | null
  bank_branch_code?: string | null
  profile_photo_url?: string | null
  date_of_birth?: string | null
  access_level?: string | null
}

type EmployeeWithDob = Employee & { date_of_birth?: string | null }

function thinFromCodeSession(): EmployeeWithDob | null {
  const cs = getCodeSession()
  if (!cs?.employee) return null
  return {
    name: cs.employee.name ?? null,
    surname: cs.employee.surname ?? null,
    position: cs.employee.position ?? null,
    access_level: cs.employee.access_level ?? null,
    phone: null,
    id_number: null,
    bank_name: null,
    bank_account: null,
    bank_branch_code: null,
    email: null,
    employment_type: null,
    profile_photo_url: null,
    date_of_birth: null,
  } as unknown as EmployeeWithDob
}

function fromRpcRow(p: ProfileRpcRow): EmployeeWithDob {
  return {
    name: p.name ?? null,
    surname: p.surname ?? null,
    email: p.email ?? null,
    phone: p.phone ?? null,
    id_number: p.id_number ?? null,
    position: p.position ?? null,
    employment_type: p.employment_type_label ?? p.employment_type ?? null,
    bank_name: p.bank_name ?? null,
    bank_account: p.bank_account ?? null,
    bank_branch_code: p.bank_branch_code ?? null,
    profile_photo_url: p.profile_photo_url ?? null,
    date_of_birth: p.date_of_birth ?? null,
    access_level: p.access_level ?? null,
  } as unknown as EmployeeWithDob
}

function applyForm(
  emp: EmployeeWithDob,
  set: {
    setEmployee: (e: Employee) => void
    setFirstName: (v: string) => void
    setLastName: (v: string) => void
    setPhone: (v: string) => void
    setIdNumber: (v: string) => void
    setBankName: (v: string) => void
    setAccountNumber: (v: string) => void
    setBranchCode: (v: string) => void
  },
) {
  set.setEmployee(emp)
  set.setFirstName(emp.name ?? '')
  set.setLastName(emp.surname ?? '')
  set.setPhone(emp.phone ?? '')
  set.setIdNumber(emp.id_number ?? '')
  set.setBankName(emp.bank_name ?? '')
  set.setAccountNumber(emp.bank_account ?? '')
  set.setBranchCode(emp.bank_branch_code ?? '')
}

async function resolvePhotoUrl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  path: string | null | undefined,
  setPhotoUrl: (url: string | null) => void,
) {
  if (!path) {
    setPhotoUrl(null)
    return
  }
  const { data: signed } = await supabase.storage
    .from('workforce-media')
    .createSignedUrl(path, 3600)
  setPhotoUrl(signed?.signedUrl ?? null)
}

export default function ProfilePage() {
  const [employee, setEmployee]   = useState<Employee | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [empId, setEmpId]         = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [notLinked,    setNotLinked]    = useState(false)
  const [companyName,  setCompanyName]  = useState<string>('')

  const [photoUrl,       setPhotoUrl]       = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError,     setPhotoError]     = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const tokRef        = useRef<string | null>(null)

  const [firstName,   setFirstName]   = useState('')
  const [lastName,    setLastName]    = useState('')
  const [phone,       setPhone]       = useState('')
  const [idNumber,    setIdNumber]    = useState('')

  const [bankName,       setBankName]       = useState('')
  const [accountNumber,  setAccountNumber]  = useState('')
  const [branchCode,     setBranchCode]     = useState('')
  const [showPayroll,    setShowPayroll]    = useState(true)
  const [showLeave,      setShowLeave]      = useState(true)

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setNotLinked(true); setLoading(false); return }

    setCompanyId(member.companyId)
    setEmpId(member.employeeId)

    const company = await loadCompanyWorkspace(supabase, member.companyId)
    const flags = moduleFlagsForCompany(company)
    setShowPayroll(flags.payroll)
    setShowLeave(flags.leave)
    if (company?.name) setCompanyName(company.name)

    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    tokRef.current = tok

    const formSetters = {
      setEmployee,
      setFirstName,
      setLastName,
      setPhone,
      setIdNumber,
      setBankName,
      setAccountNumber,
      setBranchCode,
    }

    const isCodeAuth = member.sessionToken !== null
    let loaded: EmployeeWithDob | null = null

    // 1) Try employees table (may fail RLS for code-auth)
    const { data: empRow } = await supabase
      .from('employees')
      .select('*')
      .eq('id', member.employeeId)
      .eq('company_id', member.companyId)
      .maybeSingle()

    if (empRow) {
      loaded = empRow as EmployeeWithDob
    } else {
      // 2) Fall back to employee_get_profile with session token
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rpcData, error: rpcErr } = await (supabase.rpc as any)('employee_get_profile', {
          p_employee_id:   member.employeeId,
          p_company_id:    member.companyId,
          p_session_token: tok,
        })
        if (!rpcErr && rpcData) {
          const p = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as ProfileRpcRow | null
          if (p) loaded = fromRpcRow(p)
        }
      } catch {
        // RPC may be missing
      }
    }

    // 3) Code-auth: seed names from kf_cs when still thin
    if (!loaded && isCodeAuth) {
      loaded = thinFromCodeSession()
    } else if (loaded && isCodeAuth) {
      const cs = getCodeSession()
      if (cs?.employee) {
        if (!loaded.name) loaded = { ...loaded, name: cs.employee.name ?? loaded.name }
        if (!loaded.surname) loaded = { ...loaded, surname: cs.employee.surname ?? loaded.surname }
        if (!loaded.position) loaded = { ...loaded, position: cs.employee.position ?? loaded.position }
        if (!loaded.access_level) {
          loaded = { ...loaded, access_level: (cs.employee.access_level ?? loaded.access_level) as Employee['access_level'] }
        }
      }
    }

    if (loaded) {
      applyForm(loaded, formSetters)
      await resolvePhotoUrl(supabase, loaded.profile_photo_url, setPhotoUrl)
    }

    if (isCodeAuth) {
      const cs = getCodeSession()
      if (cs?.company?.name) setCompanyName(cs.company.name)
    } else {
      const { data: companyRow } = await supabase
        .from('companies')
        .select('name')
        .eq('id', member.companyId)
        .maybeSingle()
      if (companyRow?.name) setCompanyName(companyRow.name)
    }

    setLoading(false)
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !empId || !companyId) return
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      setPhotoError('Only JPEG, PNG or WebP images are allowed.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError('Image must be under 5 MB.')
      return
    }
    setPhotoUploading(true)
    setPhotoError(null)
    const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const path = `profile-photos/${companyId}/${empId}.${ext}`
    const supabase = createClient()
    const sessionToken = tokRef.current

    await prepareMediaUpload(supabase, companyId, empId, path, 'profile_photo', sessionToken)

    const { error: upErr } = await supabase.storage
      .from('workforce-media')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) { setPhotoError(upErr.message); setPhotoUploading(false); return }

    await consumeMediaUpload(supabase, companyId, empId, path, sessionToken)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rpcErr } = await (supabase.rpc as any)('employee_update_profile', {
      p_employee_id:       empId,
      p_company_id:        companyId,
      p_profile_photo_url: path,
      p_session_token:     tokRef.current,
    })
    if (rpcErr) { setPhotoError(rpcErr.message); setPhotoUploading(false); return }
    const { data: signed } = await supabase.storage
      .from('workforce-media')
      .createSignedUrl(path, 3600)
    if (signed?.signedUrl) setPhotoUrl(signed.signedUrl)
    await init()
    setPhotoUploading(false)
  }

  async function save() {
    if (!companyId || !empId) return
    setSaving(true)
    setSaved(false)
    setSaveError(null)

    const baseline = employee
    const supabase = createClient()

    const nextFirst  = trimOrNull(firstName)
    const nextLast   = trimOrNull(lastName)
    const nextPhone  = trimOrNull(phone)
    const nextId     = trimOrNull(idNumber)
    const nextBank   = trimOrNull(bankName)
    const nextAcct   = trimOrNull(accountNumber)
    const nextBranch = trimOrNull(branchCode)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('employee_update_profile', {
      p_employee_id:      empId,
      p_company_id:       companyId,
      p_first_name:       firstName.trim() !== (baseline?.name ?? '') ? nextFirst : null,
      p_last_name:        lastName.trim() !== (baseline?.surname ?? '') ? nextLast : null,
      p_phone:            phone.trim() !== (baseline?.phone ?? '') ? nextPhone : null,
      p_id_number:        idNumber.trim() !== (baseline?.id_number ?? '') ? nextId : null,
      p_bank_name:        bankName.trim() !== (baseline?.bank_name ?? '') ? nextBank : null,
      p_bank_account:     accountNumber.trim() !== (baseline?.bank_account ?? '') ? nextAcct : null,
      p_bank_branch_code: branchCode.trim() !== (baseline?.bank_branch_code ?? '') ? nextBranch : null,
      p_session_token:    tokRef.current,
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

  const fullName = `${firstName} ${lastName}`.trim()
    || (employee ? `${employee.name ?? ''} ${employee.surname ?? ''}`.trim() : '—')
  const empDob = (employee as EmployeeWithDob | null)?.date_of_birth

  const isDirty =
    firstName.trim()     !== (employee?.name             ?? '').trim() ||
    lastName.trim()      !== (employee?.surname          ?? '').trim() ||
    phone.trim()         !== (employee?.phone            ?? '').trim() ||
    idNumber.trim()      !== (employee?.id_number        ?? '').trim() ||
    bankName.trim()      !== (employee?.bank_name        ?? '').trim() ||
    accountNumber.trim() !== (employee?.bank_account     ?? '').trim() ||
    branchCode.trim()    !== (employee?.bank_branch_code ?? '').trim()

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">My Profile</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl">

        <div className="bg-surface border border-divider rounded-xl p-4 flex items-center gap-4">
          <div className="relative shrink-0">
            <div
              className="w-16 h-16 rounded-full overflow-hidden cursor-pointer"
              onClick={() => !photoUploading && photoInputRef.current?.click()}
            >
              {photoUrl ? (
                <img src={photoUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-primary flex items-center justify-center">
                  <span className="text-white text-[22px] font-bold">{getInitials(fullName)}</span>
                </div>
              )}
            </div>
            <button
              onClick={() => !photoUploading && photoInputRef.current?.click()}
              disabled={photoUploading}
              className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-primary border-2 border-surface flex items-center justify-center disabled:opacity-50 hover:bg-primary-dark transition-colors"
              title="Change photo"
            >
              {photoUploading ? (
                <span className="material-icons text-white animate-spin text-[12px]">refresh</span>
              ) : (
                <span className="material-icons text-white text-[12px]">photo_camera</span>
              )}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handlePhotoUpload}
            />
          </div>
          <div className="min-w-0 flex-1">
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
            <p className="text-[11px] text-text-disabled mt-1.5">Tap photo to change</p>
          </div>
        </div>

        {photoError && (
          <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
            <p className="text-[13px] font-semibold text-error">{photoError}</p>
          </div>
        )}

        {saved && (
          <div className="rounded-xl px-4 py-3 bg-success-dark border border-success/30 flex items-center gap-2">
            <span className="material-icons text-success text-[18px]">check_circle</span>
            <p className="text-[13px] font-semibold text-success">Your profile has been updated.</p>
          </div>
        )}

        {saveError && (
          <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
            <p className="text-[13px] font-semibold text-error">{saveError}</p>
          </div>
        )}

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
            <FormField label="Date of Birth">
              <p className="text-[13px] text-text-disabled py-2 px-3 bg-surface-elevated rounded-lg border border-divider">
                {empDob
                  ? new Date(`${empDob}T12:00:00`).toLocaleDateString(
                      'en-ZA', { day: '2-digit', month: 'long', year: 'numeric' },
                    )
                  : '—'}
              </p>
            </FormField>
            <FormField label="Email">
              <p className="text-[13px] text-text-disabled py-2 px-3 bg-surface-elevated rounded-lg border border-divider">
                {employee?.email ?? '—'}
              </p>
            </FormField>
            <FormField label="Position">
              <p className="text-[13px] text-text-disabled py-2 px-3 bg-surface-elevated rounded-lg border border-divider">
                {employee?.position ?? '—'}
              </p>
            </FormField>
            <FormField label="Employment Type">
              <p className="text-[13px] text-text-disabled py-2 px-3 bg-surface-elevated rounded-lg border border-divider capitalize">
                {employee?.employment_type ?? '—'}
              </p>
            </FormField>
          </div>
        </div>

        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Banking Details</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="material-icons text-[13px] text-text-disabled">lock</span>
              <p className="text-[11px] text-text-disabled">
                Banking details for {companyName || 'your company'}
              </p>
            </div>
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

        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">My Record</p>
          </div>
          <div className="divide-y divide-divider">
            {[
              ...(showPayroll ? [{ label: 'My Payslips',  href: '/dashboard/employee/payslips',  icon: 'payments' }] : []),
              ...(showLeave ? [{ label: 'My Leave',     href: '/dashboard/employee/leave',      icon: 'event_available' }] : []),
              { label: 'My Documents', href: '/dashboard/employee/documents',  icon: 'folder' },
            ].map(item => (
              <Link key={item.href} href={item.href}
                className="flex items-center justify-between px-4 py-3 hover:bg-surface-elevated transition-colors">
                <div className="flex items-center gap-3">
                  <span className="material-icons text-text-secondary text-[20px]">{item.icon}</span>
                  <p className="text-[14px] font-medium text-text-primary">{item.label}</p>
                </div>
                <span className="material-icons text-text-disabled text-[18px]">chevron_right</span>
              </Link>
            ))}
          </div>
        </div>

        <button
          onClick={save}
          disabled={saving || !isDirty || !empId || !companyId}
          className="w-full h-12 rounded-xl font-bold text-[15px] transition-colors disabled:cursor-not-allowed"
          style={{
            backgroundColor: isDirty ? 'var(--color-primary)' : 'var(--color-surface-elevated)',
            color: isDirty ? '#ffffff' : 'var(--color-text-disabled)',
            border: isDirty ? 'none' : '1px solid var(--color-divider)',
          }}
        >
          {saving ? 'Saving…' : isDirty ? 'Save Changes' : 'No Changes'}
        </button>

        <div className="h-4" />
      </div>
    </div>
  )
}
