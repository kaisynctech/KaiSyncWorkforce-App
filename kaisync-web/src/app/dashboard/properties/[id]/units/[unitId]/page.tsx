'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { unitTypeLabel } from '@/lib/properties'
import {
  createRentInvoiceForLease,
  depositStatusLabel,
  isFunderPayer,
  payerTypeLabel,
  resolveRentBillToClientId,
  summarizeLeaseRentStatus,
} from '@/lib/lease-billing'
import { summarizeLeaseNotice } from '@/lib/lease-lifecycle'
import { recordInvoicePayment } from '@/lib/finance-api'
import { PropertyMaintenancePanel } from '@/components/properties/PropertyMaintenancePanel'
import { LeaseNoticeMoveOutModal } from '@/components/properties/LeaseNoticeMoveOutModal'
import type {
  PropertyLease,
  PropertyLeaseDocument,
  Resident,
  Site,
  Unit,
} from '@/types/database'

type RentInvoiceRow = {
  id: string
  lease_id: string | null
  invoice_number: string | null
  status: string
  total_amount: number
  amount_paid: number
  balance_due: number
  due_date: string | null
  issue_date: string | null
  invoice_type: string | null
  currency: string
}

type PaymentProofRow = {
  id: string
  invoice_id: string
  lease_id: string | null
  amount: number | null
  reference: string | null
  status: string
  file_url: string | null
  submitted_at: string
}

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
}

const fmtMoney = (n: number | null | undefined, currency = 'ZAR') => {
  if (n == null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)
}

export default function UnitDetailPage() {
  const { id: siteId, unitId } = useParams<{ id: string; unitId: string }>()
  const router = useRouter()

  const [site, setSite] = useState<Site | null>(null)
  const [unit, setUnit] = useState<Unit | null>(null)
  const [residents, setResidents] = useState<Resident[]>([])
  const [leases, setLeases] = useState<PropertyLease[]>([])
  const [docs, setDocs] = useState<PropertyLeaseDocument[]>([])
  const [invoices, setInvoices] = useState<RentInvoiceRow[]>([])
  const [proofs, setProofs] = useState<PaymentProofRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [leaseLifecycleMode, setLeaseLifecycleMode] = useState<'notice' | 'moveout' | null>(null)

  const canEdit = can(perms, PERM.propertiesEdit)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) {
      setError('not_linked')
      setLoading(false)
      return
    }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

    const [sRes, uRes, rRes, lRes] = await Promise.all([
      supabase.from('sites').select('*').eq('id', siteId).eq('company_id', member.companyId).maybeSingle(),
      supabase.from('units').select('*').eq('id', unitId).eq('site_id', siteId).eq('company_id', member.companyId).maybeSingle(),
      supabase.from('residents').select('*').eq('unit_id', unitId).eq('company_id', member.companyId).order('move_in_date', { ascending: false }),
      supabase.from('property_leases').select('*').eq('unit_id', unitId).eq('company_id', member.companyId).order('start_date', { ascending: false }),
    ])

    if (sRes.error) setError(sRes.error.message)
    if (uRes.error) setError(uRes.error.message)
    if (!uRes.data) {
      setError('Unit not found')
      setLoading(false)
      return
    }

    setSite(sRes.data as Site | null)
    setUnit(uRes.data as Unit)
    setResidents((rRes.data ?? []) as Resident[])
    const leaseRows = (lRes.data ?? []) as PropertyLease[]
    setLeases(leaseRows)

    const leaseIds = leaseRows.map(l => l.id)
    if (leaseIds.length > 0) {
      const [dRes, iRes, pRes] = await Promise.all([
        supabase.from('property_lease_documents').select('*').in('lease_id', leaseIds).eq('company_id', member.companyId),
        supabase
          .from('finance_invoices')
          .select('id, lease_id, invoice_number, status, total_amount, amount_paid, balance_due, due_date, issue_date, invoice_type, currency')
          .in('lease_id', leaseIds)
          .eq('company_id', member.companyId)
          .eq('invoice_type', 'rent')
          .order('issue_date', { ascending: false }),
        supabase
          .from('finance_payment_proofs')
          .select('id, invoice_id, lease_id, amount, reference, status, file_url, submitted_at')
          .in('lease_id', leaseIds)
          .eq('company_id', member.companyId)
          .order('submitted_at', { ascending: false }),
      ])
      setDocs((dRes.data ?? []) as PropertyLeaseDocument[])
      setInvoices((iRes.data ?? []) as RentInvoiceRow[])
      setProofs((pRes.data ?? []) as PaymentProofRow[])
    } else {
      setDocs([])
      setInvoices([])
      setProofs([])
    }

    setLoading(false)
  }, [siteId, unitId])

  useEffect(() => { void load() }, [load])

  const currentOccupants = useMemo(() => residents.filter(r => !r.move_out_date), [residents])
  const formerOccupants = useMemo(() => residents.filter(r => !!r.move_out_date), [residents])
  const activeLease = useMemo(() => leases.find(l => l.status === 'active') ?? null, [leases])
  const leaseInvoices = useMemo(
    () => (activeLease ? invoices.filter(i => i.lease_id === activeLease.id) : invoices),
    [invoices, activeLease],
  )
  const rentStatus = useMemo(
    () => (activeLease ? summarizeLeaseRentStatus(activeLease, leaseInvoices) : null),
    [activeLease, leaseInvoices],
  )
  const noticeStatus = useMemo(
    () => (activeLease ? summarizeLeaseNotice(activeLease) : null),
    [activeLease],
  )
  const arrearsTotal = useMemo(
    () => leaseInvoices.reduce((sum, inv) => sum + (Number(inv.balance_due) || 0), 0),
    [leaseInvoices],
  )
  const pendingProofs = useMemo(() => proofs.filter(p => p.status === 'submitted'), [proofs])
  const displayRent = activeLease?.rent_amount ?? unit?.default_rent_amount ?? null
  const displayCurrency = activeLease?.currency ?? unit?.default_rent_currency ?? 'ZAR'

  async function invoiceThisMonth() {
    if (!companyId || !employeeId || !activeLease || !canEdit) return
    if (isFunderPayer(activeLease.payer_type) && !activeLease.payer_client_id) {
      setError('Set a bill-to bursary/sponsor client on the lease before invoicing.')
      return
    }
    setInvoiceBusy(true)
    setError(null)
    const supabase = createClient()
    const result = await createRentInvoiceForLease(supabase, {
      companyId,
      employeeId,
      lease: activeLease,
      clientId: resolveRentBillToClientId(activeLease, site?.client_id ?? null),
      send: true,
      vatPercent: 0,
    })
    setInvoiceBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    await load()
    if (!result.created) {
      setError('Already invoiced for this month — opening existing invoice.')
    }
    router.push(`/dashboard/money/invoices/${result.invoiceId}`)
  }

  async function reviewProof(proof: PaymentProofRow, status: 'accepted' | 'rejected', recordPayment: boolean) {
    if (!companyId || !employeeId || !canEdit) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: e } = await supabase.from('finance_payment_proofs').update({
      status,
      reviewed_by: employeeId,
      reviewed_at: new Date().toISOString(),
    }).eq('id', proof.id).eq('company_id', companyId)
    if (e) {
      setBusy(false)
      setError(e.message)
      return
    }
    if (status === 'accepted' && recordPayment && proof.amount && proof.amount > 0) {
      try {
        await recordInvoicePayment(
          supabase,
          proof.invoice_id,
          Number(proof.amount),
          'eft',
          employeeId,
          null,
          { referenceNumber: proof.reference, notes: 'Accepted tenant payment proof' },
        )
      } catch (err) {
        setBusy(false)
        setError(err instanceof Error ? err.message : 'Proof accepted but payment record failed')
        await load()
        return
      }
    }
    setBusy(false)
    await load()
  }

  if (error === 'not_linked') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[13px] text-text-secondary">Account not linked to an employee.</p>
      </div>
    )
  }

  if (loading) {
    return <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
  }

  if (!unit || !site) {
    return (
      <div className="p-4 space-y-2">
        <p className="text-[13px] text-error">{error ?? 'Unit not found'}</p>
        <button type="button" onClick={() => router.push(`/dashboard/properties/${siteId}?tab=units`)} className="text-[13px] text-primary hover:underline">
          Back to property
        </button>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 space-y-4 pb-12">
        <button
          type="button"
          onClick={() => router.push(`/dashboard/properties/${siteId}?tab=units`)}
          className="flex items-center gap-1 text-[13px] text-primary hover:underline"
        >
          <span className="material-icons text-[16px]">arrow_back</span>
          {site.name}
        </button>

        <div className="bg-surface border border-divider rounded-xl p-4 space-y-1">
          <h1 className="text-[20px] font-semibold text-text-primary">Unit {unit.unit_number}</h1>
          <p className="text-[13px] text-text-secondary">
            {unitTypeLabel(unit.unit_type)}
            {unit.floor ? ` · Floor ${unit.floor}` : ''}
            {` · ${unit.is_occupied ? 'Occupied' : 'Vacant'}`}
            {rentStatus ? ` · ${rentStatus.label}` : ''}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-surface border border-divider rounded-xl p-3">
            <p className="text-[11px] text-text-secondary">Rent</p>
            <p className="text-[15px] font-semibold text-text-primary">{fmtMoney(displayRent, displayCurrency)}</p>
            <p className="text-[10px] text-text-disabled">{activeLease ? 'Active lease' : 'List / default'}</p>
          </div>
          <div className="bg-surface border border-divider rounded-xl p-3">
            <p className="text-[11px] text-text-secondary">Deposit</p>
            <p className="text-[15px] font-semibold text-text-primary">
              {activeLease?.deposit_amount != null ? fmtMoney(activeLease.deposit_amount, displayCurrency) : '—'}
            </p>
            <p className="text-[10px] text-text-disabled">{depositStatusLabel(activeLease?.deposit_status)}</p>
          </div>
          <div className="bg-surface border border-divider rounded-xl p-3">
            <p className="text-[11px] text-text-secondary">Occupants</p>
            <p className="text-[15px] font-semibold text-text-primary">{currentOccupants.length}</p>
          </div>
          <div className="bg-surface border border-divider rounded-xl p-3">
            <p className="text-[11px] text-text-secondary">Arrears</p>
            <p className={`text-[15px] font-semibold ${arrearsTotal > 0 ? 'text-error' : 'text-text-primary'}`}>
              {fmtMoney(arrearsTotal, displayCurrency)}
            </p>
            {rentStatus && 'daysOverdue' in rentStatus && rentStatus.daysOverdue > 0 && (
              <p className="text-[10px] text-error">{rentStatus.daysOverdue} days overdue</p>
            )}
          </div>
        </div>

        <section className="bg-surface border border-divider rounded-xl p-4 space-y-3">
          <h2 className="text-[14px] font-semibold text-text-primary">Current occupants</h2>
          {currentOccupants.length === 0 ? (
            <p className="text-[13px] text-text-secondary">No one currently assigned to this unit.</p>
          ) : (
            <table className="w-full" style={{ minWidth: 520 }}>
              <thead>
                <tr className="border-b border-divider">
                  <th className="data-th text-left">Name</th>
                  <th className="data-th text-left">ID / Passport</th>
                  <th className="data-th text-left">Phone</th>
                  <th className="data-th text-left">Move in</th>
                  <th className="data-th text-left">Portal</th>
                </tr>
              </thead>
              <tbody>
                {currentOccupants.map(r => (
                  <tr key={r.id} className="border-b border-divider">
                    <td className="data-td text-[13px] font-medium">{r.name} {r.surname}</td>
                    <td className="data-td text-[12px] text-text-secondary">{r.id_number || r.passport_number || '—'}</td>
                    <td className="data-td text-[13px]">{r.phone ?? '—'}</td>
                    <td className="data-td text-[12px]">{fmtDate(r.move_in_date)}</td>
                    <td className="data-td text-[12px]">{r.portal_enabled ? (r.resident_code ?? 'On') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="bg-surface border border-divider rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-[14px] font-semibold text-text-primary">Lease & deposit</h2>
            <div className="flex gap-3 flex-wrap">
              {canEdit && activeLease && (
                <>
                  <button
                    type="button"
                    onClick={() => setLeaseLifecycleMode('notice')}
                    className="text-[12px] text-primary hover:underline"
                  >
                    Give notice
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeaseLifecycleMode('moveout')}
                    className="text-[12px] text-primary hover:underline"
                  >
                    Move-out
                  </button>
                  <button
                    type="button"
                    disabled={invoiceBusy || !activeLease.rent_amount}
                    onClick={() => void invoiceThisMonth()}
                    className="text-[12px] text-primary hover:underline disabled:opacity-40"
                  >
                    {invoiceBusy ? 'Invoicing…' : 'Invoice this month'}
                  </button>
                </>
              )}
              {canEdit && (
                <Link href={`/dashboard/properties/${siteId}?tab=leases`} className="text-[12px] text-primary hover:underline">
                  Manage leases →
                </Link>
              )}
            </div>
          </div>
          {!activeLease ? (
            <p className="text-[13px] text-text-secondary">No active lease on this unit.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[13px]">
              <p><span className="text-text-secondary">Tenant: </span>{activeLease.tenant_name ?? '—'}</p>
              <p><span className="text-text-secondary">Status: </span><span className="capitalize">{activeLease.status}</span></p>
              <p><span className="text-text-secondary">Period: </span>{fmtDate(activeLease.start_date)} – {fmtDate(activeLease.end_date)}</p>
              <p><span className="text-text-secondary">Rent: </span>{fmtMoney(activeLease.rent_amount, activeLease.currency)} / {activeLease.payment_frequency}</p>
              <p><span className="text-text-secondary">Deposit: </span>{fmtMoney(activeLease.deposit_amount, activeLease.currency)} · {depositStatusLabel(activeLease.deposit_status)}</p>
              <p><span className="text-text-secondary">Deposit paid: </span>
                {fmtMoney(activeLease.deposit_paid_amount, activeLease.currency)}
                {activeLease.deposit_paid_at ? ` · ${fmtDate(activeLease.deposit_paid_at)}` : ''}
              </p>
              <p><span className="text-text-secondary">Payer: </span>
                {payerTypeLabel(activeLease.payer_type)}
                {activeLease.sponsor_name ? ` · ${activeLease.sponsor_name}` : ''}
                {isFunderPayer(activeLease.payer_type) && (
                  <div className="text-[10px] text-text-disabled mt-0.5">
                    {activeLease.payer_client_id
                      ? 'Rent bills the funder client in Money'
                      : 'Bill-to client not set — edit lease before invoicing'}
                  </div>
                )}
              </p>
              <p><span className="text-text-secondary">Notice: </span>
                {noticeStatus ? (
                  <span className={noticeStatus.kind === 'overdue' || noticeStatus.kind === 'vacating_soon' ? 'text-error' : ''}>
                    {noticeStatus.label}
                  </span>
                ) : (
                  `${activeLease.notice_days ?? 30} days`
                )}
              </p>
              {rentStatus && (
                <p className="sm:col-span-2">
                  <span className="text-text-secondary">Payment: </span>
                  <span className={rentStatus.kind === 'overdue' ? 'text-error font-medium' : ''}>{rentStatus.label}</span>
                  {'balance' in rentStatus ? ` · balance ${fmtMoney(rentStatus.balance, displayCurrency)}` : ''}
                </p>
              )}
            </div>
          )}
        </section>

        {pendingProofs.length > 0 && (
          <section className="bg-surface border border-amber-200 dark:border-amber-900 rounded-xl p-4 space-y-3">
            <h2 className="text-[14px] font-semibold text-text-primary">Pending payment proofs</h2>
            {pendingProofs.map(p => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-[12px] border-b border-divider pb-2">
                <span>
                  {p.file_url ? (
                    <a href={p.file_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">View POP</a>
                  ) : 'POP'}
                  {p.amount != null ? ` · ${fmtMoney(Number(p.amount))}` : ''}
                  {p.reference ? ` · Ref ${p.reference}` : ''}
                  <span className="text-text-disabled"> · {fmtDate(p.submitted_at?.slice(0, 10))}</span>
                </span>
                {canEdit && (
                  <span className="flex gap-2">
                    <button type="button" disabled={busy} className="text-primary hover:underline" onClick={() => void reviewProof(p, 'accepted', true)}>
                      Accept + record
                    </button>
                    <button type="button" disabled={busy} className="text-primary hover:underline" onClick={() => void reviewProof(p, 'accepted', false)}>
                      Accept
                    </button>
                    <button type="button" disabled={busy} className="text-error hover:underline" onClick={() => void reviewProof(p, 'rejected', false)}>
                      Reject
                    </button>
                  </span>
                )}
              </div>
            ))}
          </section>
        )}

        <section className="bg-surface border border-divider rounded-xl p-4 space-y-3">
          <h2 className="text-[14px] font-semibold text-text-primary">Work & maintenance</h2>
          {companyId && (
            <PropertyMaintenancePanel
              companyId={companyId}
              siteId={siteId}
              unitId={unitId}
              employeeId={employeeId}
              canEdit={canEdit}
            />
          )}
        </section>

        <section className="bg-surface border border-divider rounded-xl p-4 space-y-3">
          <h2 className="text-[14px] font-semibold text-text-primary">Documents</h2>
          {docs.length === 0 ? (
            <p className="text-[13px] text-text-secondary">No lease documents for this unit yet.</p>
          ) : (
            <table className="w-full" style={{ minWidth: 400 }}>
              <thead>
                <tr className="border-b border-divider">
                  <th className="data-th text-left">Name</th>
                  <th className="data-th text-left">Type</th>
                  <th className="data-th text-left">Date</th>
                </tr>
              </thead>
              <tbody>
                {docs.map(d => (
                  <tr key={d.id} className="border-b border-divider">
                    <td className="data-td text-[13px]">
                      {d.file_url ? (
                        <a href={d.file_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{d.document_name}</a>
                      ) : d.document_name}
                    </td>
                    <td className="data-td text-[12px] capitalize">{d.document_type}</td>
                    <td className="data-td text-[12px]">{fmtDate(d.created_at?.slice(0, 10))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="bg-surface border border-divider rounded-xl p-4 space-y-3">
          <h2 className="text-[14px] font-semibold text-text-primary">Payment history</h2>
          {leaseInvoices.length === 0 ? (
            <p className="text-[13px] text-text-secondary">No rent invoices linked to leases on this unit.</p>
          ) : (
            <table className="w-full" style={{ minWidth: 560 }}>
              <thead>
                <tr className="border-b border-divider">
                  <th className="data-th text-left">Invoice</th>
                  <th className="data-th text-left">Issued</th>
                  <th className="data-th text-left">Due</th>
                  <th className="data-th text-right">Total</th>
                  <th className="data-th text-right">Paid</th>
                  <th className="data-th text-right">Balance</th>
                  <th className="data-th text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {leaseInvoices.map(inv => (
                  <tr
                    key={inv.id}
                    className="border-b border-divider hover:bg-surface-elevated cursor-pointer"
                    onClick={() => router.push(`/dashboard/money/invoices/${inv.id}`)}
                  >
                    <td className="data-td text-[13px] text-primary">{inv.invoice_number ?? inv.id.slice(0, 8)}</td>
                    <td className="data-td text-[12px]">{fmtDate(inv.issue_date)}</td>
                    <td className="data-td text-[12px]">{fmtDate(inv.due_date)}</td>
                    <td className="data-td text-[13px] text-right">{fmtMoney(inv.total_amount, inv.currency)}</td>
                    <td className="data-td text-[13px] text-right">{fmtMoney(inv.amount_paid, inv.currency)}</td>
                    <td className="data-td text-[13px] text-right">{fmtMoney(inv.balance_due, inv.currency)}</td>
                    <td className="data-td text-[12px] capitalize">{inv.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {formerOccupants.length > 0 && (
          <section className="bg-surface border border-divider rounded-xl p-4 space-y-3">
            <h2 className="text-[14px] font-semibold text-text-primary">Former occupants</h2>
            <table className="w-full" style={{ minWidth: 480 }}>
              <thead>
                <tr className="border-b border-divider">
                  <th className="data-th text-left">Name</th>
                  <th className="data-th text-left">Move in</th>
                  <th className="data-th text-left">Move out</th>
                </tr>
              </thead>
              <tbody>
                {formerOccupants.map(r => (
                  <tr key={r.id} className="border-b border-divider opacity-70">
                    <td className="data-td text-[13px]">{r.name} {r.surname}</td>
                    <td className="data-td text-[12px]">{fmtDate(r.move_in_date)}</td>
                    <td className="data-td text-[12px]">{fmtDate(r.move_out_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {error && error !== 'not_linked' && (
          <p className="text-[13px] text-error">{error}</p>
        )}
      </div>

      {leaseLifecycleMode && companyId && activeLease && (
        <LeaseNoticeMoveOutModal
          companyId={companyId}
          lease={activeLease}
          mode={leaseLifecycleMode}
          onClose={() => setLeaseLifecycleMode(null)}
          onDone={() => { void load() }}
        />
      )}
    </div>
  )
}
