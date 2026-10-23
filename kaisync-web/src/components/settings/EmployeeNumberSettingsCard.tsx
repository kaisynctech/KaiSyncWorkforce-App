'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  assignMissingEmployeeNumbers,
  getEmployeeNumberSettings,
  nextEmployeeNumberPreview,
  setEmployeeNumberPrefix,
  validateEmployeeNumberPrefix,
  type EmployeeNumberSettings,
} from '@/lib/employee-numbers'

const inputCls = 'w-full h-10 px-3 bg-background border border-border rounded-lg text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30'
const buttonCls = 'h-10 px-4 rounded-lg bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors'

/** Settings → Organisation: the employee number prefix and "number everyone without one". */
export function EmployeeNumberSettingsCard({ companyId }: { companyId: string }) {
  const [settings, setSettings] = useState<EmployeeNumberSettings | null>(null)
  const [prefix, setPrefix] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  function applySettings(res: Awaited<ReturnType<typeof getEmployeeNumberSettings>>) {
    if (!res.ok) { setMessage({ kind: 'error', text: res.message }); return }
    setSettings(res.data)
    setPrefix(res.data.prefix ?? '')
  }

  async function load() {
    applySettings(await getEmployeeNumberSettings(createClient(), companyId))
  }

  useEffect(() => {
    let cancelled = false
    getEmployeeNumberSettings(createClient(), companyId).then(res => { if (!cancelled) applySettings(res) })
    return () => { cancelled = true }
  }, [companyId])

  async function savePrefix() {
    const checked = validateEmployeeNumberPrefix(prefix)
    if ('error' in checked) { setMessage({ kind: 'error', text: checked.error }); return }
    setBusy(true); setMessage(null)
    const res = await setEmployeeNumberPrefix(createClient(), companyId, checked.prefix)
    setBusy(false)
    if (!res.ok) { setMessage({ kind: 'error', text: res.message }); return }
    setMessage({ kind: 'ok', text: `Prefix saved. New employees will be numbered ${checked.prefix}-0001 onwards.` })
    await load()
  }

  async function assignMissing() {
    setBusy(true); setMessage(null)
    const res = await assignMissingEmployeeNumbers(createClient(), companyId)
    setBusy(false)
    if (!res.ok) { setMessage({ kind: 'error', text: res.message }); return }
    setMessage({ kind: 'ok', text: res.data === 1 ? '1 employee now has a number.' : `${res.data} employees now have a number.` })
    await load()
  }

  const preview = nextEmployeeNumberPreview(settings)
  const canEdit = settings?.canEdit ?? false

  return (
    <div className="mb-4 bg-surface rounded-lg border border-divider overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-divider">
        <span className="material-icons text-[18px] text-text-secondary">badge</span>
        <h2 className="text-[14px] font-semibold text-text-primary">Employee numbers</h2>
      </div>
      <div className="px-5 py-4 flex flex-col gap-3">
        <p className="text-[13px] text-text-secondary">
          Staff numbers appear on profiles, payslips and reports. They are separate from the sign-in code.
          New employees get the next number automatically.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-[140px]">
            <label htmlFor="employee-number-prefix" className="block text-[11px] text-text-secondary mb-1">Prefix</label>
            <input
              id="employee-number-prefix"
              type="text"
              value={prefix}
              maxLength={6}
              onChange={e => { setPrefix(e.target.value.toUpperCase()); setMessage(null) }}
              placeholder="e.g. IV"
              disabled={!canEdit || busy}
              className={inputCls}
            />
          </div>
          <button type="button" onClick={savePrefix} disabled={!canEdit || busy} className={buttonCls}>
            Save prefix
          </button>
        </div>
        {settings && (
          <p className="text-[12px] text-text-secondary">
            {preview ? `Next number: ${preview}.` : 'No prefix yet, so new employees are not numbered automatically.'}
            {settings.withoutNumber > 0 && ` ${settings.withoutNumber} employee${settings.withoutNumber === 1 ? ' has' : 's have'} no number.`}
          </p>
        )}
        {settings && settings.withoutNumber > 0 && settings.prefix && (
          <button type="button" onClick={assignMissing} disabled={!canEdit || busy} className={`${buttonCls} self-start`}>
            Give numbers to {settings.withoutNumber} employee{settings.withoutNumber === 1 ? '' : 's'}
          </button>
        )}
        {message && (
          <p role="status" className={`text-[12px] ${message.kind === 'error' ? 'text-error' : 'text-success'}`}>{message.text}</p>
        )}
      </div>
    </div>
  )
}
