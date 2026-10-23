'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PayrollTabs } from '@/components/payroll/PayrollTabs'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  loadPayrollSettings,
  PAYROLL_SETTINGS_DEFAULTS,
  savePayrollSettings,
} from '@/lib/payroll-settings'
import type { PayrollSettings } from '@/types/database'

function Sw({ checked, onChange, id }: { checked: boolean; onChange: (v: boolean) => void; id?: string }) {
  return (
    <button type="button" id={id} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="relative w-[44px] h-[26px] rounded-full transition-colors shrink-0"
      style={{ backgroundColor: checked ? '#3B82F6' : 'var(--color-border)' }}>
      <span className="absolute top-[3px] left-[3px] w-5 h-5 rounded-full bg-white transition-transform"
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(0)' }} />
    </button>
  )
}

/** A setting row. `id` links the label to its control (pass the same id to the control). */
function Row({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 py-1.5 border-b border-divider last:border-0">
      <label htmlFor={id} className="text-sm text-text-primary">{label}</label>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

function NumInput({ value, onChange, width = 80, step, id, ariaLabel }: {
  value: number; onChange: (v: number) => void; width?: number; step?: number; id?: string; ariaLabel?: string
}) {
  return (
    <input type="number" id={id} aria-label={ariaLabel} value={value} step={step} min={0}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="dark-entry text-right text-sm"
      style={{ width }} />
  )
}

const PAY_BASIS_OPTS: { value: string; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'monthly_salary', label: 'Monthly salary' },
]
const PENALTY_MODES: { value: string; label: string }[] = [
  { value: 'none', label: 'No deduction' },
  { value: 'deduct_days', label: 'Deduct days' },
  { value: 'deduct_hours', label: 'Deduct hours' },
  { value: 'deduct_percent', label: 'Deduct a percentage' },
  { value: 'per_day', label: 'Per day' },
  { value: 'per_occurrence', label: 'Each time' },
  { value: 'threshold', label: 'After a limit' },
]

export default function PayrollSettingsPage() {
  const router = useRouter()
  const [settings, setSettings] = useState<Partial<PayrollSettings>>({ ...PAYROLL_SETTINGS_DEFAULTS })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  const [companyId, setCompanyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErrorMessage('')
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)

    const result = await loadPayrollSettings(supabase, member.companyId)
    if (!result.ok) {
      setErrorMessage(result.message)
      setSettings({ ...PAYROLL_SETTINGS_DEFAULTS, company_id: member.companyId })
    } else {
      setSettings(result.settings)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const set = <K extends keyof PayrollSettings>(k: K, v: PayrollSettings[K]) =>
    setSettings(prev => ({ ...prev, [k]: v }))

  async function save() {
    if (!companyId) return
    setIsBusy(true)
    setErrorMessage('')
    setSavedMsg('')
    const supabase = createClient()
    const result = await savePayrollSettings(supabase, companyId, settings)
    if (!result.ok) setErrorMessage(result.message)
    else setSavedMsg('Payroll settings saved.')
    setIsBusy(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <span className="text-text-secondary text-[13px]">Loading…</span>
    </div>
  )

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

  const s = { ...PAYROLL_SETTINGS_DEFAULTS, ...settings } as PayrollSettings

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-3 pb-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">Payroll</h1>
        <PayrollTabs active="settings" />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
        <div className="card p-4">
          <p className="section-label">PAYROLL ENGINE</p>
          <p className="text-xs text-text-secondary mt-1">
            How payslips are worked out, taxed and released for this company.
          </p>
        </div>

        <div className="card p-4">
          <p className="section-label mb-3">PAY CALCULATION</p>
          <Row label="Default pay basis" id="ps-basis">
            <select id="ps-basis" value={s.payroll_default_pay_basis} onChange={e => set('payroll_default_pay_basis', e.target.value)}
              className="dark-entry appearance-none text-sm" style={{ width: 140 }}>
              {PAY_BASIS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Row>
          <Row label="Default hourly rate (R)" id="ps-1">
            <NumInput id="ps-1" value={s.default_hourly_rate} onChange={v => set('default_hourly_rate', v)} />
          </Row>
          <Row label="Overtime multiplier" id="ps-2">
            <NumInput id="ps-2" value={s.overtime_multiplier} onChange={v => set('overtime_multiplier', v)} step={0.1} />
          </Row>
          <Row label="Overtime after (hours a day)" id="ps-3">
            <NumInput id="ps-3" value={s.overtime_threshold_hours} onChange={v => set('overtime_threshold_hours', v)} />
          </Row>
          <Row label="Overtime for salary staff" id="ps-4">
            <Sw id="ps-4" checked={s.allow_overtime_for_salary} onChange={v => set('allow_overtime_for_salary', v)} />
          </Row>
          <Row label="Full salary for mid-month joiners" id="ps-5">
            <Sw id="ps-5" checked={s.pay_full_salary_for_mid_month_joiners} onChange={v => set('pay_full_salary_for_mid_month_joiners', v)} />
          </Row>
          <Row label="Pay salary on public holidays" id="ps-6">
            <Sw id="ps-6" checked={s.pay_salary_on_public_holidays} onChange={v => set('pay_salary_on_public_holidays', v)} />
          </Row>
          <Row label="Pay hourly on public holidays" id="ps-7">
            <Sw id="ps-7" checked={s.pay_hourly_on_public_holidays} onChange={v => set('pay_hourly_on_public_holidays', v)} />
          </Row>
        </div>

        <div className="card p-4">
          <p className="section-label">TIME &amp; ATTENDANCE</p>
          <p className="text-xs text-text-secondary mt-1 mb-3">
            Used when building sessions and calculating late time for payroll.
            Overtime starts at the time set on the time template.
            Anyone without their own time template uses the company default template.
          </p>
          <Row label="Sign-in grace period (minutes)" id="ps-8">
            <NumInput id="ps-8" value={s.late_threshold_minutes} onChange={v => set('late_threshold_minutes', v)} />
          </Row>
          <Row label="Deduct absent days from pay" id="ps-9">
            <Sw id="ps-9" checked={s.deduct_absent_from_pay} onChange={v => set('deduct_absent_from_pay', v)} />
          </Row>
          <Row label="Salary staff: ignore attendance penalties" id="ps-10">
            <Sw id="ps-10" checked={s.salary_ignore_attendance_deductions} onChange={v => set('salary_ignore_attendance_deductions', v)} />
          </Row>
          <div className="pt-3">
            <button
              onClick={() => router.push('/dashboard/time-templates')}
              className="bg-surface-dark text-primary rounded-lg text-[13px] px-3.5 py-2.5 hover:opacity-80 transition-opacity">
              Manage Time Templates
            </button>
          </div>
        </div>

        <div className="card p-4">
          <p className="section-label mb-3">ATTENDANCE PENALTIES</p>
          {([
            ['When someone is absent', 'absent_penalty_mode', 'absent_penalty_threshold', 'absent_penalty_deduct_days', 'Limit (days)', 'Deduct (days)'],
            ['When someone is late', 'late_penalty_mode', 'late_penalty_threshold', 'late_penalty_deduct_hours', 'Limit (minutes)', 'Deduct (hours)'],
            ['When someone leaves early', 'early_penalty_mode', 'early_penalty_threshold', 'early_penalty_deduct_hours', 'Limit (minutes)', 'Deduct (hours)'],
          ] as [string, keyof PayrollSettings, keyof PayrollSettings, keyof PayrollSettings, string, string][]).map(
            ([label, modeK, threshK, deductK, tLabel, dLabel]) => (
              <div key={String(modeK)} className="mb-3">
                <Row label={label} id={`ps-${String(modeK)}`}>
                  <select id={`ps-${String(modeK)}`} value={s[modeK] as string} onChange={e => set(modeK, e.target.value as never)}
                    className="dark-entry appearance-none text-sm" style={{ width: 140 }}>
                    {PENALTY_MODES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Row>
                <div className="grid grid-cols-[1fr_auto] items-center gap-3 py-1.5 border-b border-divider last:border-0">
                  <span className="text-sm text-text-secondary">{tLabel} / {dLabel}</span>
                  <div className="flex items-center gap-1">
                    <NumInput ariaLabel={`${label}: ${tLabel}`} value={s[threshK] as number} onChange={v => set(threshK, v as never)} width={50} />
                    <span className="text-text-secondary text-sm">/</span>
                    <NumInput ariaLabel={`${label}: ${dLabel}`} value={s[deductK] as number} onChange={v => set(deductK, v as never)} width={50} />
                  </div>
                </div>
              </div>
            )
          )}
        </div>

        <div className="card p-4">
          <p className="section-label mb-3">STATUTORY &amp; TAX (SARS)</p>
          <Row label="UIF enabled" id="ps-11">
            <Sw id="ps-11" checked={s.uif_enabled} onChange={v => set('uif_enabled', v)} />
          </Row>
          <div className="grid grid-cols-[1fr_auto] items-center gap-3 py-1.5 border-b border-divider">
            <span className="text-sm text-text-primary">UIF rate % / ceiling (R)</span>
            <div className="flex items-center gap-1">
              <NumInput ariaLabel="UIF rate %" value={s.uif_rate_percent} onChange={v => set('uif_rate_percent', v)} width={50} step={0.1} />
              <span className="text-text-secondary text-sm">/</span>
              <NumInput ariaLabel="UIF ceiling (R)" value={s.uif_ceiling_monthly} onChange={v => set('uif_ceiling_monthly', v)} width={80} />
            </div>
          </div>
          <Row label="PAYE enabled" id="ps-12">
            <Sw id="ps-12" checked={s.paye_enabled} onChange={v => set('paye_enabled', v)} />
          </Row>
          <p className="text-[12px] text-text-secondary px-1 py-2">
            PAYE always uses the SARS 2026/27 tax tables. Under 65, PAYE is R0 when a full year of this pay is R99,000 or less. A fixed PAYE amount or a tax directive on the person still overrides the tables. UIF is separate.
          </p>
        </div>

        <div className="card p-4">
          <p className="section-label mb-3">PAYSLIPS &amp; RELEASE</p>
          <Row label="Payslip release day (0 = manual)" id="ps-13">
            <NumInput id="ps-13" value={s.payslip_release_day} onChange={v => set('payslip_release_day', v)} />
          </Row>
          <Row label="Auto-release on release day" id="ps-14">
            <Sw id="ps-14" checked={s.auto_release_payslips_on_release_day} onChange={v => set('auto_release_payslips_on_release_day', v)} />
          </Row>
          <Row label="Public holidays (dates, comma-separated)" id="ps-15">
            <input id="ps-15" type="text" value={s.public_holidays_text}
              onChange={e => set('public_holidays_text', e.target.value)}
              placeholder="2026-12-25, 2026-12-26"
              className="dark-entry text-sm" style={{ width: 160 }} />
          </Row>
        </div>

        {errorMessage && <p className="text-error text-sm text-center">{errorMessage}</p>}
        {savedMsg && <p className="text-success text-sm text-center">{savedMsg}</p>}

        <button onClick={save} disabled={isBusy}
          className="btn-primary w-full h-11 text-[14px] disabled:opacity-50">
          {isBusy ? 'Saving…' : 'Save Payroll Settings'}
        </button>
      </div>
    </div>
  )
}
