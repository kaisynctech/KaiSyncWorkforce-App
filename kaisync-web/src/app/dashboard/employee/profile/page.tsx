'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface ProfileData {
  name: string | null
  surname: string | null
  email: string | null
  phone: string | null
  id_number: string | null
  position: string | null
  employment_type: string | null
  employment_type_label: string | null
  bank_account: string | null
  bank_name: string | null
  bank_branch_code: string | null
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">{label}</p>
      <p className="text-[13px] text-text-primary">{value || '—'}</p>
    </div>
  )
}

export default function EmployeeProfilePage() {
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [toast,      setToast]      = useState<string | null>(null)
  const [error,      setError]      = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('')

  // Read-only
  const [fullName,        setFullName]        = useState('')
  const [email,           setEmail]           = useState('')
  const [position,        setPosition]        = useState('')
  const [employmentType,  setEmploymentType]  = useState('')

  // Editable
  const [phone,          setPhone]          = useState('')
  const [idNumber,       setIdNumber]       = useState('')
  const [bankName,       setBankName]       = useState('')
  const [bankAccount,    setBankAccount]    = useState('')
  const [bankBranchCode, setBankBranchCode] = useState('')

  const empIdRef  = useRef<string | null>(null)
  const compIdRef = useRef<string | null>(null)
  const tokRef    = useRef<string | null>(null)

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    empIdRef.current  = member.employeeId
    compIdRef.current = member.companyId

    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    tokRef.current = tok

    // Company name: code-auth reads from kf_cs; JWT uses RPC result or direct query
    if (member.sessionToken !== null) {
      try {
        const kfcs = JSON.parse(localStorage.getItem('kf_cs') ?? '{}')
        if (kfcs.company?.name) setCompanyName(kfcs.company.name)
      } catch { /* ignore */ }
    } else {
      try {
        const { data: co } = await supabase.from('companies').select('name')
          .eq('id', member.companyId).maybeSingle()
        if (co?.name) setCompanyName(co.name)
      } catch { /* ignore */ }
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: rpcErr } = await (supabase.rpc as any)('employee_get_profile', {
        p_employee_id:   member.employeeId,
        p_company_id:    member.companyId,
        p_session_token: tok,
      })
      if (rpcErr) throw rpcErr
      const p = data as ProfileData | null
      if (p) {
        setFullName(`${p.name ?? ''} ${p.surname ?? ''}`.trim())
        setEmail(p.email ?? '')
        setPosition(p.position ?? '')
        setEmploymentType(p.employment_type_label ?? p.employment_type ?? '')
        setPhone(p.phone ?? '')
        setIdNumber(p.id_number ?? '')
        setBankName(p.bank_name ?? '')
        setBankAccount(p.bank_account ?? '')
        setBankBranchCode(p.bank_branch_code ?? '')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load profile.')
    }
    setLoading(false)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function save() {
    const empId  = empIdRef.current
    const compId = compIdRef.current
    if (!empId || !compId) return
    setSaving(true)
    setError(null)
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('employee_update_profile', {
        p_employee_id:      empId,
        p_company_id:       compId,
        p_first_name:       null,
        p_last_name:        null,
        p_phone:            phone          || null,
        p_id_number:        idNumber       || null,
        p_bank_account:     bankAccount    || null,
        p_bank_name:        bankName       || null,
        p_bank_branch_code: bankBranchCode || null,
        p_session_token:    tokRef.current,
      })
      if (rpcErr) throw rpcErr
      showToast('Saved')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save profile.')
    }
    setSaving(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">My Profile</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl">
        {error && (
          <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
            <p className="text-[13px] text-error font-semibold">{error}</p>
          </div>
        )}
        {toast && (
          <div className="rounded-xl px-4 py-3 bg-success/10 border border-success/30">
            <p className="text-[13px] text-success font-semibold">{toast}</p>
          </div>
        )}

        {/* Personal Info — read-only */}
        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Personal Info</p>
          </div>
          <div className="p-4 space-y-3">
            <InfoRow label="Full Name"       value={fullName} />
            <InfoRow label="Email"           value={email} />
            <InfoRow label="Position"        value={position} />
            <InfoRow label="Employment Type" value={employmentType} />
          </div>
        </div>

        {/* Contact — editable */}
        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Contact</p>
          </div>
          <div className="p-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Phone Number</label>
              <input className="input" type="tel" value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="e.g. +27 82 000 0000" />
            </div>
          </div>
        </div>

        {/* Identity — editable */}
        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Identity</p>
          </div>
          <div className="p-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">ID Number</label>
              <input className="input" type="text" value={idNumber}
                onChange={e => setIdNumber(e.target.value)}
                placeholder="Identity or passport number" />
            </div>
          </div>
        </div>

        {/* Banking — editable */}
        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">
              Banking Details{companyName ? ` for ${companyName}` : ''}
            </p>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Bank Name</label>
              <input className="input" type="text" value={bankName}
                onChange={e => setBankName(e.target.value)}
                placeholder="e.g. FNB, ABSA, Standard Bank" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Account Number</label>
              <input className="input" type="text" value={bankAccount}
                onChange={e => setBankAccount(e.target.value)}
                placeholder="Bank account number" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Branch Code</label>
              <input className="input" type="text" value={bankBranchCode}
                onChange={e => setBankBranchCode(e.target.value)}
                placeholder="6-digit branch code" />
            </div>
          </div>
        </div>

        <button onClick={save} disabled={saving}
          className="w-full h-12 rounded-xl bg-primary text-white font-bold text-[15px] hover:bg-primary-dark transition-colors disabled:opacity-60">
          {saving ? 'Saving…' : 'Save Changes'}
        </button>

        <div className="h-4" />
      </div>
    </div>
  )
}
