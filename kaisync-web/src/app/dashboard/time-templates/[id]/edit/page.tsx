'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface BreakEntry { id: string; label: string; minutes: number }

type TemplateRow = {
  id: string
  company_id: string
  name: string
  start_time: string | null
  end_time: string | null
  break_minutes: number | null
  breaks: { label?: string; Label?: string; minutes?: number; Minutes?: number }[] | null
}

function calcPaidHours(start: string, end: string, breaks: BreakEntry[]): string {
  if (!start || !end) return '—'
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let totalMins = (eh * 60 + em) - (sh * 60 + sm)
  if (totalMins < 0) totalMins += 24 * 60
  const breakMins = breaks.reduce((s, b) => s + (b.minutes || 0), 0)
  const paid = totalMins - breakMins
  if (paid < 0) return '0h 0m'
  const h = Math.floor(paid / 60)
  const m = paid % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

function toTimeInput(raw: string | null | undefined): string {
  if (!raw) return '08:00'
  const m = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return '08:00'
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

function toTimeSql(t: string): string {
  return t.length === 5 ? `${t}:00` : t
}

export default function EditTimeTemplatePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const templateId = params.id

  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('17:00')
  const [breaks, setBreaks] = useState<BreakEntry[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [showAddBreak, setShowAddBreak] = useState(false)
  const [breakLabel, setBreakLabel] = useState('')
  const [breakMinutes, setBreakMinutes] = useState('30')

  useEffect(() => { load() }, [templateId])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { router.push('/dashboard/time-templates'); return }
    setCompanyId(member.companyId)

    const { data } = await supabase
      .from('employee_shift_templates')
      .select('id, company_id, name, start_time, end_time, break_minutes, breaks')
      .eq('id', templateId)
      .eq('company_id', member.companyId)
      .maybeSingle()

    if (!data) { router.push('/dashboard/time-templates'); return }

    const t = data as TemplateRow
    setName(t.name)
    setStartTime(toTimeInput(t.start_time))
    setEndTime(toTimeInput(t.end_time))
    const rawBreaks = Array.isArray(t.breaks) ? t.breaks : []
    if (rawBreaks.length > 0) {
      setBreaks(rawBreaks.map((b, i) => ({
        id: `${i}`,
        label: b.label ?? b.Label ?? 'Break',
        minutes: Number(b.minutes ?? b.Minutes ?? 0) || 0,
      })))
    } else if (t.break_minutes && t.break_minutes > 0) {
      setBreaks([{ id: '0', label: 'Break', minutes: t.break_minutes }])
    } else {
      setBreaks([])
    }
    setLoading(false)
  }

  function addBreak() {
    if (!breakLabel.trim()) return
    setBreaks(prev => [...prev, { id: `${Date.now()}`, label: breakLabel.trim(), minutes: parseInt(breakMinutes) || 30 }])
    setBreakLabel('')
    setBreakMinutes('30')
    setShowAddBreak(false)
  }

  function removeBreak(id: string) { setBreaks(prev => prev.filter(b => b.id !== id)) }

  async function save() {
    if (!name.trim() || !companyId) { setErrorMsg('Template name is required.'); return }
    setBusy(true)
    setErrorMsg('')
    const supabase = createClient()
    const breakMins = breaks.reduce((s, b) => s + (b.minutes || 0), 0)
    const { error: rpcErr } = await supabase.rpc('hr_upsert_shift_template', {
      p_company_id: companyId,
      p_id: templateId,
      p_name: name.trim(),
      p_start_time: toTimeSql(startTime),
      p_end_time: toTimeSql(endTime),
      p_break_minutes: breakMins,
      p_breaks: breaks.map(b => ({ label: b.label, minutes: b.minutes })),
    })
    if (rpcErr) {
      setErrorMsg(rpcErr.message || 'Failed to save template.')
      setBusy(false)
      return
    }
    router.push('/dashboard/time-templates')
    setBusy(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-secondary text-[13px]">Loading…</span>
      </div>
    )
  }

  const paidHours = calcPaidHours(startTime, endTime, breaks)

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <Link href="/dashboard/time-templates" className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <h1 className="text-[18px] font-semibold text-text-primary flex-1">Edit Template</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl">
        <div className="card p-4 space-y-3">
          <p className="section-label">TEMPLATE DETAILS</p>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-secondary font-medium">Template name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Office Hours, Night Shift, Cleaners"
              className="dark-entry w-full" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-text-secondary font-medium">Start time</label>
            <div className="bg-surface-dark rounded-lg px-3 py-1">
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                className="bg-transparent text-text-primary outline-none h-9 w-full" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-text-secondary font-medium">End time</label>
            <div className="bg-surface-dark rounded-lg px-3 py-1">
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                className="bg-transparent text-text-primary outline-none h-9 w-full" />
            </div>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="section-label">BREAKS</p>
            <button onClick={() => setShowAddBreak(true)}
              className="bg-surface-dark text-text-primary h-[32px] px-3 text-[12px] rounded-lg hover:bg-border transition-colors">
              + Add Break
            </button>
          </div>
          {breaks.length === 0 ? (
            <p className="text-xs text-text-secondary">No breaks added. Tap &apos;+ Add Break&apos; to add a tea break, lunch, etc.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {breaks.map(b => (
                <div key={b.id} className="bg-surface-dark rounded-lg px-3 py-2 grid grid-cols-[1fr_auto] items-center gap-2">
                  <div>
                    <p className="text-[13px] font-semibold text-text-primary">{b.label}</p>
                    <p className="text-[11px] text-text-secondary">{b.minutes} minutes</p>
                  </div>
                  <button onClick={() => removeBreak(b.id)}
                    className="w-9 h-9 text-error text-[16px] flex items-center justify-center hover:opacity-70 transition-opacity">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl px-5 py-3.5 flex flex-col items-center gap-1 border border-primary"
          style={{ backgroundColor: 'var(--color-surface-dark)' }}>
          <p className="font-bold text-[20px] text-primary">{paidHours}</p>
          <p className="text-[11px] text-text-secondary">updates as you change times and breaks</p>
        </div>

        {errorMsg && <p className="text-error text-[13px]">{errorMsg}</p>}

        <button onClick={save} disabled={busy} className="btn-primary w-full h-11 text-[14px]">
          {busy ? 'Saving…' : 'Save Template'}
        </button>
      </div>

      {showAddBreak && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">Add Break</h3>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Label</label>
              <input value={breakLabel} onChange={e => setBreakLabel(e.target.value)}
                placeholder="e.g. Tea break, Lunch" className="dark-entry w-full" autoFocus />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Duration (minutes)</label>
              <input type="number" value={breakMinutes} onChange={e => setBreakMinutes(e.target.value)}
                min="5" max="120" className="dark-entry w-full" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAddBreak(false)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
              <button onClick={addBreak} className="btn-primary h-9 px-4 text-[13px]">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
