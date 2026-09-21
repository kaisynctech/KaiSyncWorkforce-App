'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { calculateVatExclusive, roundFinancial } from '@/lib/finance-calc'

type ClientOpt = { id: string; name: string }
type JobOpt = { id: string; title: string; job_code: string | null }

export default function NewMoneyInvoicePage() {
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <NewMoneyInvoiceInner />
    </Suspense>
  )
}

function NewMoneyInvoiceInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [clients, setClients] = useState<ClientOpt[]>([])
  const [jobs, setJobs] = useState<JobOpt[]>([])
  const [clientId, setClientId] = useState(() => searchParams.get('clientId') ?? searchParams.get('client_id') ?? '')
  const [jobId, setJobId] = useState(() => searchParams.get('job_id') ?? '')
  const [dealId, setDealId] = useState(() => searchParams.get('deal_id') ?? searchParams.get('project_id') ?? '')
  const [leaseId, setLeaseId] = useState(() => searchParams.get('lease_id') ?? '')
  const [siteId, setSiteId] = useState(() => searchParams.get('site_id') ?? '')
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')
  const [description, setDescription] = useState('Professional services')
  const [amount, setAmount] = useState('0')
  const [vatRate, setVatRate] = useState('15')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [leaseHint, setLeaseHint] = useState<string | null>(null)

  useEffect(() => {
    const fromQuery = searchParams.get('clientId') ?? searchParams.get('client_id')
    if (fromQuery) setClientId(fromQuery)
    const fromJob = searchParams.get('job_id')
    if (fromJob) setJobId(fromJob)
    const fromDeal = searchParams.get('deal_id') ?? searchParams.get('project_id')
    if (fromDeal) setDealId(fromDeal)
    const fromLease = searchParams.get('lease_id')
    if (fromLease) setLeaseId(fromLease)
    const fromSite = searchParams.get('site_id')
    if (fromSite) setSiteId(fromSite)
  }, [searchParams])

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) return
      const [{ data: clientRows }, { data: jobRows }] = await Promise.all([
        supabase
          .from('clients')
          .select('id, name')
          .eq('company_id', member.companyId)
          .order('name'),
        supabase
          .from('jobs')
          .select('id, title, job_code')
          .eq('company_id', member.companyId)
          .order('created_at', { ascending: false })
          .limit(200),
      ])
      setClients((clientRows ?? []) as ClientOpt[])
      setJobs((jobRows ?? []) as JobOpt[])

      const lid = searchParams.get('lease_id')
      if (!lid) return
      const { data: lease } = await supabase
        .from('property_leases')
        .select('id, site_id, unit_id, tenant_client_id, tenant_name, rent_amount, currency, payment_frequency, start_date, end_date, units(unit_number), sites(name)')
        .eq('id', lid)
        .eq('company_id', member.companyId)
        .maybeSingle()
      if (!lease) return
      setLeaseId(lease.id)
      setSiteId(lease.site_id)
      if (lease.tenant_client_id) setClientId(lease.tenant_client_id)
      if (lease.rent_amount != null) setAmount(String(lease.rent_amount))
      setVatRate('0')
      const unitNo = (lease as { units?: { unit_number?: string } | null }).units?.unit_number
      const siteName = (lease as { sites?: { name?: string } | null }).sites?.name
      const period = new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(new Date())
      const desc = [
        'Rent',
        siteName,
        unitNo ? `Unit ${unitNo}` : null,
        period,
        lease.payment_frequency,
      ].filter(Boolean).join(' · ')
      setDescription(desc)
      const endOfMonth = new Date()
      endOfMonth.setMonth(endOfMonth.getMonth() + 1, 0)
      setDueDate(endOfMonth.toISOString().slice(0, 10))
      setLeaseHint(
        lease.tenant_client_id
          ? 'Prefill from lease (rent invoice).'
          : 'Lease has no tenant client — select the billable client before saving.',
      )
    })()
  }, [searchParams])

  async function save(send: boolean) {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setBusy(false); return }

    if (leaseId && !clientId) {
      setError('Rent invoices need a client (link tenant client on the lease, or select one here).')
      setBusy(false)
      return
    }

    const rate = Number(vatRate) / 100
    const calc = calculateVatExclusive(Number(amount) || 0, rate)
    let invoiceNumber: string | null = null
    if (send) {
      const { data: num } = await (supabase.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: string | null }>)('generate_invoice_number', { p_company_id: member.companyId })
      invoiceNumber = num ?? null
    }

    const now = new Date().toISOString()
    const isRent = Boolean(leaseId)
    const { data: inv, error: e } = await supabase
      .from('finance_invoices')
      .insert({
        company_id: member.companyId,
        client_id: clientId || null,
        job_id: jobId || null,
        deal_id: dealId || null,
        project_id: dealId || null,
        lease_id: leaseId || null,
        site_id: siteId || null,
        invoice_number: invoiceNumber,
        status: send ? 'sent' : 'draft',
        sent_at: send ? now : null,
        currency: 'ZAR',
        subtotal: calc.subtotal,
        vat_rate: rate,
        vat_amount: calc.vatAmount,
        total_amount: calc.totalAmount,
        amount_paid: 0,
        balance_due: calc.totalAmount,
        is_vat_inclusive: false,
        tax_type: 'standard',
        issue_date: issueDate,
        due_date: dueDate || null,
        created_by: member.employeeId,
        invoice_type: isRent ? 'rent' : 'standard',
      })
      .select('id')
      .single()

    if (e || !inv) {
      setError(e?.message ?? 'Failed to create invoice')
      setBusy(false)
      return
    }

    await supabase.from('finance_invoice_lines').insert({
      invoice_id: inv.id,
      company_id: member.companyId,
      line_no: 1,
      description: description.trim() || 'Line item',
      quantity: 1,
      unit_price: roundFinancial(Number(amount) || 0),
      vat_rate: rate,
      vat_amount: calc.vatAmount,
      subtotal: calc.subtotal,
      total_amount: calc.totalAmount,
      is_vat_inclusive: false,
      tax_type: 'standard',
    })

    const q = send ? '' : '?whats_next=1'
    router.replace(`/dashboard/money/invoices/${inv.id}${q}`)
  }

  return (
    <div className="h-full overflow-y-auto p-4 max-w-lg mx-auto space-y-4">
      <h1 className="text-[18px] font-semibold text-text-primary">
        {leaseId ? 'New rent invoice' : 'New Invoice'}
      </h1>
      {leaseHint && <p className="text-[12px] text-text-secondary">{leaseHint}</p>}
      {error && <p className="text-[13px] text-error">{error}</p>}
      <label className="block text-[12px] text-text-secondary">Client
        <select value={clientId} onChange={e => setClientId(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
          <option value="">Select client…</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {!leaseId && (
        <label className="block text-[12px] text-text-secondary">Job (optional)
          <select value={jobId} onChange={e => setJobId(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
            <option value="">— None —</option>
            {jobs.map(j => (
              <option key={j.id} value={j.id}>
                {j.job_code ? `${j.job_code} · ${j.title}` : j.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {jobId && !leaseId && (
        <Link href={`/dashboard/jobs/${jobId}`} className="text-[12px] text-primary hover:underline">
          Open job
        </Link>
      )}
      {siteId && (
        <Link href={`/dashboard/properties/${siteId}?tab=leases`} className="text-[12px] text-primary hover:underline block">
          Back to property leases
        </Link>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[12px] text-text-secondary">Issue date
          <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
        </label>
        <label className="block text-[12px] text-text-secondary">Due date
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
        </label>
      </div>
      <label className="block text-[12px] text-text-secondary">Description
        <input value={description} onChange={e => setDescription(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[12px] text-text-secondary">Amount (ex VAT)
          <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
        </label>
        <label className="block text-[12px] text-text-secondary">VAT %
          <input type="number" step="0.01" value={vatRate} onChange={e => setVatRate(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
        </label>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={() => router.back()} className="btn-outlined h-10 px-4 text-[13px]">Cancel</button>
        <button onClick={() => void save(false)} disabled={busy} className="btn-outlined h-10 px-4 text-[13px] disabled:opacity-50">Save draft</button>
        <button onClick={() => void save(true)} disabled={busy} className="btn-primary h-10 px-4 text-[13px] disabled:opacity-50">{busy ? '…' : 'Save & send'}</button>
      </div>
    </div>
  )
}
