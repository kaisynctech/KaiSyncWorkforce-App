'use client'

/**
 * Settings → General → "Send emails from your own domain". The company adds its domain, puts the DNS
 * records we show into its domain's settings (or sends them to whoever manages the website), then presses
 * "Check now". Once verified, invoices, quotes, statements, payslips etc. come from e.g. accounts@theirdomain.
 */

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type DnsRecord = { record: string; name: string; type: string; value: string; ttl?: string; status?: string; priority?: number }
type DomainView = { ok: true; domain: string | null; status: string | null; records: DnsRecord[]; local: string; checked_at: string | null; sender: string | null }

async function call(body: Record<string, unknown>): Promise<DomainView | { ok: false; message: string }> {
  const { data, error } = await createClient().functions.invoke('company_email_domain', { body })
  if (data && (data as { ok?: boolean }).ok) return data as DomainView
  let message = (data as { message?: string } | null)?.message ?? 'Something went wrong.'
  try {
    const ctx = await (error as { context?: Response } | null)?.context?.json?.()
    if (ctx?.message) message = ctx.message
  } catch { /* keep message */ }
  return { ok: false, message }
}

const STATUS: Record<string, { label: string; cls: string }> = {
  verified: { label: 'Verified — emails come from your domain', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  pending: { label: 'Waiting for the DNS records', cls: 'bg-amber-50 text-amber-900 border-amber-200' },
  not_started: { label: 'Add the DNS records below, then press Check now', cls: 'bg-amber-50 text-amber-900 border-amber-200' },
  failed: { label: 'The records could not be found — check them and try again', cls: 'bg-red-50 text-red-800 border-red-200' },
  temporary_failure: { label: 'Could not check right now — try again in a few minutes', cls: 'bg-amber-50 text-amber-900 border-amber-200' },
}

export function EmailDomainSettings({ companyId, canEdit }: { companyId: string; canEdit: boolean }) {
  const [view, setView] = useState<DomainView | null>(null)
  const [domain, setDomain] = useState('')
  const [local, setLocal] = useState('accounts')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const apply = useCallback((r: Awaited<ReturnType<typeof call>>) => {
    if (r.ok) { setView(r); setLocal(r.local || 'accounts'); setErr(null) } else setErr(r.message)
  }, [])

  useEffect(() => {
    if (!canEdit) return
    let off = false
    void call({ company_id: companyId, action: 'status' }).then(r => { if (!off) apply(r) })
    return () => { off = true }
  }, [companyId, canEdit, apply])

  async function run(action: string, extra: Record<string, unknown> = {}) {
    if (action === 'remove' && !window.confirm('Stop sending from your domain? Emails will come from the KaiSync address again.')) return
    setBusy(action); setErr(null)
    apply(await call({ company_id: companyId, action, ...extra }))
    setBusy(null)
  }

  if (!canEdit) return null
  const st = view?.status ? STATUS[view.status] ?? { label: view.status, cls: 'bg-slate-50 text-slate-700 border-slate-200' } : null
  const field = 'h-10 rounded-xl border border-divider px-3 text-[14px] bg-background text-text-primary'

  return (
    <section className="card p-5 mt-5 flex flex-col gap-4">
      <div>
        <p className="section-label">EMAIL</p>
        <h3 className="text-[15px] font-semibold text-text-primary mt-1">Send emails from your own domain</h3>
        <p className="text-[12.5px] text-text-secondary mt-0.5">
          Invoices, quotes, statements, reminders and payslips come from {view?.sender
            ? <span className="font-medium text-text-primary">{view.sender}</span>
            : <>our address (<span className="font-medium">no-reply@kaisyncworkforce.com</span>) with your company name</>}.
          {!view?.sender && ' Add your domain so they come from your own address instead.'}
        </p>
      </div>

      {!view?.domain ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary">Send from
              <input value={local} onChange={e => setLocal(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} className={`${field} w-36`} />
            </label>
            <span className="pb-2.5 text-[15px] text-text-secondary">@</span>
            <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary flex-1 min-w-[200px]">Your domain
              <input value={domain} onChange={e => setDomain(e.target.value.trim())} placeholder="yourcompany.co.za" className={`${field} w-full`} />
            </label>
            <button type="button" disabled={busy !== null || !domain} onClick={() => void run('add', { domain, local })}
              className="h-10 px-4 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50">
              {busy === 'add' ? 'Adding…' : 'Add domain'}
            </button>
          </div>
          <p className="text-[12px] text-text-secondary">You&apos;ll get a few DNS records to add where your domain is managed (e.g. your website or email host). It usually takes a few minutes to an hour to work.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-text-primary">{view.local}@{view.domain}</span>
            {st && <span className={`text-[12px] font-medium px-2.5 py-1 rounded-full border ${st.cls}`}>{st.label}</span>}
          </div>
          {view.status !== 'verified' && (
            <>
              <p className="text-[12.5px] text-text-secondary">Add these records in your domain&apos;s DNS settings, exactly as shown. Then press Check now.</p>
              <div className="overflow-x-auto rounded-xl border border-divider">
                <table className="w-full text-[12.5px]" style={{ minWidth: 640 }}>
                  <thead className="bg-surface-elevated text-text-secondary">
                    <tr><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Value</th><th className="px-3 py-2 text-left">Priority</th><th className="px-3 py-2 text-left">Status</th></tr>
                  </thead>
                  <tbody>
                    {view.records.map((r, i) => (
                      <tr key={i} className="border-t border-divider align-top">
                        <td className="px-3 py-2 font-medium">{r.type}</td>
                        <td className="px-3 py-2"><Copy text={r.name} /></td>
                        <td className="px-3 py-2 max-w-[340px]"><Copy text={r.value} /></td>
                        <td className="px-3 py-2">{r.priority ?? ''}</td>
                        <td className="px-3 py-2 capitalize">{(r.status ?? '').replace(/_/g, ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {view.status !== 'verified' && (
              <button type="button" disabled={busy !== null} onClick={() => void run('check')} className="h-9 px-4 rounded-lg bg-primary text-white text-[12.5px] font-semibold disabled:opacity-50">
                {busy === 'check' ? 'Checking…' : 'Check now'}
              </button>
            )}
            <button type="button" disabled={busy !== null} onClick={() => void run('remove')} className="h-9 px-4 rounded-lg border border-divider text-[12.5px] text-text-primary hover:bg-surface-elevated disabled:opacity-50">
              {busy === 'remove' ? 'Removing…' : view.status === 'verified' ? 'Stop using this domain' : 'Cancel'}
            </button>
          </div>
          {view.checked_at && <p className="text-[11.5px] text-text-secondary">Last checked {new Date(view.checked_at).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>}
        </div>
      )}
      {err && <p className="text-[13px] text-error">{err}</p>}
    </section>
  )
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <span className="inline-flex items-start gap-1.5">
      <code className="break-all text-[12px]">{text}</code>
      <button type="button" title="Copy" onClick={() => { void navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200) }}
        className="text-text-secondary hover:text-text-primary shrink-0">
        <span className="material-icons text-[14px]">{done ? 'check' : 'content_copy'}</span>
      </button>
    </span>
  )
}
