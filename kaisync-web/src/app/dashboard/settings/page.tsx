'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime } from '@/lib/utils'
import type { Company, Employee, SecuritySettings, AuditEvent } from '@/types/database'

export default function SettingsPage() {
  const [company, setCompany] = useState<Company | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [security, setSecurity] = useState<SecuritySettings | null>(null)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [industry, setIndustry] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: emp } = await supabase
      .from('employees')
      .select('*, companies(*)')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (!emp) { setLoading(false); return }
    setEmployee(emp as Employee)
    const co = (emp as { companies: Company }).companies
    setCompany(co)
    setCompanyName(co.name)
    setIndustry(co.industry ?? '')

    const [secRes, auditRes] = await Promise.all([
      supabase.from('security_settings').select('*').eq('company_id', co.id).maybeSingle(),
      supabase.from('audit_events').select('*').eq('company_id', co.id)
        .order('created_at', { ascending: false }).limit(20),
    ])

    setSecurity(secRes.data as SecuritySettings | null)
    setAuditEvents((auditRes.data ?? []) as AuditEvent[])
    setLoading(false)
  }

  async function saveCompanyName() {
    if (!company || !companyName.trim()) return
    setSaving('company')
    const supabase = createClient()
    await supabase.from('companies').update({ name: companyName.trim(), industry: industry || null })
      .eq('id', company.id)
    await load()
    setSaving(null)
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

  const isOwner = employee?.access_level === 'owner'
  const isHrOrAbove = ['owner', 'manager', 'hr'].includes(employee?.access_level ?? '')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-[14px] text-text-secondary">Loading…</span>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto pb-16">
      <h1 className="text-[22px] font-semibold text-text-primary mb-6">Settings</h1>

      {/* 1. General */}
      <Section title="General" icon="business">
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

      {/* 2. Security */}
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

      {/* 3. Portal Codes */}
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

      {/* 4. Attendance */}
      <Section title="Attendance" icon="schedule">
        <div className="flex flex-col gap-3">
          <RowInfo label="Overtime threshold" value="40 hours/week" />
          <RowInfo label="Allow self punch-in" value="Enabled" />
          <p className="text-[12px] text-text-secondary pt-1">
            Attendance settings can be configured in the MAUI admin app.
          </p>
        </div>
      </Section>

      {/* 5. Leave */}
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

      {/* 6. Payroll */}
      <Section title="Payroll" icon="payments">
        <div className="flex flex-col gap-3">
          <RowInfo label="Pay period" value="Monthly" />
          <RowInfo label="Overtime multiplier" value="1.5×" />
          <p className="text-[12px] text-text-secondary pt-1">
            Payroll configuration can be edited in the MAUI admin app.
          </p>
        </div>
      </Section>

      {/* 7. Notifications */}
      <Section title="Notifications" icon="notifications">
        <p className="text-[13px] text-text-secondary">
          Email notification preferences are managed per-user in the MAUI app.
        </p>
      </Section>

      {/* 8. Integrations */}
      <Section title="Integrations" icon="extension">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between py-2 border-b border-divider">
            <div>
              <p className="text-[13px] font-medium text-text-primary">SAGE Payroll</p>
              <p className="text-[12px] text-text-secondary">Export payroll data to SAGE</p>
            </div>
            <span className="px-2 py-0.5 rounded-pill text-[11px] font-medium bg-background text-text-disabled">Not connected</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-[13px] font-medium text-text-primary">Xero</p>
              <p className="text-[12px] text-text-secondary">Sync financial records</p>
            </div>
            <span className="px-2 py-0.5 rounded-pill text-[11px] font-medium bg-background text-text-disabled">Not connected</span>
          </div>
        </div>
      </Section>

      {/* 9. Backup & Export */}
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

      {/* 10. Audit Log */}
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

      {/* 11. Active Sessions */}
      <Section title="Active Sessions" icon="devices">
        <p className="text-[13px] text-text-secondary">
          Session management is available in the MAUI HR app under Settings → Active Sessions.
        </p>
      </Section>

      {/* 12. Ownership Transfer */}
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

      {/* 13. Danger Zone */}
      {isOwner && (
        <Section title="Danger Zone" icon="warning" danger>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
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
    </div>
  )
}

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
