'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ContractorPortalShell } from '@/components/ContractorPortalShell'
import { ContractorPortalComplianceTab } from '@/components/ContractorPortalComplianceTab'
import { ContractorPortalPaymentsTab } from '@/components/ContractorPortalPaymentsTab'
import { ContractorPortalQuotesTab } from '@/components/ContractorPortalQuotesTab'
import { useRequireContractorPortalSession } from '@/lib/contractor-portal/use-session'
import {
  getBanking,
  getLatestBankingDecision,
  getOpenVisit,
  getProfile,
  jobStatusLabel,
  listJobs,
  listPayouts,
  submitBanking,
  updateProfile,
} from '@/lib/contractor-portal/api'
import { saveContractorPortalSession, type ContractorPortalSession } from '@/lib/contractor-portal/session'
import {
  accountTypeLabel,
  BANK_ACCOUNT_TYPE_OPTIONS,
  moneyZAR,
  partnerKindLabel,
  paymentMethodLabel,
  paymentTermsLabel,
  payoutNetPayable,
  type ContractorBankingDecision,
  type ContractorBankingStatus,
  type ContractorJob,
  type ContractorPayout,
  type ContractorPortalProfile,
  type OpenVisit,
} from '@/lib/contractor-portal/types'

type Tab = 'home' | 'information' | 'jobs' | 'payments' | 'banking' | 'compliance' | 'quotes'

const TABS: { key: Tab; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'information', label: 'Information' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'payments', label: 'Payments' },
  { key: 'banking', label: 'Banking' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'quotes', label: 'Quotes' },
]

function parseTab(raw: string | null): Tab {
  if (raw && TABS.some(t => t.key === raw)) return raw as Tab
  return 'home'
}

export default function ContractorPortalHomePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a] text-slate-400 text-[14px]">
        Loading…
      </div>
    }>
      <ContractorPortalHomeInner />
    </Suspense>
  )
}

function ContractorPortalHomeInner() {
  const { session, ready, setSession } = useRequireContractorPortalSession()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(() => parseTab(searchParams.get('tab')))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ContractorPortalProfile | null>(null)
  const [jobs, setJobs] = useState<ContractorJob[]>([])
  const [payouts, setPayouts] = useState<ContractorPayout[]>([])
  const [openVisit, setOpenVisit] = useState<OpenVisit | null>(null)

  // Profile edit
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [edit, setEdit] = useState({
    name: '',
    registration_number: '',
    tax_number: '',
    is_vat_registered: false,
    vat_number: '',
    contact_person: '',
    phone: '',
    email: '',
    address: '',
  })

  useEffect(() => {
    setTab(parseTab(searchParams.get('tab')))
  }, [searchParams])

  function selectTab(next: Tab) {
    setTab(next)
    router.replace(`/contractor-portal/home?tab=${next}`, { scroll: false })
  }

  useEffect(() => {
    if (!session) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.contractor_id, session?.company_id])

  async function load() {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      const [prof, jobList, payoutList, visit] = await Promise.all([
        getProfile(session.contractor_id, session.company_id),
        listJobs(session.company_code, session.contractor_code),
        listPayouts(session.company_code, session.contractor_code),
        getOpenVisit(session.company_code, session.contractor_code).catch(() => null),
      ])
      setProfile(prof)
      setJobs(jobList)
      setPayouts(payoutList)
      setOpenVisit(visit)
      if (prof?.name && prof.name !== session.contractor_name) {
        const next = { ...session, contractor_name: prof.name }
        saveContractorPortalSession(next)
        setSession(next)
      }
      if (prof) initEdit(prof)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load portal.')
    }
    setLoading(false)
  }

  function initEdit(p: ContractorPortalProfile) {
    setEdit({
      name: p.name,
      registration_number: p.registration_number ?? '',
      tax_number: p.tax_number ?? '',
      is_vat_registered: p.is_vat_registered,
      vat_number: p.vat_number ?? '',
      contact_person: p.contact_person ?? '',
      phone: p.phone ?? '',
      email: p.email ?? '',
      address: p.address ?? '',
    })
  }

  async function saveProfile() {
    if (!session) return
    if (!edit.name.trim()) {
      setError('Company / trading name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updateProfile(session.contractor_id, session.company_id, {
        name: edit.name,
        registration_number: edit.registration_number || null,
        tax_number: edit.tax_number || null,
        is_vat_registered: edit.is_vat_registered,
        vat_number: edit.vat_number || null,
        contact_person: edit.contact_person || null,
        phone: edit.phone || null,
        email: edit.email || null,
        address: edit.address || null,
      })
      const refreshed = await getProfile(session.contractor_id, session.company_id)
      setProfile(refreshed)
      if (refreshed) {
        initEdit(refreshed)
        const next = { ...session, contractor_name: refreshed.name }
        saveContractorPortalSession(next)
        setSession(next)
      }
      setEditing(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save profile.')
    }
    setSaving(false)
  }

  const outstanding = useMemo(
    () => payouts.filter(p => p.payout_status !== 'paid')
      .reduce((s, p) => s + payoutNetPayable(p), 0),
    [payouts],
  )
  const openJobs = useMemo(
    () => jobs.filter(j => !['completed', 'cancelled', 'canceled'].includes(j.status.toLowerCase())),
    [jobs],
  )

  if (!ready || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a] text-slate-400 text-[14px]">
        Loading…
      </div>
    )
  }

  return (
    <ContractorPortalShell session={session}>
      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: 'rgba(255,255,255,0.04)' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              className={`shrink-0 text-[12px] font-semibold px-3 py-2 rounded-lg transition-colors ${
                tab === t.key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <p className="text-[13px] text-red-400 font-semibold">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-slate-400 text-[14px]">Loading…</div>
        ) : tab === 'home' ? (
          <HomeTab
            name={session.contractor_name}
            profile={profile}
            openJobs={openJobs.length}
            outstanding={outstanding}
            openVisit={openVisit}
            onGoJobs={() => selectTab('jobs')}
            onGoInfo={() => selectTab('information')}
            onGoPayments={() => selectTab('payments')}
            onGoCompliance={() => selectTab('compliance')}
            onGoBanking={() => selectTab('banking')}
          />
        ) : tab === 'information' ? (
          <InformationTab
            profile={profile}
            editing={editing}
            edit={edit}
            setEdit={setEdit}
            saving={saving}
            onEdit={() => { if (profile) initEdit(profile); setEditing(true) }}
            onCancel={() => { if (profile) initEdit(profile); setEditing(false) }}
            onSave={() => void saveProfile()}
          />
        ) : tab === 'jobs' ? (
          <JobsTab jobs={jobs} />
        ) : tab === 'banking' ? (
          <BankingTab session={session} onError={setError} />
        ) : tab === 'compliance' ? (
          <ContractorPortalComplianceTab session={session} onError={setError} />
        ) : tab === 'payments' ? (
          <ContractorPortalPaymentsTab
            session={session}
            payouts={payouts}
            onError={setError}
            onRefresh={async () => {
              const list = await listPayouts(session.company_code, session.contractor_code)
              setPayouts(list)
            }}
          />
        ) : tab === 'quotes' ? (
          <ContractorPortalQuotesTab session={session} onError={setError} />
        ) : (
          <ComingSoon tab={TABS.find(t => t.key === tab)?.label ?? tab} />
        )}
      </div>
    </ContractorPortalShell>
  )
}

function HomeTab({
  name, profile, openJobs, outstanding, openVisit,
  onGoJobs, onGoInfo, onGoPayments, onGoCompliance, onGoBanking,
}: {
  name: string
  profile: ContractorPortalProfile | null
  openJobs: number
  outstanding: number
  openVisit: OpenVisit | null
  onGoJobs: () => void
  onGoInfo: () => void
  onGoPayments: () => void
  onGoCompliance: () => void
  onGoBanking: () => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-white text-[20px] font-bold">Welcome, {name}</h1>
        <p className="text-slate-400 text-[13px] mt-0.5">Your contractor workspace</p>
      </div>

      {(profile?.payment_hold || profile?.compliance_hold) && (
        <div className="space-y-2">
          {profile.payment_hold && (
            <Alert tone="error" title="Payment hold" body="Your account has a payment hold. Contact your contracting company." />
          )}
          {profile.compliance_hold && (
            <Alert tone="warning" title="Compliance hold" body="Compliance documents are incomplete or expired. Update them under Compliance." />
          )}
        </div>
      )}

      {openVisit?.sign_in_at && (
        <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)' }}>
          <p className="text-[13px] font-semibold text-green-300">
            On site · since {new Date(openVisit.sign_in_at).toLocaleTimeString('en-ZA', { hour: 'numeric', minute: '2-digit' })}
            {openVisit.job_title ? ` · ${openVisit.job_title}` : ''}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Kpi label="Open jobs" value={String(openJobs)} onClick={onGoJobs} />
        <Kpi label="Outstanding" value={moneyZAR(outstanding)} onClick={onGoPayments} />
      </div>

      <div className="rounded-xl border divide-y overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <QuickLink label="My information" sub="View and edit your profile" onClick={onGoInfo} />
        <QuickLink label="Jobs" sub="Assigned jobs and site visits" onClick={onGoJobs} />
        <QuickLink label="Banking" sub="Masked details and HR update requests" onClick={onGoBanking} />
        <QuickLink label="Payments" sub="Payouts and invoices" onClick={onGoPayments} />
        <QuickLink label="Compliance" sub="Documents and pack status" onClick={onGoCompliance} />
      </div>
    </div>
  )
}

function JobsTab({ jobs }: { jobs: ContractorJob[] }) {
  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <span className="material-icons text-[48px] text-slate-600">work_off</span>
        <p className="text-[15px] font-semibold text-white">No jobs assigned</p>
        <p className="text-[13px] text-slate-500">Jobs assigned to you will appear here.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <h2 className="text-white text-[18px] font-bold">Jobs</h2>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase">Code</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase">Job</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase">Status</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase">Cost</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(j => (
              <tr key={j.id} className="border-t hover:bg-white/[0.03]" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                <td className="px-3 py-3 text-slate-400 whitespace-nowrap">{j.job_code || '—'}</td>
                <td className="px-3 py-3">
                  <Link href={`/contractor-portal/jobs/${j.id}`} className="text-white font-semibold hover:text-blue-300">
                    {j.title}
                  </Link>
                </td>
                <td className="px-3 py-3 text-slate-300 whitespace-nowrap">{jobStatusLabel(j.status)}</td>
                <td className="px-3 py-3 text-slate-300 whitespace-nowrap">{moneyZAR(j.contractor_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function fmtBankDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function BankingTab({
  session,
  onError,
}: {
  session: ContractorPortalSession
  onError: (msg: string | null) => void
}) {
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<ContractorBankingStatus | null>(null)
  const [decision, setDecision] = useState<ContractorBankingDecision | null>(null)
  const [form, setForm] = useState({
    accountHolder: '',
    bankName: '',
    bankAccount: '',
    branchCode: '',
    accountType: 'cheque',
    swiftBic: '',
  })

  useEffect(() => {
    void loadBanking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.contractor_id, session.company_id])

  async function loadBanking() {
    setLoading(true)
    onError(null)
    try {
      const [s, d] = await Promise.all([
        getBanking(session.contractor_id, session.company_id),
        getLatestBankingDecision(session.contractor_id, session.company_id).catch(() => null),
      ])
      setStatus(s)
      setDecision(d)
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Could not load banking details.')
    }
    setLoading(false)
  }

  async function onSubmit() {
    if (!form.accountHolder.trim()) {
      onError('Account holder name is required.')
      return
    }
    if (!form.bankName.trim()) {
      onError('Bank name is required.')
      return
    }
    if (!form.bankAccount.trim()) {
      onError('Account number is required.')
      return
    }
    if (decision?.status === 'pending') {
      const ok = window.confirm(
        'You already have a pending banking update awaiting HR review. '
        + 'Submitting new details will replace your previous submission. Continue?',
      )
      if (!ok) return
    }

    setSubmitting(true)
    onError(null)
    try {
      await submitBanking(session.contractor_id, session.company_id, {
        accountHolder: form.accountHolder,
        bankName: form.bankName,
        bankAccount: form.bankAccount,
        branchCode: form.branchCode,
        accountType: form.accountType,
        swiftBic: form.swiftBic,
      })
      setForm({
        accountHolder: '',
        bankName: '',
        bankAccount: '',
        branchCode: '',
        accountType: 'cheque',
        swiftBic: '',
      })
      await loadBanking()
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Could not submit banking update.')
    }
    setSubmitting(false)
  }

  if (loading) {
    return <div className="py-16 text-center text-slate-400 text-[14px]">Loading banking…</div>
  }

  const pending = decision?.status === 'pending'
  const approved = decision?.status === 'approved'
  const rejected = decision?.status === 'rejected'

  return (
    <div className="space-y-4">
      <h2 className="text-white text-[18px] font-bold">Banking</h2>

      <Section title="Current banking">
        <div className="flex flex-wrap gap-2 mb-2">
          <Badge
            ok={Boolean(status?.banking_verified)}
            okLabel="Banking verified"
            badLabel="Banking unverified"
          />
          {status?.payment_hold && <Badge ok={false} okLabel="" badLabel="Payment hold" />}
          {status?.compliance_hold && <Badge ok={false} okLabel="" badLabel="Compliance hold" />}
        </div>
        <Row label="Account holder" value={status?.account_holder_name || '—'} />
        <Row label="Bank" value={status?.bank_name || '—'} />
        <Row
          label="Account"
          value={status?.masked_account || (status?.has_banking_details ? '—' : 'No account on file')}
        />
        <Row label="Branch code" value={status?.bank_branch_code || '—'} />
        <Row label="Account type" value={accountTypeLabel(status?.account_type)} />
        <Row label="SWIFT / BIC" value={status?.swift_bic || '—'} />
        <Row label="Payment terms" value={paymentTermsLabel(status?.payment_terms ?? null)} />
        <Row label="Payment method" value={paymentMethodLabel(status?.preferred_payment_method ?? null)} />
      </Section>

      {pending && decision && (
        <DecisionBanner tone="pending" title="Banking update pending HR review" decision={decision} />
      )}
      {approved && decision && (
        <DecisionBanner
          tone="approved"
          title="Banking update approved by HR"
          decision={decision}
          note="Your banking details have been updated and are now active. Banking verification may still be required by HR before payments are released."
        />
      )}
      {rejected && decision && (
        <DecisionBanner tone="rejected" title="Banking update rejected by HR" decision={decision} />
      )}

      <Section title="Submit banking update">
        <p className="text-[12px] text-slate-500 mb-3">
          Banking changes require HR approval and will not take effect until reviewed.
        </p>
        <div className="space-y-3">
          <Field
            label="Account holder *"
            value={form.accountHolder}
            onChange={v => setForm({ ...form, accountHolder: v })}
          />
          <Field
            label="Bank name *"
            value={form.bankName}
            onChange={v => setForm({ ...form, bankName: v })}
          />
          <Field
            label="Account number *"
            value={form.bankAccount}
            onChange={v => setForm({ ...form, bankAccount: v })}
          />
          <Field
            label="Branch code"
            value={form.branchCode}
            onChange={v => setForm({ ...form, branchCode: v })}
          />
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-500 uppercase">Account type</label>
            <select
              className="w-full h-10 px-3 rounded-lg text-[13px] text-white"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
              value={form.accountType}
              onChange={e => setForm({ ...form, accountType: e.target.value })}
            >
              {BANK_ACCOUNT_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>
              ))}
            </select>
          </div>
          <Field
            label="SWIFT / BIC"
            value={form.swiftBic}
            onChange={v => setForm({ ...form, swiftBic: v })}
          />
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={submitting}
            className="h-10 px-4 rounded-xl bg-blue-600 text-white font-semibold text-[13px] disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit for HR review'}
          </button>
        </div>
      </Section>
    </div>
  )
}

function Badge({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  return (
    <span
      className={`inline-flex text-[11px] font-semibold px-2 py-1 rounded-md ${
        ok ? 'text-green-300' : 'text-slate-400'
      }`}
      style={{ background: ok ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)' }}
    >
      {ok ? okLabel : badLabel}
    </span>
  )
}

function DecisionBanner({
  tone,
  title,
  decision,
  note,
}: {
  tone: 'pending' | 'approved' | 'rejected'
  title: string
  decision: ContractorBankingDecision
  note?: string
}) {
  const colors = tone === 'pending'
    ? { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', text: 'text-amber-300' }
    : tone === 'approved'
      ? { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.3)', text: 'text-green-300' }
      : { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', text: 'text-red-300' }

  return (
    <div className="rounded-xl px-4 py-3 space-y-2" style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
      <p className={`text-[13px] font-semibold ${colors.text}`}>{title}</p>
      <div className="space-y-1">
        <Row label="Submitted" value={fmtBankDate(decision.submitted_at)} />
        {decision.reviewed_at && <Row label="Reviewed" value={fmtBankDate(decision.reviewed_at)} />}
        <Row label="Account holder" value={decision.account_holder_name || '—'} />
        <Row label="Bank" value={decision.bank_name || '—'} />
        <Row label="Account" value={decision.masked_account || '—'} />
        <Row label="Branch" value={decision.bank_branch_code || '—'} />
        <Row label="Type" value={accountTypeLabel(decision.account_type)} />
        {tone === 'rejected' && decision.rejection_reason && (
          <Row label="Reason" value={decision.rejection_reason} />
        )}
      </div>
      {note && <p className="text-[12px] text-slate-400">{note}</p>}
    </div>
  )
}

function InformationTab({
  profile, editing, edit, setEdit, saving, onEdit, onCancel, onSave,
}: {
  profile: ContractorPortalProfile | null
  editing: boolean
  edit: {
    name: string
    registration_number: string
    tax_number: string
    is_vat_registered: boolean
    vat_number: string
    contact_person: string
    phone: string
    email: string
    address: string
  }
  setEdit: (v: typeof edit) => void
  saving: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
}) {
  if (!profile) {
    return <p className="text-slate-400 text-[14px] py-8 text-center">Profile could not be loaded.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-white text-[18px] font-bold">Information</h2>
        {!editing ? (
          <button type="button" onClick={onEdit} className="text-[12px] font-semibold text-blue-400 hover:underline">
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="text-[12px] font-semibold text-slate-400 px-3 py-1.5">
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="text-[12px] font-semibold bg-blue-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <Section title="Business details">
        {editing ? (
          <div className="space-y-3">
            <Field label="Trading name *" value={edit.name} onChange={v => setEdit({ ...edit, name: v })} />
            <Field label="Registration number" value={edit.registration_number} onChange={v => setEdit({ ...edit, registration_number: v })} />
            <Field label="Tax number" value={edit.tax_number} onChange={v => setEdit({ ...edit, tax_number: v })} />
            <label className="flex items-center gap-2 text-[13px] text-slate-300">
              <input
                type="checkbox"
                checked={edit.is_vat_registered}
                onChange={e => setEdit({ ...edit, is_vat_registered: e.target.checked })}
                className="accent-blue-500"
              />
              VAT registered
            </label>
            {edit.is_vat_registered && (
              <Field label="VAT number" value={edit.vat_number} onChange={v => setEdit({ ...edit, vat_number: v })} />
            )}
          </div>
        ) : (
          <>
            <Row label="Trading name" value={profile.name} />
            <Row label="Type" value={partnerKindLabel(profile.partner_kind)} />
            <Row label="Registration" value={profile.registration_number ?? '—'} />
            <Row label="Tax number" value={profile.tax_number ?? '—'} />
            <Row
              label="VAT"
              value={profile.is_vat_registered
                ? `Registered — ${profile.vat_number || 'no number on file'}`
                : 'Not registered'}
            />
            <Row label="Contractor code" value={profile.contractor_code || '—'} />
            <Row label="Company" value={`${profile.company_name || '—'} (${profile.company_code || '—'})`} />
          </>
        )}
      </Section>

      <Section title="Contact">
        {editing ? (
          <div className="space-y-3">
            <Field label="Contact person" value={edit.contact_person} onChange={v => setEdit({ ...edit, contact_person: v })} />
            <Field label="Phone" value={edit.phone} onChange={v => setEdit({ ...edit, phone: v })} />
            <Field label="Email" value={edit.email} onChange={v => setEdit({ ...edit, email: v })} />
            <Field label="Address" value={edit.address} onChange={v => setEdit({ ...edit, address: v })} />
          </div>
        ) : (
          <>
            <Row label="Contact person" value={profile.contact_person ?? '—'} />
            <Row label="Phone" value={profile.phone ?? '—'} />
            <Row label="Email" value={profile.email ?? '—'} />
            <Row label="Address" value={profile.address ?? '—'} />
          </>
        )}
      </Section>

      <Section title="Account status (read-only)">
        <Row label="Active" value={profile.is_active ? 'Yes' : 'Inactive'} />
        <Row label="Banking verified" value={profile.banking_verified ? 'Yes' : 'No'} />
        <Row label="Payment hold" value={profile.payment_hold ? 'Yes' : 'No'} />
        <Row label="Compliance hold" value={profile.compliance_hold ? 'Yes' : 'No'} />
        <Row label="Payment terms" value={paymentTermsLabel(profile.payment_terms)} />
        <Row label="Preferred method" value={paymentMethodLabel(profile.preferred_payment_method)} />
        <Row label="Compliance pack" value={profile.compliance_pack_name || 'No pack assigned'} />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
      <div className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{title}</p>
      </div>
      <div className="px-4 py-3 space-y-2">{children}</div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 text-right">{value}</span>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-slate-500 uppercase">{label}</label>
      <input
        className="w-full h-10 px-3 rounded-lg text-[13px] text-white"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

function Kpi({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl px-4 py-3 text-left border hover:border-blue-500/50 transition-colors"
      style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
    >
      <p className="text-[11px] font-semibold text-slate-500 uppercase">{label}</p>
      <p className="text-[20px] font-bold text-white mt-1">{value}</p>
    </button>
  )
}

function QuickLink({ label, sub, onClick, soon }: { label: string; sub: string; onClick: () => void; soon?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]">
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-white">
          {label}
          {soon && <span className="ml-2 text-[10px] text-slate-500 font-bold uppercase">Soon</span>}
        </p>
        <p className="text-[12px] text-slate-500">{sub}</p>
      </div>
      <span className="material-icons text-slate-600 text-[18px]">chevron_right</span>
    </button>
  )
}

function Alert({ tone, title, body }: { tone: 'error' | 'warning'; title: string; body: string }) {
  const colors = tone === 'error'
    ? { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', text: 'text-red-300' }
    : { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', text: 'text-amber-300' }
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
      <p className={`text-[13px] font-semibold ${colors.text}`}>{title}</p>
      <p className="text-[12px] text-slate-400 mt-0.5">{body}</p>
    </div>
  )
}

function ComingSoon({ tab }: { tab: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-2 text-center">
      <span className="material-icons text-[48px] text-slate-600">construction</span>
      <p className="text-[15px] font-semibold text-white">{tab}</p>
      <p className="text-[13px] text-slate-500 max-w-sm">This section is next in the contractor portal rollout.</p>
    </div>
  )
}
