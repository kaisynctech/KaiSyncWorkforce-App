'use client'

import { useEffect, useMemo, useState } from 'react'
import { TenantPortalShell } from '@/components/TenantPortalShell'
import { useRequireTenantPortalSession } from '@/lib/tenant-portal/use-session'
import {
  createIssue,
  getLeaseSummary,
  listInvoices,
  listIssues,
  submitPaymentProof,
} from '@/lib/tenant-portal/api'
import {
  isInvoiceOutstanding,
  type TenantInvoice,
  type TenantIssue,
  type TenantLeasePayload,
} from '@/lib/tenant-portal/types'

type Tab = 'home' | 'invoices' | 'issues'

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
}

const fmtMoney = (n: number, currency = 'ZAR') =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)

export default function TenantPortalHomePage() {
  const { session, ready } = useRequireTenantPortalSession()
  const [tab, setTab] = useState<Tab>('home')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<TenantLeasePayload | null>(null)
  const [invoices, setInvoices] = useState<TenantInvoice[]>([])
  const [issues, setIssues] = useState<TenantIssue[]>([])

  const [proofInvoiceId, setProofInvoiceId] = useState<string | null>(null)
  const [proofRef, setProofRef] = useState('')
  const [proofBusy, setProofBusy] = useState(false)

  const [issueTitle, setIssueTitle] = useState('')
  const [issueDesc, setIssueDesc] = useState('')
  const [issuePhoto, setIssuePhoto] = useState<File | null>(null)
  const [issueBusy, setIssueBusy] = useState(false)
  const [issueOk, setIssueOk] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function load() {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      const [s, inv, iss] = await Promise.all([
        getLeaseSummary(session.company_code, session.resident_code),
        listInvoices(session.company_code, session.resident_code),
        listIssues(session.company_code, session.resident_code),
      ])
      setSummary(s)
      setInvoices(inv)
      setIssues(iss)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load portal.')
    }
    setLoading(false)
  }

  const outstanding = useMemo(
    () => invoices.filter(i => isInvoiceOutstanding(i.status) && i.balance_due > 0)
      .reduce((s, i) => s + i.balance_due, 0),
    [invoices],
  )

  const activeLease = summary?.leases.find(l => l.status === 'active') ?? summary?.leases[0] ?? null

  async function onProofFile(file: File | undefined) {
    if (!session || !proofInvoiceId || !file) return
    setProofBusy(true)
    setError(null)
    try {
      await submitPaymentProof({
        companyCode: session.company_code,
        residentCode: session.resident_code,
        companyId: session.company_id,
        invoiceId: proofInvoiceId,
        file,
        reference: proofRef || null,
      })
      setProofInvoiceId(null)
      setProofRef('')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    }
    setProofBusy(false)
  }

  async function onCreateIssue() {
    if (!session || !issueTitle.trim()) return
    setIssueBusy(true)
    setError(null)
    setIssueOk(null)
    try {
      const created = await createIssue({
        companyCode: session.company_code,
        residentCode: session.resident_code,
        companyId: session.company_id,
        title: issueTitle.trim(),
        description: issueDesc.trim() || null,
        leaseId: activeLease?.id ?? null,
        photo: issuePhoto,
      })
      setIssueTitle('')
      setIssueDesc('')
      setIssuePhoto(null)
      setIssueOk(`Issue logged${created.job_code ? ` (${created.job_code})` : ''}.`)
      await load()
      setTab('issues')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not create issue.')
    }
    setIssueBusy(false)
  }

  if (!ready || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a] text-slate-400 text-[14px]">
        Loading…
      </div>
    )
  }

  return (
    <TenantPortalShell session={session}>
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4 pb-12">
        <div>
          <h1 className="text-white text-[20px] font-bold">Welcome, {session.resident_name}</h1>
          <p className="text-slate-400 text-[13px] mt-0.5">Lease, rent invoices, and maintenance</p>
        </div>

        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
          {([
            { id: 'home' as const, label: 'Home' },
            { id: 'invoices' as const, label: 'Invoices' },
            { id: 'issues' as const, label: 'Issues' },
          ]).map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-colors ${
                tab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <p className="text-[13px] text-red-400">{error}</p>}
        {loading && <p className="text-[13px] text-slate-400">Loading…</p>}

        {!loading && tab === 'home' && (
          <div className="space-y-4">
            {outstanding > 0 && (
              <div className="rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3">
                <p className="text-red-300 text-[13px] font-semibold">Outstanding balance</p>
                <p className="text-white text-[22px] font-bold mt-1">{fmtMoney(outstanding)}</p>
              </div>
            )}

            {activeLease ? (
              <div className="rounded-xl border px-4 py-3 space-y-2" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                <p className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold">Your lease</p>
                <p className="text-white text-[16px] font-semibold">{activeLease.site_name}</p>
                <p className="text-slate-400 text-[13px]">
                  {activeLease.site_address ?? '—'}
                  {activeLease.unit_number ? ` · Unit ${activeLease.unit_number}` : ''}
                </p>
                <p className="text-slate-300 text-[13px]">
                  {fmtMoney(activeLease.rent_amount ?? 0, activeLease.currency)} / {activeLease.payment_frequency}
                  {' · '}{fmtDate(activeLease.start_date)} – {fmtDate(activeLease.end_date)}
                </p>
                <p className="text-[12px] text-slate-500 capitalize">Status: {activeLease.status}</p>
              </div>
            ) : (
              <p className="text-[13px] text-slate-400">No lease linked yet. Contact your property manager.</p>
            )}

            <div className="rounded-xl border px-4 py-3 space-y-3" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
              <p className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold">Report an issue</p>
              <input
                value={issueTitle}
                onChange={e => setIssueTitle(e.target.value)}
                placeholder="Short title (e.g. Leaking tap)"
                className="w-full h-10 px-3 rounded-lg text-[13px] bg-slate-900 border border-slate-700 text-white"
              />
              <textarea
                value={issueDesc}
                onChange={e => setIssueDesc(e.target.value)}
                placeholder="Describe the problem…"
                rows={3}
                className="w-full px-3 py-2 rounded-lg text-[13px] bg-slate-900 border border-slate-700 text-white"
              />
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={e => setIssuePhoto(e.target.files?.[0] ?? null)}
                className="w-full text-[12px] text-slate-400"
              />
              {issueOk && <p className="text-[12px] text-green-400">{issueOk}</p>}
              <button
                type="button"
                disabled={issueBusy || !issueTitle.trim()}
                onClick={() => void onCreateIssue()}
                className="h-10 px-4 rounded-lg bg-blue-600 text-white text-[13px] font-semibold disabled:opacity-50"
              >
                {issueBusy ? 'Submitting…' : 'Submit issue'}
              </button>
            </div>
          </div>
        )}

        {!loading && tab === 'invoices' && (
          <div className="space-y-3">
            {invoices.length === 0 ? (
              <p className="text-[13px] text-slate-400">No invoices yet.</p>
            ) : (
              invoices.map(inv => (
                <div
                  key={inv.id}
                  className="rounded-xl border px-4 py-3 space-y-2"
                  style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
                >
                  <div className="flex justify-between gap-2">
                    <p className="text-white text-[14px] font-semibold">{inv.invoice_number ?? 'Invoice'}</p>
                    <p className="text-[12px] text-slate-400 capitalize">{inv.status}</p>
                  </div>
                  <p className="text-slate-400 text-[12px]">Due {fmtDate(inv.due_date)}</p>
                  <p className="text-white text-[15px]">
                    {fmtMoney(inv.total_amount, inv.currency)}
                    {inv.balance_due > 0 && (
                      <span className="text-red-300 text-[13px] ml-2">bal {fmtMoney(inv.balance_due, inv.currency)}</span>
                    )}
                  </p>
                  {inv.balance_due > 0 && (
                    proofInvoiceId === inv.id ? (
                      <div className="space-y-2 pt-1">
                        <input
                          value={proofRef}
                          onChange={e => setProofRef(e.target.value)}
                          placeholder="Payment reference (optional)"
                          className="w-full h-9 px-3 rounded-lg text-[13px] bg-slate-900 border border-slate-700 text-white"
                        />
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          disabled={proofBusy}
                          onChange={e => void onProofFile(e.target.files?.[0])}
                          className="w-full text-[12px] text-slate-400"
                        />
                        <button type="button" onClick={() => setProofInvoiceId(null)} className="text-[12px] text-slate-400">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setProofInvoiceId(inv.id); setProofRef('') }}
                        className="text-[12px] text-blue-400 font-semibold hover:underline"
                      >
                        Upload proof of payment
                      </button>
                    )
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {!loading && tab === 'issues' && (
          <div className="space-y-3">
            {issues.length === 0 ? (
              <p className="text-[13px] text-slate-400">No issues reported yet.</p>
            ) : (
              issues.map(iss => (
                <div
                  key={iss.id}
                  className="rounded-xl border px-4 py-3"
                  style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
                >
                  <div className="flex justify-between gap-2">
                    <p className="text-white text-[14px] font-semibold">{iss.title}</p>
                    <p className="text-[12px] text-slate-400 capitalize">{iss.status}</p>
                  </div>
                  <p className="text-slate-500 text-[12px] mt-1">
                    {iss.job_code ?? '—'} · {fmtDate(iss.opened_at)}
                  </p>
                  {iss.description && <p className="text-slate-400 text-[13px] mt-2">{iss.description}</p>}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </TenantPortalShell>
  )
}
