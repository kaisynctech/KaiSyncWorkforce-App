'use client'

/**
 * Automatic payment reminders: once a day, clients with overdue invoices get a friendly email listing
 * what is overdue, each with a "View & pay" link. On/off and timing per company (owner, HR, admins).
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Settings = { enabled: boolean; after: number; every: number }

export function AutoRemindersCard({ companyId }: { companyId: string }) {
  const [s, setS] = useState<Settings | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Settings>({ enabled: false, after: 3, every: 7 })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let off = false
    void createClient().from('companies').select('auto_reminders_enabled, auto_reminder_after_days, auto_reminder_every_days').eq('id', companyId).maybeSingle()
      .then(({ data }) => {
        if (off || !data) return
        const r = data as { auto_reminders_enabled: boolean; auto_reminder_after_days: number; auto_reminder_every_days: number }
        setS({ enabled: r.auto_reminders_enabled, after: r.auto_reminder_after_days, every: r.auto_reminder_every_days })
      })
    return () => { off = true }
  }, [companyId])

  async function save() {
    setBusy(true); setErr(null)
    const { error } = await createClient().rpc('set_auto_reminders', {
      p_company_id: companyId, p_enabled: draft.enabled, p_after_days: draft.after, p_every_days: draft.every,
    })
    setBusy(false)
    if (error) {
      setErr(/NOT_ALLOWED/.test(error.message) ? 'Only the owner, HR and admins can change this.'
        : /BAD_DAYS/.test(error.message) ? 'Choose 0–60 days after the due date, and every 3–60 days.' : error.message)
      return
    }
    setS(draft); setOpen(false)
  }

  if (!s) return null
  return (
    <>
      <div className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${s.enabled ? 'border-emerald-200 bg-emerald-50/60' : 'border-divider bg-surface-card'}`}>
        <span className={`material-icons text-[22px] ${s.enabled ? 'text-emerald-600' : 'text-text-secondary'}`}>{s.enabled ? 'notifications_active' : 'notifications_off'}</span>
        <div className="flex-1 min-w-[220px]">
          <p className="text-[13.5px] font-semibold text-text-primary">Automatic reminders {s.enabled ? 'are on' : 'are off'}</p>
          <p className="text-[12px] text-text-secondary">
            {s.enabled
              ? `Clients get a friendly email ${s.after === 0 ? 'on the day' : `${s.after} day${s.after === 1 ? '' : 's'}`} after an invoice is due, then every ${s.every} days until it's paid.`
              : 'Turn on to email clients about overdue invoices by themselves, with a link to view and pay.'}
          </p>
        </div>
        <button type="button" onClick={() => { setDraft(s); setErr(null); setOpen(true) }}
          className="h-9 px-4 rounded-lg border border-divider bg-surface-card text-[12.5px] font-medium text-text-primary hover:bg-surface-elevated">
          {s.enabled ? 'Settings' : 'Turn on'}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Automatic reminders">
          <div className="bg-surface-card rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[16px] font-semibold text-text-primary">Automatic reminders</h3>
                <p className="text-[12.5px] text-text-secondary mt-0.5">Sent once a day to clients with overdue invoices. Each overdue invoice has a View &amp; pay link.</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="w-8 h-8 rounded-lg text-text-secondary hover:bg-surface-elevated flex items-center justify-center">
                <span className="material-icons text-[18px]">close</span>
              </button>
            </div>
            <label className="flex items-center justify-between gap-3 text-[13.5px] font-medium text-text-primary">
              Send reminders automatically
              <input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} className="w-5 h-5 accent-[var(--color-primary,#1E3A5F)]" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary">First reminder (days after due)
                <input type="number" min={0} max={60} value={draft.after} onChange={e => setDraft({ ...draft, after: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })}
                  className="h-10 rounded-xl border border-divider px-3 text-[14px] bg-background text-text-primary" />
              </label>
              <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary">Then every (days)
                <input type="number" min={3} max={60} value={draft.every} onChange={e => setDraft({ ...draft, every: Math.max(3, Math.min(60, Number(e.target.value) || 3)) })}
                  className="h-10 rounded-xl border border-divider px-3 text-[14px] bg-background text-text-primary" />
              </label>
            </div>
            <p className="text-[12px] text-text-secondary">
              A client isn&apos;t reminded again if they got a reminder (automatic or from the Remind button) in the last {draft.every} days.
              To leave a client out, open Remind on their row and tick &quot;No automatic reminders&quot;.
            </p>
            {err && <p className="text-[13px] text-error">{err}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="h-10 px-4 rounded-xl border border-divider text-[13px] text-text-primary hover:bg-surface-elevated">Cancel</button>
              <button type="button" disabled={busy} onClick={() => void save()} className="h-10 px-5 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50">
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
