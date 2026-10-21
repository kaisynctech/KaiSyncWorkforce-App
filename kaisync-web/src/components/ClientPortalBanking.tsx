'use client'

import { useCallback, useEffect, useState } from 'react'
import { getBanking, submitBanking } from '@/lib/client-portal/api'
import { fmtDateTime } from '@/lib/client-portal/format'
import type { ClientPortalSession } from '@/lib/client-portal/session'
import type { ClientBankingView } from '@/lib/client-portal/types'

const ACCOUNT_TYPES = ['', 'Cheque / current', 'Savings', 'Transmission', 'Business']

/** Banking (refunds only): masked current details, latest request status, submit new details. */
export function ClientPortalBanking({ session }: { session: ClientPortalSession }) {
  const [view, setView] = useState<ClientBankingView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [form, setForm] = useState({ accountHolder: '', bankName: '', accountNumber: '', branchCode: '', accountType: '' })

  const load = useCallback(async () => {
    try {
      setView(await getBanking(session.company_code, session.client_code))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load your bank details.')
      setView({ current: null, latest: null })
    }
  }, [session.company_code, session.client_code])

  // Loads from the server on mount; setState happens after the await.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  async function submit() {
    setSaving(true)
    setError(null)
    setDone(false)
    try {
      await submitBanking(session.company_code, session.client_code, form)
      setForm({ accountHolder: '', bankName: '', accountNumber: '', branchCode: '', accountType: '' })
      setDone(true)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not submit your bank details.')
    }
    setSaving(false)
  }

  if (!view) return <div className="py-16 text-center text-text-secondary text-[14px]">Loading…</div>
  const { current, latest } = view

  return (
    <div className="space-y-4">
      <div className="bg-primary/10 border border-primary/25 rounded-xl px-4 py-3 text-[12px] text-text-primary">
        We only use these details to pay you a <span className="font-semibold">refund</span>. Our team checks every change before it is used,
        and the full account number is never shown here.
      </div>

      <Section title="Bank details on file">
        {current ? (
          <>
            <Row label="Account holder" value={current.account_holder || '—'} />
            <Row label="Bank" value={current.bank_name || '—'} />
            <Row label="Account" value={current.masked_account || '—'} />
            <Row label="Branch code" value={current.branch_code || '—'} />
          </>
        ) : (
          <p className="text-[13px] text-text-secondary">No bank details on file.</p>
        )}
      </Section>

      {latest?.status === 'pending' && (
        <Banner tone="warning" title="Update waiting for review">
          Submitted {fmtDateTime(latest.submitted_at)} · {latest.bank_name} · {latest.masked_account}
        </Banner>
      )}
      {latest?.status === 'approved' && (
        <Banner tone="success" title="Last update approved">
          {latest.reviewed_at ? `Approved ${fmtDateTime(latest.reviewed_at)}` : 'Approved'}
        </Banner>
      )}
      {latest?.status === 'rejected' && (
        <Banner tone="error" title="Last update not approved">
          {latest.rejection_reason ? `Reason: ${latest.rejection_reason}` : 'Please check the details and submit again.'}
        </Banner>
      )}
      {done && <Banner tone="success" title="Submitted">Our team has been notified and will review your details.</Banner>}
      {error && <Banner tone="error" title="Something went wrong">{error}</Banner>}

      <Section title={current ? 'Change bank details' : 'Add bank details'}>
        <Field label="Account holder *" value={form.accountHolder} onChange={v => setForm({ ...form, accountHolder: v })} />
        <Field label="Bank name *" value={form.bankName} onChange={v => setForm({ ...form, bankName: v })} />
        <Field label="Account number *" value={form.accountNumber} inputMode="numeric" onChange={v => setForm({ ...form, accountNumber: v })} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Branch code" value={form.branchCode} inputMode="numeric" onChange={v => setForm({ ...form, branchCode: v })} />
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-text-secondary uppercase">Account type</label>
            <select
              className="bg-surface border border-divider text-text-primary w-full h-10 px-3 rounded-lg text-[13px]"
              value={form.accountType}
              onChange={e => setForm({ ...form, accountType: e.target.value })}
            >
              {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t || 'Choose…'}</option>)}
            </select>
          </div>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void submit()}
          className="h-10 px-5 rounded-xl bg-primary text-white text-[13px] font-semibold disabled:opacity-50"
        >
          {saving ? 'Submitting…' : 'Submit for review'}
        </button>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-divider bg-surface rounded-xl border overflow-hidden">
      <div className="border-divider px-4 py-2.5 border-b">
        <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">{title}</p>
      </div>
      <div className="px-4 py-3 space-y-2">{children}</div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-primary text-right">{value}</span>
    </div>
  )
}

function Field({ label, value, onChange, inputMode }: { label: string; value: string; onChange: (v: string) => void; inputMode?: 'numeric' }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-text-secondary uppercase">{label}</label>
      <input
        className="bg-surface border border-divider text-text-primary w-full h-10 px-3 rounded-lg text-[13px]"
        value={value}
        inputMode={inputMode}
        autoComplete="off"
        maxLength={200}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

function Banner({ tone, title, children }: { tone: 'warning' | 'success' | 'error'; title: string; children: React.ReactNode }) {
  const cls = tone === 'success' ? 'bg-success/10 border-success/30 text-success'
    : tone === 'error' ? 'bg-error/10 border-error/25 text-error'
      : 'bg-warning/10 border-warning/30 text-warning'
  return (
    <div className={`border rounded-xl px-4 py-3 ${cls}`}>
      <p className="text-[13px] font-semibold">{title}</p>
      <p className="text-[12px] text-text-secondary mt-0.5">{children}</p>
    </div>
  )
}
