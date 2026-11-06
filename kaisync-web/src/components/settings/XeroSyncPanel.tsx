'use client'

/**
 * Settings → Integrations → Xero: automatic sync.
 * - If the connection was made before invoices/payments were supported, asks to reconnect (one click).
 * - Choose the Xero accounts (sales, purchases, bank) and the go-live date, then switch auto-sync on.
 * - Shows what's waiting, what failed (with Xero's own message) and lets you try again.
 */

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Status = {
  connected: boolean; tenant_name?: string; can_sync_documents?: boolean; auto_sync?: boolean; sync_from?: string | null
  sales_account_code?: string | null; purchases_account_code?: string | null; bank_account_code?: string | null
  last_error?: string | null; waiting?: number; failed?: number; sent_today?: number
}
type Account = { id: string; code: string | null; name: string; type: string; class: string }
type Job = { id: string; entity: string; label: string | null; status: string; last_error: string | null; attempts: number; created_at: string; done_at: string | null }

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
const rpc = (supabase: ReturnType<typeof createClient>) => supabase.rpc.bind(supabase) as unknown as Rpc

const sel = 'h-10 rounded-lg border border-divider px-2.5 text-[13px] bg-background text-text-primary focus:outline-none focus:border-primary/60 w-full'
const today = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10)

export function XeroSyncPanel({ companyId, canManage, onReconnect }: { companyId: string; canManage: boolean; onReconnect: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [accErr, setAccErr] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [form, setForm] = useState({ auto: false, from: today(), sales: '', purchases: '', bank: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

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

      <div className="flex flex-wrap gap-2 text-[12px]">
        <span className="rounded-full bg-surface-elevated px-2.5 py-1">Waiting: {status.waiting ?? 0}</span>
        <span className="rounded-full bg-emerald-50 text-emerald-800 px-2.5 py-1">Sent today: {status.sent_today ?? 0}</span>
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
