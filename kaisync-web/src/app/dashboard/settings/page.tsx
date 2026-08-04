'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { formatDateTime } from '@/lib/utils'
import {
  COMPANY_MODULE_SPECS,
  buildEnabledModulesMap,
  isModuleEnabled,
  type EnabledModules,
} from '@/lib/company-modules'
import type { Company, Employee, SecuritySettings, AuditEvent } from '@/types/database'
import { formatZar, loadCompanyBillingSummary, type BillingSummary } from '@/lib/billing'

// ─── Local types ──────────────────────────────────────────────────────────────

// Branch has more columns in DB than the exported Branch type
type BranchRow = {
  id: string
  company_id: string
  name: string
  is_active: boolean
}

type HrEmployee = Pick<Employee, 'id' | 'name' | 'surname' | 'email' | 'access_level'>

type SettingsTab =
  | 'general'
  | 'billing'
  | 'modules'
  | 'security'
  | 'organisation'
  | 'integrations'
  | 'advanced'

const SETTINGS_TABS: { key: SettingsTab; label: string; hrOnly?: boolean }[] = [
  { key: 'general', label: 'General' },
  { key: 'billing', label: 'Billing', hrOnly: true },
  { key: 'modules', label: 'Modules' },
  { key: 'security', label: 'Security' },
  { key: 'organisation', label: 'Organisation', hrOnly: true },
  { key: 'integrations', label: 'Integrations' },
  { key: 'advanced', label: 'Advanced' },
]

function parseSettingsTab(raw: string | null): SettingsTab | null {
  if (!raw) return null
  const key = raw.toLowerCase() as SettingsTab
  return SETTINGS_TABS.some(t => t.key === key) ? key : null
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [company,     setCompany]     = useState<Company | null>(null)
  const [employee,    setEmployee]    = useState<Employee | null>(null)
  const [security,    setSecurity]    = useState<SecuritySettings | null>(null)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [saving,      setSaving]      = useState<string | null>(null)
  const [companyId,   setCompanyId]   = useState<string | null>(null)
  const [myEmpId,     setMyEmpId]     = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [industry,    setIndustry]    = useState('')

  // ── Branch state ─────────────────────────────────────────────────────────
  const [branches,         setBranches]         = useState<BranchRow[]>([])
  const [newBranchName,    setNewBranchName]    = useState('')
  const [editingBranchId,  setEditingBranchId]  = useState<string | null>(null)
  const [editBranchName,   setEditBranchName]   = useState('')
  const [branchBusy,       setBranchBusy]       = useState(false)

  // ── HR user state ─────────────────────────────────────────────────────────
  const [hrAdmins,         setHrAdmins]         = useState<HrEmployee[]>([])
  const [allEmployees,     setAllEmployees]      = useState<HrEmployee[]>([])
  const [promoteEmployeeId, setPromoteEmployeeId] = useState('')
  const [hrBusy,           setHrBusy]           = useState(false)
  const [enabledModules,   setEnabledModules]   = useState<EnabledModules>({})
  const [modulesBusy,      setModulesBusy]      = useState(false)
  const [modulesMsg,       setModulesMsg]       = useState<string | null>(null)

  // ── Xero state ─────────────────────────────────────────────────────────
  const [xeroConn,           setXeroConn]           = useState<{ tenant_name: string | null } | null>(null)
  const [xeroConnected,      setXeroConnected]      = useState(false)
  const [xeroConnecting,     setXeroConnecting]     = useState(false)
  const [xeroSyncing,        setXeroSyncing]        = useState(false)
  const [xeroPushing,        setXeroPushing]        = useState(false)
  const [xeroMsg,            setXeroMsg]            = useState<string | null>(null)
  const [payrollPeriodStart, setPayrollPeriodStart] = useState('')
  const [payrollPeriodEnd,   setPayrollPeriodEnd]   = useState('')

  // ── Billing ─────────────────────────────────────────────────────────────
  const [billing, setBilling] = useState<BillingSummary | null>(null)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [billingLoading, setBillingLoading] = useState(false)

  const [tab, setTab] = useState<SettingsTab>('general')

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    const fromQuery = parseSettingsTab(p.get('tab'))
    if (fromQuery) setTab(fromQuery)
    const s = p.get('xero')
    if (s === 'connected') {
      setXeroMsg('Xero connected successfully.')
      setTab('integrations')
    }
    if (s === 'error') {
      setXeroMsg('Xero connection failed. Please try again.')
      setTab('integrations')
    }
  }, [])

  function selectTab(next: SettingsTab) {
    setTab(next)
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.set('tab', next)
    window.history.replaceState({}, '', url.toString())
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  async function load() {
    const supabase = createClient()
    const member   = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }

    setCompanyId(member.companyId)
    setMyEmpId(member.employeeId)

    const { data: empData } = await supabase
      .from('employees')
      .select('*, companies(*)')
      .eq('id', member.employeeId)
      .maybeSingle()

    if (!empData) { setLoading(false); return }
    setEmployee(empData as Employee)
    const co = (empData as { companies: Company }).companies
    setCompany(co)
    setCompanyName(co.name)
    setIndustry(co.industry ?? '')
    setEnabledModules((co as Company).enabled_modules ?? {})

    const [secRes, auditRes, branchRes, allEmpRes] = await Promise.all([
      supabase.from('security_settings').select('*').eq('company_id', member.companyId).maybeSingle(),
      supabase.from('audit_events').select('*').eq('company_id', member.companyId)
        .order('created_at', { ascending: false }).limit(20),
      supabase.from('branches').select('id, company_id, name, is_active')
        .eq('company_id', member.companyId).order('name'),
      supabase.from('employees').select('id, name, surname, email, access_level')
        .eq('company_id', member.companyId).eq('is_active', true).order('name'),
    ])

    // Prefer explicit enabled_modules column if nested select omitted it
    if (!(co as Company).enabled_modules) {
      const { data: coRow } = await supabase
        .from('companies')
        .select('enabled_modules')
        .eq('id', member.companyId)
        .maybeSingle()
      if (coRow?.enabled_modules) setEnabledModules(coRow.enabled_modules as EnabledModules)
    }

    setSecurity(secRes.data as SecuritySettings | null)
    setAuditEvents((auditRes.data ?? []) as AuditEvent[])
    setBranches((branchRes.data ?? []) as BranchRow[])

    const emps = (allEmpRes.data ?? []) as HrEmployee[]
    setAllEmployees(emps)
    setHrAdmins(emps.filter(e => ['owner', 'hr', 'manager'].includes(e.access_level)))

    await loadXero(member.companyId)
    await loadBilling(member.companyId)
    setLoading(false)
  }

  async function loadBilling(cId: string) {
    setBillingLoading(true)
    setBillingError(null)
    const supabase = createClient()
    const res = await loadCompanyBillingSummary(supabase, cId)
    if (!res.ok) {
      setBilling(null)
      setBillingError(res.message)
    } else {
      setBilling(res.summary)
    }
    setBillingLoading(false)
  }

  async function loadXero(cId: string) {
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('get_xero_connection_status', { p_company_id: cId })
    if (data) {
      setXeroConnected(data.connected ?? false)
      setXeroConn(data.connected ? { tenant_name: data.tenant_name ?? null } : null)
    }
  }

  // ── Company settings ──────────────────────────────────────────────────────

  async function saveCompanyName() {
    if (!company || !companyName.trim()) return
    setSaving('company')
    const supabase = createClient()
    await supabase.from('companies').update({ name: companyName.trim(), industry: industry || null })
      .eq('id', company.id)
    await load()
    setSaving(null)
  }

  function toggleModule(key: string, value: boolean) {
    setEnabledModules(prev => buildEnabledModulesMap(prev, { [key]: value }))
    setModulesMsg(null)
  }

  async function saveModules() {
    if (!company || !isHrOrAbove) return
    setModulesBusy(true)
    setModulesMsg(null)
    const supabase = createClient()
    const payload = buildEnabledModulesMap(enabledModules, {})
    const { error: e } = await supabase
      .from('companies')
      .update({ enabled_modules: payload })
      .eq('id', company.id)
    if (e) {
      setModulesMsg(e.message || 'Failed to save modules')
      setModulesBusy(false)
      return
    }
    setEnabledModules(payload)
    setModulesMsg('Modules saved. Sidebar updates on next navigation refresh.')
    setModulesBusy(false)
  }

  async function rotatePortalCode(type: 'employee' | 'contractor') {
    if (!company) return
    setSaving(`rotate_${type}`)
    const supabase = createClient()
    await supabase.rpc('rotate_portal_code', { p_company_id: company.id, p_code_type: type })
    await load()
    setSaving(null)
  }

  async function toggleSecurity(field: keyof SecuritySettings, value: boolean) {
    if (!security || !company) return
    setSaving(field as string)
    const supabase = createClient()
    await supabase.from('security_settings').update({ [field]: value }).eq('company_id', company.id)
    setSecurity(prev => prev ? { ...prev, [field]: value } : null)
    setSaving(null)
  }

  // ── Branch management ─────────────────────────────────────────────────────

  async function createBranch() {
    if (!newBranchName.trim() || !companyId) return
    setBranchBusy(true)
    const supabase = createClient()
    const { error: e } = await supabase.from('branches').insert({
      company_id:    companyId,
      name:          newBranchName.trim(),
      is_active:     true,
      radius_meters: 100,
    })
    if (!e) {
      setNewBranchName('')
      const { data } = await supabase.from('branches').select('id, company_id, name, is_active')
        .eq('company_id', companyId).order('name')
      setBranches((data ?? []) as BranchRow[])
    }
    setBranchBusy(false)
  }

  async function renameBranch(branchId: string) {
    if (!editBranchName.trim() || !companyId) return
    setBranchBusy(true)
    const supabase = createClient()
    await supabase.from('branches').update({ name: editBranchName.trim() }).eq('id', branchId)
    setEditingBranchId(null)
    const { data } = await supabase.from('branches').select('id, company_id, name, is_active')
      .eq('company_id', companyId).order('name')
    setBranches((data ?? []) as BranchRow[])
    setBranchBusy(false)
  }

  async function deleteBranch(branchId: string) {
    if (!window.confirm('Delete this branch? Employees in this branch will be unassigned.')) return
    if (!companyId) return
    setBranchBusy(true)
    const supabase = createClient()
    await supabase.from('branches').delete().eq('id', branchId)
    const { data } = await supabase.from('branches').select('id, company_id, name, is_active')
      .eq('company_id', companyId).order('name')
    setBranches((data ?? []) as BranchRow[])
    setBranchBusy(false)
  }

  // ── HR user management ────────────────────────────────────────────────────

  async function promoteToAdmin() {
    if (!promoteEmployeeId || !companyId) return
    setHrBusy(true)
    const supabase = createClient()
    await supabase.rpc('set_employee_role', {
      p_company_id:  companyId,
      p_employee_id: promoteEmployeeId,
      p_new_role:    'hr',
    })
    setPromoteEmployeeId('')
    const { data } = await supabase.from('employees').select('id, name, surname, email, access_level')
      .eq('company_id', companyId).eq('is_active', true).order('name')
    const emps = (data ?? []) as HrEmployee[]
    setAllEmployees(emps)
    setHrAdmins(emps.filter(e => ['owner', 'hr', 'manager'].includes(e.access_level)))
    setHrBusy(false)
  }

  async function demoteFromAdmin(empId: string) {
    if (empId === myEmpId) return // self-demotion guard
    if (!window.confirm('Remove HR admin access for this employee?')) return
    if (!companyId) return
    setHrBusy(true)
    const supabase = createClient()
    await supabase.rpc('set_employee_role', {
      p_company_id:  companyId,
      p_employee_id: empId,
      p_new_role:    'employee',
    })
    const { data } = await supabase.from('employees').select('id, name, surname, email, access_level')
      .eq('company_id', companyId).eq('is_active', true).order('name')
    const emps = (data ?? []) as HrEmployee[]
    setAllEmployees(emps)
    setHrAdmins(emps.filter(e => ['owner', 'hr', 'manager'].includes(e.access_level)))
    setHrBusy(false)
  }

  // ── Xero ─────────────────────────────────────────────────────────────────

  async function connectXero() {
    if (!companyId) return
    setXeroConnecting(true)
    setXeroMsg(null)
    const supabase = createClient()
    const tok = (await supabase.auth.getSession()).data.session?.access_token ?? ''
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-oauth-start`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      },
    )
    const data = await res.json()
    if (data.auth_url) {
      window.location.href = data.auth_url
    } else {
      setXeroMsg(data.error ?? 'Failed to start Xero connection.')
      setXeroConnecting(false)
    }
  }

  async function syncXeroContacts() {
    if (!companyId) return
    setXeroSyncing(true)
    setXeroMsg(null)
    const supabase = createClient()
    const tok = (await supabase.auth.getSession()).data.session?.access_token ?? ''
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      },
    )
    const data = await res.json()
    setXeroMsg(res.ok ? `Synced ${data.synced} contacts to Xero.` : (data.error ?? 'Sync failed.'))
    setXeroSyncing(false)
  }

  async function pushPayroll() {
    if (!companyId || !payrollPeriodStart || !payrollPeriodEnd) {
      setXeroMsg('Select a pay period first.')
      return
    }
    setXeroPushing(true)
    setXeroMsg(null)
    const supabase = createClient()
    const tok = (await supabase.auth.getSession()).data.session?.access_token ?? ''
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-push-payroll`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id:   companyId,
          period_start: payrollPeriodStart,
          period_end:   payrollPeriodEnd,
        }),
      },
    )
    const data = await res.json()
    setXeroMsg(res.ok
      ? (data.message ?? `Pushed ${data.pushed} payslip${data.pushed === 1 ? '' : 's'} to Xero as Draft Manual Journals.`)
      : (data.error ?? 'Push failed.'))
    setXeroPushing(false)
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const isOwner      = employee?.access_level === 'owner'
  const isHrOrAbove  = ['owner', 'manager', 'hr'].includes(employee?.access_level ?? '')
  const promotable   = allEmployees.filter(e => !hrAdmins.find(a => a.id === e.id))

  // ── Guards ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-[14px] text-text-secondary">Loading…</span>
      </div>
    )
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

  // ── Render ────────────────────────────────────────────────────────────────

  const inputCls = 'w-full h-10 px-3 bg-background border border-border rounded-lg text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30'
  const visibleTabs = SETTINGS_TABS.filter(t => !t.hrOnly || isHrOrAbove)
  const activeTab = visibleTabs.some(t => t.key === tab) ? tab : 'general'

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 sm:px-6 pt-5 pb-0 shrink-0">
        <h1 className="text-[22px] font-semibold text-text-primary mb-4">Settings</h1>
        <div className="flex gap-1 border-b border-divider overflow-x-auto">
          {visibleTabs.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              className={`h-10 px-3 sm:px-4 text-[13px] font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                activeTab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 pb-16">
        <div className="max-w-3xl">

      {activeTab === 'general' && (
        <Section title="Company" icon="business">
          <div className="flex flex-col gap-4">
            <Field label="Company Name">
              <input
                type="text"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                disabled={!isOwner}
                className="input"
              />
            </Field>
            <Field label="Industry">
              <input
                type="text"
                value={industry}
                onChange={e => setIndustry(e.target.value)}
                disabled={!isOwner}
                placeholder="e.g. Healthcare"
                className="input"
              />
            </Field>
            <Field label="Company Code">
              <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-border bg-surface-elevated text-[13px] text-text-secondary">
                <span className="font-mono">{company?.company_code ?? 'Not set'}</span>
              </div>
            </Field>
            {isOwner && (
              <button
                onClick={saveCompanyName}
                disabled={saving === 'company'}
                className="self-start h-9 px-4 rounded-md bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
              >
                {saving === 'company' ? 'Saving…' : 'Save Changes'}
              </button>
            )}
          </div>
        </Section>
      )}

      {activeTab === 'billing' && isHrOrAbove && (
        <Section title="Subscription" icon="payments">
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-text-secondary">
              Live monthly amount based on active employees, portal contractors, and active properties.
              Payment collection is handled by KaiSync — this is your current subscription estimate.
            </p>
            {billingLoading && (
              <p className="text-[13px] text-text-secondary">Calculating…</p>
            )}
            {billingError && (
              <p className="text-[13px] text-danger">{billingError}</p>
            )}
            {billing && !billingLoading && (
              <>
                <div className="rounded-lg border border-border bg-surface-elevated p-4">
                  <p className="text-[12px] text-text-secondary uppercase tracking-wide">Amount due monthly</p>
                  <p className="text-[28px] font-semibold text-text-primary mt-1">
                    {formatZar(Number(billing.monthly_charge))}
                  </p>
                  <p className="text-[13px] text-text-secondary mt-1">
                    {billing.plan_name} · status {billing.status}
                    {billing.renewal_date ? ` · renews ${billing.renewal_date}` : ''}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <MeterCard
                    label="Employees"
                    count={billing.employees.count}
                    included={billing.employees.included}
                    overage={billing.employees.overage}
                    unitPrice={billing.employees.unit_price}
                  />
                  <MeterCard
                    label="Portal contractors"
                    count={billing.contractors.count}
                    included={billing.contractors.included}
                    overage={billing.contractors.overage}
                    unitPrice={billing.contractors.unit_price}
                  />
                  <MeterCard
                    label="Properties"
                    count={billing.properties.count}
                    included={billing.properties.included}
                    overage={billing.properties.overage}
                    unitPrice={billing.properties.unit_price}
                  />
                </div>
                <div className="flex flex-col gap-2 border-t border-divider pt-3">
                  {(billing.lines ?? []).map((line, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="text-text-secondary">{line.description}</span>
                      <span className="font-medium text-text-primary shrink-0">{formatZar(Number(line.amount))}</span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => companyId && loadBilling(companyId)}
                  disabled={billingLoading}
                  className="self-start h-9 px-4 rounded-md border border-border text-[13px] font-semibold text-text-primary hover:bg-surface-elevated disabled:opacity-50"
                >
                  Refresh
                </button>
              </>
            )}
          </div>
        </Section>
      )}

      {activeTab === 'modules' && (
        <Section title="Modules" icon="extension">
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-text-secondary">
              Enable or disable company modules. Disabled modules are hidden from the HR sidebar and employee portal.
            </p>
            {COMPANY_MODULE_SPECS.map(spec => (
              <Toggle
                key={spec.key}
                label={spec.title}
                description={spec.description}
                checked={isModuleEnabled(enabledModules, spec.key, spec.defaultIfMissing)}
                onChange={v => toggleModule(spec.key, v)}
                disabled={!isHrOrAbove || modulesBusy}
              />
            ))}
            {modulesMsg && (
              <p className={`text-[12px] ${modulesMsg.includes('Failed') ? 'text-danger' : 'text-text-secondary'}`}>
                {modulesMsg}
              </p>
            )}
            {isHrOrAbove && (
              <button
                onClick={saveModules}
                disabled={modulesBusy}
                className="self-start h-9 px-4 rounded-md bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
              >
                {modulesBusy ? 'Saving…' : 'Save Modules'}
              </button>
            )}
          </div>
        </Section>
      )}

      {activeTab === 'security' && (
        <>
          <Section title="Security" icon="security">
            <div className="flex flex-col gap-4">
              <Toggle
                label="Require step-up verification for sensitive actions"
                description="Users must re-authenticate before making privileged changes."
                checked={security?.step_up_required ?? false}
                onChange={v => toggleSecurity('step_up_required', v)}
                disabled={!isOwner || saving === 'step_up_required'}
              />
              <Toggle
                label="Require portal code for punch-in"
                description="Employees must enter their portal code to clock in."
                checked={security?.require_portal_code_for_punch ?? false}
                onChange={v => toggleSecurity('require_portal_code_for_punch', v)}
                disabled={!isOwner || saving === 'require_portal_code_for_punch'}
              />
              <RowInfo label="Session timeout" value={`${security?.session_timeout_minutes ?? '—'} minutes`} />
              <RowInfo label="Lockout threshold" value={`${security?.lockout_threshold ?? '—'} failed attempts`} />
            </div>
          </Section>

          <Section title="Portal Codes" icon="vpn_key">
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-text-secondary">
                Portal codes grant employees and contractors access to the employee portal. Rotating a code
                immediately invalidates all existing sessions for that type.
              </p>
              <div className="flex items-center justify-between py-3 border-b border-divider">
                <div>
                  <p className="text-[13px] font-medium text-text-primary">Employee Portal Code</p>
                  <p className="text-[12px] text-text-secondary">Used by employees to sign in</p>
                </div>
                {isHrOrAbove && (
                  <button
                    onClick={() => rotatePortalCode('employee')}
                    disabled={saving === 'rotate_employee'}
                    className="h-8 px-3 rounded-md bg-warning-dark text-warning text-[12px] font-semibold hover:bg-amber-100 disabled:opacity-50 transition-colors"
                  >
                    {saving === 'rotate_employee' ? '…' : 'Rotate'}
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="text-[13px] font-medium text-text-primary">Contractor Portal Code</p>
                  <p className="text-[12px] text-text-secondary">Used by contractors to sign in</p>
                </div>
                {isHrOrAbove && (
                  <button
                    onClick={() => rotatePortalCode('contractor')}
                    disabled={saving === 'rotate_contractor'}
                    className="h-8 px-3 rounded-md bg-warning-dark text-warning text-[12px] font-semibold hover:bg-amber-100 disabled:opacity-50 transition-colors"
                  >
                    {saving === 'rotate_contractor' ? '…' : 'Rotate'}
                  </button>
                )}
              </div>
            </div>
          </Section>

          <Section title="Active Sessions" icon="devices">
            <p className="text-[13px] text-text-secondary">
              Session management is available in the MAUI HR app under Settings → Active Sessions.
            </p>
          </Section>
        </>
      )}

      {activeTab === 'organisation' && isHrOrAbove && (
        <>
          <Section title="Branch Management" icon="account_tree">
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-text-secondary">
                Branches are physical locations or divisions within your company. Employees can be assigned to a branch.
              </p>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newBranchName}
                  onChange={e => setNewBranchName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createBranch()}
                  placeholder="New branch name…"
                  className={inputCls}
                />
                <button
                  onClick={createBranch}
                  disabled={!newBranchName.trim() || branchBusy}
                  className="h-10 px-4 rounded-lg bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors shrink-0"
                >
                  {branchBusy ? '…' : 'Add'}
                </button>
              </div>

              {branches.length === 0 ? (
                <p className="text-[13px] text-text-disabled py-2">No branches yet.</p>
              ) : (
                <div className="border border-divider rounded-lg overflow-hidden">
                  {branches.map(branch => (
                    <div key={branch.id} className="flex items-center gap-2 px-3 py-2.5 border-b border-divider last:border-0">
                      {editingBranchId === branch.id ? (
                        <>
                          <input
                            value={editBranchName}
                            onChange={e => setEditBranchName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && renameBranch(branch.id)}
                            className="flex-1 h-8 px-2 bg-background border border-border rounded text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                            autoFocus
                          />
                          <button
                            onClick={() => renameBranch(branch.id)}
                            disabled={!editBranchName.trim() || branchBusy}
                            className="h-8 px-3 rounded text-[12px] font-semibold bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingBranchId(null)}
                            className="h-8 px-3 rounded text-[12px] text-text-secondary border border-border hover:text-text-primary transition-colors"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-[13px] text-text-primary">{branch.name}</span>
                          {!branch.is_active && (
                            <span className="text-[11px] text-text-disabled px-1.5 py-0.5 rounded bg-background border border-border">Inactive</span>
                          )}
                          <button
                            onClick={() => { setEditingBranchId(branch.id); setEditBranchName(branch.name) }}
                            className="h-8 px-3 rounded text-[12px] text-text-secondary border border-border hover:text-primary hover:border-primary transition-colors"
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => deleteBranch(branch.id)}
                            disabled={branchBusy}
                            className="h-8 px-3 rounded text-[12px] font-medium text-error border border-error/30 hover:bg-error-dark disabled:opacity-50 transition-colors"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>

          {isOwner && (
            <Section title="HR Admins" icon="admin_panel_settings">
              <div className="flex flex-col gap-3">
                <p className="text-[13px] text-text-secondary">
                  Employees with HR or manager access can manage attendance, payroll, and leave.
                </p>

                {hrAdmins.length === 0 ? (
                  <p className="text-[13px] text-text-disabled py-2">No HR admins found.</p>
                ) : (
                  <div className="border border-divider rounded-lg overflow-hidden">
                    {hrAdmins.map(emp => {
                      const isMe    = emp.id === myEmpId
                      const isOwnerRow = emp.access_level === 'owner'
                      return (
                        <div key={emp.id} className="flex items-center justify-between px-3 py-2.5 border-b border-divider last:border-0 gap-3">
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-text-primary truncate">
                              {emp.name} {emp.surname}
                              {isMe && <span className="ml-1.5 text-[11px] text-text-disabled font-normal">(you)</span>}
                            </p>
                            <p className="text-[11px] text-text-secondary">
                              {emp.email ?? '—'} · <span className="capitalize">{emp.access_level}</span>
                            </p>
                          </div>
                          {!isOwnerRow && !isMe && (
                            <button
                              onClick={() => demoteFromAdmin(emp.id)}
                              disabled={hrBusy}
                              className="h-8 px-3 rounded text-[12px] text-error border border-error/30 hover:bg-error-dark disabled:opacity-50 transition-colors shrink-0"
                            >
                              Remove admin
                            </button>
                          )}
                          {(isOwnerRow || isMe) && (
                            <span className="text-[11px] text-text-disabled shrink-0">
                              {isOwnerRow ? 'Owner' : 'Self'}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {promotable.length > 0 && (
                  <div className="flex gap-2 items-center pt-1">
                    <select
                      value={promoteEmployeeId}
                      onChange={e => setPromoteEmployeeId(e.target.value)}
                      className="flex-1 h-10 px-3 bg-background border border-border rounded-lg text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="">Select employee to promote…</option>
                      {promotable.map(e => (
                        <option key={e.id} value={e.id}>{e.name} {e.surname}</option>
                      ))}
                    </select>
                    <button
                      onClick={promoteToAdmin}
                      disabled={!promoteEmployeeId || hrBusy}
                      className="h-10 px-4 rounded-lg bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors shrink-0"
                    >
                      {hrBusy ? '…' : 'Grant HR'}
                    </button>
                  </div>
                )}
              </div>
            </Section>
          )}
        </>
      )}

      {activeTab === 'integrations' && (
        <Section title="Integrations" icon="hub">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between py-2 border-b border-divider">
              <div>
                <p className="text-[13px] font-medium text-text-primary">SAGE Payroll</p>
                <p className="text-[12px] text-text-secondary">Export payroll data to SAGE</p>
              </div>
              <p className="text-[12px] text-text-disabled italic">Configure in MAUI admin app</p>
            </div>
            <div className="flex flex-col gap-3 py-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-medium text-text-primary">Xero</p>
                  <p className="text-[12px] text-text-secondary">
                    {xeroConnected
                      ? `Connected to ${xeroConn?.tenant_name ?? 'Xero'}`
                      : 'Sync contacts and push payroll to Xero'}
                  </p>
                </div>
                {isOwner && (
                  xeroConnected ? (
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-success">
                      <span className="material-icons text-[14px]">check_circle</span>Connected
                    </span>
                  ) : (
                    <button
                      onClick={connectXero}
                      disabled={xeroConnecting}
                      className="h-8 px-3 rounded-md bg-primary text-white text-[12px] font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
                    >
                      {xeroConnecting ? 'Connecting…' : 'Connect Xero'}
                    </button>
                  )
                )}
              </div>

              {xeroConnected && isOwner && (
                <>
                  <div className="flex items-center justify-between pt-2 border-t border-divider">
                    <div>
                      <p className="text-[13px] font-medium text-text-primary">Sync Contacts</p>
                      <p className="text-[12px] text-text-secondary">Push employees and contractors to Xero</p>
                    </div>
                    <button
                      onClick={syncXeroContacts}
                      disabled={xeroSyncing}
                      className="h-8 px-3 rounded-md bg-surface border border-border text-[12px] font-semibold text-text-secondary hover:border-primary hover:text-primary disabled:opacity-50 transition-colors"
                    >
                      {xeroSyncing ? 'Syncing…' : 'Sync Now'}
                    </button>
                  </div>

                  <div className="flex flex-col gap-2 pt-2 border-t border-divider">
                    <div>
                      <p className="text-[13px] font-medium text-text-primary">Push Payroll</p>
                      <p className="text-[12px] text-text-secondary">
                        Push approved payslips as Draft Manual Journals in Xero (idempotent; accountant posts in Xero)
                      </p>
                    </div>
                    <div className="flex gap-2 items-center flex-wrap">
                      <input
                        type="date"
                        value={payrollPeriodStart}
                        onChange={e => setPayrollPeriodStart(e.target.value)}
                        className={inputCls}
                      />
                      <span className="text-[12px] text-text-disabled shrink-0">to</span>
                      <input
                        type="date"
                        value={payrollPeriodEnd}
                        onChange={e => setPayrollPeriodEnd(e.target.value)}
                        className={inputCls}
                      />
                      <button
                        onClick={pushPayroll}
                        disabled={xeroPushing || !payrollPeriodStart || !payrollPeriodEnd}
                        className="h-10 px-4 rounded-lg bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors shrink-0"
                      >
                        {xeroPushing ? '…' : 'Push'}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {xeroMsg && (
                <p className={`text-[12px] ${
                  xeroMsg.toLowerCase().includes('fail') ||
                  xeroMsg.toLowerCase().includes('error') ||
                  xeroMsg.toLowerCase().includes('failed')
                    ? 'text-error' : 'text-text-secondary'
                }`}>
                  {xeroMsg}
                </p>
              )}
            </div>
          </div>
        </Section>
      )}

      {activeTab === 'advanced' && (
        <>
          <Section title="Attendance" icon="schedule">
            <div className="flex flex-col gap-3">
              <RowInfo label="Overtime threshold" value="40 hours/week" />
              <RowInfo label="Allow self punch-in" value="Enabled" />
              <p className="text-[12px] text-text-secondary pt-1">
                Attendance settings can be configured in the MAUI admin app.
              </p>
            </div>
          </Section>

          <Section title="Leave Policies" icon="event_available">
            <div className="flex flex-col gap-3">
              <RowInfo label="Annual leave days" value="21 days" />
              <RowInfo label="Sick leave days" value="30 days" />
              <RowInfo label="Family responsibility" value="3 days" />
              <p className="text-[12px] text-text-secondary pt-1">
                Leave policies can be configured in the MAUI admin app.
              </p>
            </div>
          </Section>

          <Section title="Payroll" icon="payments">
            <div className="flex flex-col gap-3">
              <RowInfo label="Pay period" value="Monthly" />
              <RowInfo label="Overtime multiplier" value="1.5×" />
              <p className="text-[12px] text-text-secondary pt-1">
                Full payroll configuration is under Payroll → Settings.
              </p>
            </div>
          </Section>

          <Section title="Notifications" icon="notifications">
            <p className="text-[13px] text-text-secondary">
              Email notification preferences are managed per-user in the MAUI app.
            </p>
          </Section>

          <Section title="Backup & Export" icon="backup">
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-text-secondary">
                Point-in-time recovery is enabled on your Supabase database. Full data exports can be
                triggered from the MAUI admin app.
              </p>
              <button className="self-start flex items-center gap-2 h-9 px-4 rounded-md bg-surface border border-border text-[13px] text-text-secondary font-medium hover:border-primary hover:text-primary transition-colors">
                <span className="material-icons text-[16px]">download</span>
                Request Data Export
              </button>
            </div>
          </Section>

          <Section title="Audit Log" icon="history">
            {auditEvents.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No audit events found.</p>
            ) : (
              <div className="flex flex-col">
                {auditEvents.map(ev => (
                  <div key={ev.id} className="flex items-start gap-3 py-2.5 border-b border-divider last:border-0">
                    <span className="material-icons text-text-disabled text-[16px] mt-0.5">info</span>
                    <div className="flex-1">
                      <p className="text-[12px] font-medium text-text-primary">{ev.event_type}</p>
                      {ev.target_table && (
                        <p className="text-[11px] text-text-secondary">{ev.target_table}</p>
                      )}
                    </div>
                    <p className="text-[11px] text-text-disabled shrink-0">{formatDateTime(ev.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {isOwner && (
            <Section title="Ownership Transfer" icon="swap_horiz">
              <div className="flex flex-col gap-3">
                <p className="text-[13px] text-text-secondary">
                  Transfer company ownership to another HR member or manager. This action requires step-up
                  verification and generates a one-time confirmation code.
                </p>
                <button className="self-start h-9 px-4 rounded-md bg-warning-dark text-warning text-[13px] font-semibold hover:bg-amber-100 transition-colors">
                  Initiate Ownership Transfer
                </button>
              </div>
            </Section>
          )}

          {isOwner && (
            <Section title="Danger Zone" icon="warning" danger>
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-[13px] font-medium text-text-primary">Delete Company</p>
                    <p className="text-[12px] text-text-secondary">
                      Permanently delete this company and all associated data. This cannot be undone.
                    </p>
                  </div>
                  <button
                    disabled
                    className="h-9 px-4 rounded-md bg-error-dark text-error text-[13px] font-semibold opacity-50 cursor-not-allowed"
                  >
                    Delete Company
                  </button>
                </div>
              </div>
            </Section>
          )}
        </>
      )}

        </div>
      </div>
    </div>
  )
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function Section({
  title,
  icon,
  children,
  danger,
}: {
  title: string
  icon: string
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <div className={`mb-4 bg-surface rounded-lg border overflow-hidden ${danger ? 'border-error/30' : 'border-divider'}`}>
      <div className={`flex items-center gap-2.5 px-5 py-4 border-b ${danger ? 'border-error/20 bg-error-dark/30' : 'border-divider'}`}>
        <span className={`material-icons text-[18px] ${danger ? 'text-error' : 'text-text-secondary'}`}>
          {icon}
        </span>
        <h2 className={`text-[14px] font-semibold ${danger ? 'text-error' : 'text-text-primary'}`}>{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-text-secondary mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-divider last:border-0">
      <div className="flex-1">
        <p className="text-[13px] font-medium text-text-primary">{label}</p>
        <p className="text-[12px] text-text-secondary mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        aria-checked={checked}
        role="switch"
        className={`relative w-10 h-5.5 rounded-pill transition-colors shrink-0 mt-0.5 disabled:opacity-50 ${checked ? 'bg-primary' : 'bg-border'}`}
        style={{ height: '22px', width: '40px' }}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0'}`}
          style={{ width: '18px', height: '18px' }}
        />
      </button>
    </div>
  )
}

function RowInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-divider last:border-0">
      <p className="text-[13px] text-text-secondary">{label}</p>
      <p className="text-[13px] font-medium text-text-primary">{value}</p>
    </div>
  )
}

function MeterCard({
  label,
  count,
  included,
  overage,
  unitPrice,
}: {
  label: string
  count: number
  included: number
  overage: number
  unitPrice: number
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[12px] text-text-secondary">{label}</p>
      <p className="text-[18px] font-semibold text-text-primary mt-0.5">
        {count} <span className="text-[12px] font-normal text-text-secondary">/ {included} included</span>
      </p>
      <p className="text-[11px] text-text-secondary mt-1">
        {overage > 0
          ? `${overage} over · ${formatZar(unitPrice)} each`
          : `Within included · then ${formatZar(unitPrice)}`}
      </p>
    </div>
  )
}
