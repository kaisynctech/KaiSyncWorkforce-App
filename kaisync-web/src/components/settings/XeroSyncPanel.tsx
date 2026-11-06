'use client'

/**
 * Settings → Integrations → Xero: automatic sync.
 * - If the connection was made before invoices/payments were supported, asks to reconnect (one click).
 * - Choose the Xero accounts (sales, purchases, bank) and the go-live date, then switch auto-sync on.
 * - Shows what's waiting, what failed (with Xero's own message) and lets you try again.
 * - "Set up from Xero" suggests the accounts and checks VAT and currencies, then matches contacts both ways.
 * - Payments made in Xero come back to KaiSync (every 10 minutes, or "Check Xero now").
 */

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Status = {
  connected: boolean; tenant_name?: string; can_sync_documents?: boolean; auto_sync?: boolean; sync_from?: string | null
  sales_account_code?: string | null; purchases_account_code?: string | null; bank_account_code?: string | null
  last_error?: string | null; waiting?: number; failed?: number; sent_today?: number
  pull_from_xero?: boolean; pulled_at?: string | null; pull_error?: string | null; received_today?: number
}
type Setup = { organisation: string; suggested: { sales: string | null; purchases: string | null; bank: string | null }
  checks: Array<{ ok: boolean; text: string }>; contacts: { clients: number; suppliers: number; already_linked: number } }
type Account = { id: string; code: string | null; name: string; type: string; class: string }
type Job = { id: string; entity: string; label: string | null; status: string; last_error: string | null; attempts: number; created_at: string; done_at: string | null }

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
const rpc = (supabase: ReturnType<typeof createClient>) => supabase.rpc.bind(supabase) as unknown as Rpc

const sel = 'h-10 rounded-lg border border-divider px-2.5 text-[13px] bg-background text-text-primary focus:outline-none focus:border-primary/60 w-full'
const today = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10)

async function callFn(name: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const { data: { session } } = await createClient().auth.getSession()
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({})) as Record<string, unknown>
  return { ok: r.ok && !data.error, data }
}

export function XeroSyncPanel({ companyId, canManage, onReconnect }: { companyId: string; canManage: boolean; onReconnect: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [accErr, setAccErr] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [form, setForm] = useState({ auto: false, from: today(), sales: '', purchases: '', bank: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [setup, setSetup] = useState<Setup | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data } = await rpc(supabase)('xero_sync_status', { p_company_id: companyId })
    const s = (data ?? { connected: false }) as Status
    setStatus(s)
    setForm({ auto: !!s.auto_sync, from: s.sync_from ?? today(), sales: s.sales_account_code ?? '', purchases: s.purchases_account_code ?? '', bank: s.bank_account_code ?? '' })
    const { data: q } = await supabase.from('xero_sync_queue').select('id, entity, label, status, last_error, attempts, created_at, done_at')
      .eq('company_id', companyId).order('created_at', { ascending: false }).limit(25)
    setJobs((q ?? []) as unknown as Job[])
  }, [companyId])

  useEffect(() => {
    const t = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(t)
  }, [load])

  // Xero accounts for the dropdowns (only once the connection can do documents).
  useEffect(() => {
    if (!status?.connected || !status.can_sync_documents || accounts) return
    void (async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`, {
        method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, direction: 'accounts' }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok && d.accounts) setAccounts(d.accounts); else setAccErr(d.error ?? 'Could not read your Xero accounts.')
    })()
  }, [status, accounts, companyId])

  async function save() {
    setBusy(true); setMsg(null)
    const { error } = await rpc(createClient())('xero_save_settings', {
      p_company_id: companyId, p_auto_sync: form.auto, p_sync_from: form.from || null,
      p_sales_account: form.sales, p_purchases_account: form.purchases, p_bank_account: form.bank,
    })
    setBusy(false)
    if (error) {
      setMsg({ ok: false, text: error.message.includes('XERO_ACCOUNTS_REQUIRED') ? 'Choose the sales, purchases and bank accounts before switching auto-sync on.'
        : error.message.includes('NOT_ALLOWED') ? 'Only the owner, HR, finance and admins can change this.' : error.message })
      return
    }
    setMsg({ ok: true, text: form.auto ? `Saved. From now on, documents dated ${form.from} or later go to Xero automatically.` : 'Saved. Automatic sync is off.' })
    void load()
  }

  // ── Set up from Xero ──
  async function startSetup() {
    setBusy(true); setMsg(null)
    const r = await callFn('xero-setup', { company_id: companyId })
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: String(r.data.error ?? 'Could not read Xero.') }); return }
    const s = r.data as unknown as Setup
    setSetup(s)
    setForm(f => ({ ...f, sales: f.sales || s.suggested.sales || '', purchases: f.purchases || s.suggested.purchases || '', bank: f.bank || s.suggested.bank || '' }))
  }
  async function finishSetup() {
    if (!form.sales || !form.purchases || !form.bank) { setMsg({ ok: false, text: 'Choose the sales, purchases and bank accounts first.' }); return }
    setBusy(true); setMsg(null)
    const { error } = await rpc(createClient())('xero_save_settings', {
      p_company_id: companyId, p_auto_sync: true, p_sync_from: form.from || today(),
      p_sales_account: form.sales, p_purchases_account: form.purchases, p_bank_account: form.bank,
    })
    if (error) { setBusy(false); setMsg({ ok: false, text: error.message }); return }
    // Contacts: link or bring in Xero's, then send KaiSync's that Xero doesn't have. Nothing is duplicated.
    const pull = await callFn('xero-sync-contacts', { company_id: companyId, direction: 'pull' })
    const push = await callFn('xero-sync-contacts', { company_id: companyId, direction: 'push' })
    setBusy(false)
    const d1 = pull.data as { matched?: number; created?: number }
    const d2 = push.data as { clients_pushed?: number; contractors_pushed?: number }
    setSetup(null)
    setMsg({ ok: pull.ok && push.ok, text: pull.ok && push.ok
      ? `Xero is set up. Contacts: ${d1.matched ?? 0} matched, ${d1.created ?? 0} brought in from Xero, ${(d2.clients_pushed ?? 0) + (d2.contractors_pushed ?? 0)} sent to Xero. Documents dated ${form.from || today()} or later now go to Xero automatically.`
      : `Settings saved, but contacts didn't finish: ${String(pull.data.error ?? push.data.error ?? '')} — press Finish setup again.` })
    setForm(f => ({ ...f, auto: true }))
    void load()
  }

  // ── Payments from Xero ──
  async function setPull(on: boolean) {
    setBusy(true)
    await rpc(createClient())('xero_set_pull', { p_company_id: companyId, p_on: on })
    setBusy(false)
    void load()
  }
  async function checkNow() {
    setBusy(true); setMsg(null)
    const r = await callFn('xero-pull', { company_id: companyId })
    setBusy(false)
    const res = ((r.data.results ?? []) as Array<{ recorded: number; reversed: number; voided: number; skipped: string[]; error?: string }>)[0]
    if (!r.ok || !res || res.error) { setMsg({ ok: false, text: String(res?.error ?? r.data.error ?? 'Could not check Xero.') }); return }
    const parts = [`${res.recorded} payment${res.recorded === 1 ? '' : 's'} recorded`]
    if (res.reversed) parts.push(`${res.reversed} removed`)
    if (res.voided) parts.push(`${res.voided} invoice${res.voided === 1 ? '' : 's'} voided`)
    setMsg({ ok: true, text: `Checked Xero: ${parts.join(', ')}.${res.skipped.length ? ` Not recorded: ${res.skipped.join(' · ')}` : ''}` })
    void load()
  }

  async function retry(jobId?: string) {
    setBusy(true)
    await rpc(createClient())('xero_retry', { p_company_id: companyId, p_job_id: jobId ?? null })
    setBusy(false)
    setMsg({ ok: true, text: 'Queued again. Xero is updated within a minute.' })
    void load()
  }

  if (!status?.connected) return null
  if (!status.can_sync_documents) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 flex flex-col gap-2">
        <p className="text-[13px] text-amber-900">
          To send invoices, credit notes, bills and payments to Xero, reconnect once. Xero will ask you to allow the extra access. Nothing in Xero changes until you switch auto-sync on.
        </p>
        {canManage && <button type="button" onClick={onReconnect} className="self-start h-9 px-4 rounded-lg bg-primary text-white text-[12.5px] font-semibold hover:bg-primary-dark">Reconnect Xero</button>}
      </div>
    )
  }

  const opt = (filter: (a: Account) => boolean) => (accounts ?? []).filter(filter)
    .map(a => <option key={a.id} value={a.code ?? a.id}>{a.code ? `${a.code} · ` : ''}{a.name}</option>)
  const failed = jobs.filter(j => j.status === 'error')

  return (
    <div className="flex flex-col gap-3 pt-2 border-t border-divider">
      <div>
        <p className="text-[13px] font-medium text-text-primary">Automatic sync</p>
        <p className="text-[12px] text-text-secondary">
          Clients and suppliers when saved · invoices when they leave Draft · approved credit notes · payments received · a bill when a purchase order is fully received (updated by the supplier&apos;s invoice) · approved supplier invoices and their payments.
        </p>
      </div>

      {canManage && !setup && (
        <button type="button" onClick={() => void startSetup()} disabled={busy}
          className="self-start h-9 px-4 rounded-lg border border-primary text-primary text-[12.5px] font-semibold hover:bg-primary/5 disabled:opacity-50">
          {status.auto_sync ? 'Check setup with Xero' : 'Set up from Xero'}
        </button>
      )}
      {setup && (
        <div className="rounded-xl border border-divider bg-surface-elevated/60 px-3.5 py-3 flex flex-col gap-2">
          <p className="text-[13px] font-medium text-text-primary">Setup for {setup.organisation || 'your Xero organisation'}</p>
          <ul className="flex flex-col gap-1 text-[12.5px]">
            {setup.checks.map((c, i) => (
              <li key={i} className={c.ok ? 'text-emerald-800' : 'text-amber-800'}>{c.ok ? '✓' : '⚠'} {c.text}</li>
            ))}
            <li className="text-text-secondary">• Contacts: {setup.contacts.clients} clients and {setup.contacts.suppliers} suppliers in KaiSync ({setup.contacts.already_linked} already linked). Matching ones are linked by name or email; the rest are added on each side — never twice.</li>
          </ul>
          <p className="text-[12px] text-text-secondary">Check the accounts below, then finish. Documents dated from the date below go to Xero automatically, and payments made in Xero come back.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void finishSetup()} disabled={busy}
              className="h-9 px-4 rounded-lg bg-primary text-white text-[12.5px] font-semibold hover:bg-primary-dark disabled:opacity-50">{busy ? 'Setting up…' : 'Finish setup'}</button>
            <button type="button" onClick={() => setSetup(null)} disabled={busy} className="h-9 px-3 text-[12.5px] text-text-secondary">Cancel</button>
          </div>
        </div>
      )}

      {accErr && <p className="text-[12px] text-error">{accErr}</p>}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">Sales account
          <select className={sel} value={form.sales} disabled={!canManage || !accounts} onChange={e => setForm(f => ({ ...f, sales: e.target.value }))}>
            <option value="">{accounts ? 'Choose…' : 'Loading…'}</option>{opt(a => a.class === 'REVENUE')}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">Purchases account (bills)
          <select className={sel} value={form.purchases} disabled={!canManage || !accounts} onChange={e => setForm(f => ({ ...f, purchases: e.target.value }))}>
            <option value="">{accounts ? 'Choose…' : 'Loading…'}</option>{opt(a => a.class === 'EXPENSE' || a.type === 'DIRECTCOSTS' || a.type === 'INVENTORY')}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">Bank account (payments)
          <select className={sel} value={form.bank} disabled={!canManage || !accounts} onChange={e => setForm(f => ({ ...f, bank: e.target.value }))}>
            <option value="">{accounts ? 'Choose…' : 'Loading…'}</option>{opt(a => a.type === 'BANK')}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">Send documents dated from
          <input type="date" className={`${sel} w-[170px]`} value={form.from} disabled={!canManage} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-text-primary h-10">
          <input type="checkbox" checked={form.auto} disabled={!canManage} onChange={e => setForm(f => ({ ...f, auto: e.target.checked }))} className="w-4 h-4 accent-[var(--color-primary,#1E3A5F)]" />
          Send to Xero automatically
        </label>
        {canManage && (
          <button type="button" onClick={() => void save()} disabled={busy} className="h-10 px-4 rounded-lg bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      <p className="text-[11.5px] text-text-secondary">Older documents are never sent, so nothing your accountant already captured is duplicated.</p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-text-primary">
          <input type="checkbox" checked={status.pull_from_xero !== false} disabled={!canManage || busy} onChange={e => void setPull(e.target.checked)} className="w-4 h-4 accent-[var(--color-primary,#1E3A5F)]" />
          Record payments made in Xero
        </label>
        {canManage && status.auto_sync && status.pull_from_xero !== false && (
          <button type="button" onClick={() => void checkNow()} disabled={busy} className="text-[12.5px] text-primary underline disabled:opacity-50">Check Xero now</button>
        )}
        <span className="text-[11.5px] text-text-secondary">
          {status.pulled_at ? `Last checked ${new Date(status.pulled_at).toLocaleString('en-ZA')}` : 'Checked every 10 minutes while automatic sync is on'}
        </span>
      </div>
      {status.pull_error && <p className="text-[12px] text-amber-800">{status.pull_error}</p>}

      <div className="flex flex-wrap gap-2 text-[12px]">
        <span className="rounded-full bg-surface-elevated px-2.5 py-1">Waiting: {status.waiting ?? 0}</span>
        <span className="rounded-full bg-emerald-50 text-emerald-800 px-2.5 py-1">Sent today: {status.sent_today ?? 0}</span>
        <span className="rounded-full bg-sky-50 text-sky-800 px-2.5 py-1">Payments from Xero today: {status.received_today ?? 0}</span>
        <span className={`rounded-full px-2.5 py-1 ${status.failed ? 'bg-red-50 text-error' : 'bg-surface-elevated'}`}>Needs attention: {status.failed ?? 0}</span>
        {!!status.failed && canManage && <button type="button" onClick={() => void retry()} disabled={busy} className="text-primary underline">Try all again</button>}
      </div>
      {status.last_error && <p className="text-[12px] text-error">{status.last_error}</p>}

      {failed.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {failed.map(j => (
            <div key={j.id} className="rounded-lg border border-red-100 bg-red-50/50 px-3 py-2 text-[12px] flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-text-primary">{j.label ?? j.entity}</p>
                <p className="text-error break-words">{j.last_error}</p>
              </div>
              {canManage && <button type="button" onClick={() => void retry(j.id)} disabled={busy} className="text-primary underline shrink-0">Try again</button>}
            </div>
          ))}
        </div>
      )}
      {jobs.some(j => j.status === 'done') && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-text-secondary">Recently sent</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {jobs.filter(j => j.status === 'done').slice(0, 10).map(j => (
              <li key={j.id} className="text-text-secondary">✓ {j.label ?? j.entity} · {new Date(j.done_at ?? j.created_at).toLocaleString('en-ZA')}</li>
            ))}
          </ul>
        </details>
      )}
      {msg && <p className={`text-[12.5px] ${msg.ok ? 'text-emerald-700' : 'text-error'}`}>{msg.text}</p>}
    </div>
  )
}
