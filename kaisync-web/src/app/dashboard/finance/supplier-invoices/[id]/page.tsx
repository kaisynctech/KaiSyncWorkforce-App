'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import type { SupplierInvoice, SupplierInvoiceLine } from '@/lib/finance-types'
import { EmailDocumentDialog } from '@/components/money/EmailDocumentDialog'
import { emailedLabel, loadDocumentEmails, type DocumentEmailLog } from '@/lib/money/document-email'
import { approveSupplierInvoice, markSupplierPaid, rejectSupplierInvoice } from '@/lib/finance-api'
import { billCheck } from '@/lib/money/bill-match'
import type { ThreeWayMatchLine } from '@/types/commercial'
import { localISODate } from '@/lib/utils'

interface LinkedPo { id: string; po_number: string | null; total_amount: number; status: string }
interface UnlinkedPo { id: string; po_number: string | null; total_amount: number }

export default function SupplierInvoiceDetailPage() {
  const params = useParams<{ id: string }>()
  const invoiceId = params.id
  const [invoice, setInvoice] = useState<SupplierInvoice | null>(null)
  const [lines, setLines] = useState<SupplierInvoiceLine[]>([])
  const [linkedPo, setLinkedPo] = useState<LinkedPo | null>(null)
  const [unlinkedPos, setUnlinkedPos] = useState<UnlinkedPo[]>([])
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [linking, setLinking] = useState(false)
  const [paying, setPaying] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [supplierEmail, setSupplierEmail] = useState<string | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailLog, setEmailLog] = useState<DocumentEmailLog[]>([])
  const [actor, setActor] = useState<{ id: string; name: string } | null>(null)
  const [matchLines, setMatchLines] = useState<ThreeWayMatchLine[] | null>(null)
  // Pay form (a bill is paid only once it is approved)
  const [showPay, setShowPay] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState('')
  const [payMethod, setPayMethod] = useState('eft')
  const [payRef, setPayRef] = useState('')
  const [deciding, setDeciding] = useState(false)
  // Approving and paying bills: the existing payments.approve permission (owner and HR by default).
  const [canApprove, setCanApprove] = useState(false)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    void supabase.from('employees').select('name, surname').eq('id', member.employeeId).maybeSingle()
      .then(({ data: me }) => {
        const m = me as { name?: string | null; surname?: string | null } | null
        setActor({ id: member.employeeId, name: [m?.name, m?.surname].filter(Boolean).join(' ') || 'User' })
      })
    void supabase.rpc('user_has_permission', { p_company_id: member.companyId, p_key: 'payments.approve' })
      .then(({ data }) => setCanApprove(Boolean(data)))

    const [{ data: inv, error: invErr }, { data: lineRows, error: lineErr }] = await Promise.all([
      supabase
        .from('supplier_invoices')
        .select('*, contractors!supplier_invoices_supplier_id_fkey(name, email)')
        .eq('id', invoiceId)
        .eq('company_id', member.companyId)
        .maybeSingle(),
      supabase
        .from('supplier_invoice_lines')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('line_no'),
    ])

    if (invErr || !inv) {
      setError(invErr?.message ?? 'Invoice not found')
      setLoading(false)
      return
    }
    if (lineErr) setError(lineErr.message)
    const typedInv = inv as SupplierInvoice & { po_id?: string | null; project_id?: string | null }
    setInvoice(typedInv)
    setSupplierEmail((typedInv.contractors as { email?: string | null } | null)?.email ?? null)
    setEmailLog(await loadDocumentEmails(supabase, invoiceId, ['remittance_supplier']))
    setLines((lineRows ?? []) as SupplierInvoiceLine[])

    // Load linked PO if present
    if (typedInv.po_id) {
      const [{ data: poData }, { data: matchData }] = await Promise.all([
        supabase.from('purchase_orders').select('id, po_number, total_amount, status').eq('id', typedInv.po_id).maybeSingle(),
        supabase.from('po_three_way_match').select('*').eq('po_id', typedInv.po_id),
      ])
      setLinkedPo(poData as LinkedPo | null)
      setMatchLines((matchData ?? []) as ThreeWayMatchLine[])
    } else {
      setLinkedPo(null)
      setMatchLines(null)
      // Load unlinked POs for same supplier
      if (typedInv.supplier_id) {
        const { data: linkedInvoicePos } = await supabase
          .from('supplier_invoices')
          .select('po_id')
          .eq('company_id', member.companyId)
          .not('po_id', 'is', null)
        const taken = new Set(
          ((linkedInvoicePos ?? []) as { po_id: string | null }[])
            .map(r => r.po_id)
            .filter((id): id is string => Boolean(id)),
        )
        const { data: poRows } = await supabase
          .from('purchase_orders')
          .select('id, po_number, total_amount')
          .eq('company_id', member.companyId)
          .eq('supplier_id', typedInv.supplier_id)
          .in('status', ['approved', 'sent', 'partially_received', 'received'])
          .order('created_at', { ascending: false })
        setUnlinkedPos(
          ((poRows ?? []) as UnlinkedPo[]).filter(p => !taken.has(p.id)),
        )
      }
    }
    setLoading(false)
  }, [invoiceId])

  async function linkToPo(poId: string) {
    setLinking(true)
    const supabase = createClient()
    await supabase.from('supplier_invoices').update({ po_id: poId }).eq('id', invoiceId)
    setShowLinkModal(false)
    setLinking(false)
    showToast('Invoice linked to PO.')
    void load()
  }

  function openPay() {
    if (!invoice) return
    setError(null)
    setPayAmount(String(Number(invoice.balance_due ?? 0)))
    setPayDate(localISODate())
    setPayMethod('eft')
    setPayRef('')
    setShowPay(true)
  }

  async function decide(kind: 'approve' | 'reject', thenPay = false) {
    if (!invoice || !actor || deciding) return
    setDeciding(true)
    setError(null)
    try {
      const supabase = createClient()
      if (kind === 'approve') await approveSupplierInvoice(supabase, invoice.id, actor.id, actor.name)
      else await rejectSupplierInvoice(supabase, invoice.id, actor.id, actor.name)
      showToast(kind === 'approve' ? 'Bill approved.' : 'Bill rejected.')
      await load()
      if (thenPay) openPay()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the decision')
    }
    setDeciding(false)
  }

  async function recordPayment() {
    if (!invoice || paying) return
    const amount = Number(payAmount)
    const owed = Number(invoice.balance_due ?? 0)
    if (!(amount > 0)) { setError('Enter the amount you paid.'); return }
    if (amount > owed + 0.005) { setError(`That's more than the ${fmtMoney(owed)} still owed on this bill.`); return }
    setPaying(true)
    setError(null)
    const supabase = createClient()
    try {
      // Every supplier payment is its own entry (money record + history log), part payments allowed.
      await markSupplierPaid(supabase, invoice.id, amount, payMethod || null, actor?.id ?? null, actor?.name ?? null, {
        transactionDate: payDate || null,
        referenceNumber: payRef.trim() || null,
      })
      // Sync project costs if invoice is linked to a project deal
      const projectId = (invoice as SupplierInvoice & { project_id?: string | null }).project_id
      if (projectId) {
        await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: null }>)(
          'sync_project_costs', { p_deal_id: projectId }
        )
      }
      setShowPay(false)
      showToast('Payment recorded.')
      await load()
      // Let the supplier know they've been paid.
      setEmailOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the payment')
    }
    setPaying(false)
  }

  useEffect(() => { void load() }, [load])

  if (loading) {
    return <div className="flex items-center justify-center h-full text-[13px] text-text-secondary">Loading…</div>
  }

  if (error === 'not_linked' || !invoice) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[13px] text-error">{error ?? 'Not found'}</p>
      </div>
    )
  }

  const supplierName = (invoice.contractors as { name: string } | null)?.name ?? '—'

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/dashboard/finance/supplier-invoices" className="text-text-secondary hover:text-text-primary">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold text-text-primary truncate">
              {invoice.bill_number ?? 'Supplier bill'}
              {invoice.invoice_number && <span className="ml-2 text-[13px] font-normal text-text-secondary">Supplier's invoice {invoice.invoice_number}</span>}
            </h1>
            <p className="text-[12px] text-text-secondary">
              {invoice.remittance_number && <>Remittance {invoice.remittance_number} · </>}
              {supplierName} · <span className="capitalize">{invoice.status.replace(/_/g, ' ')}</span>
              {' · '}{invoice.approval_status === 'approved' ? 'Approved' : invoice.approval_status === 'rejected' ? 'Rejected' : 'Waiting for approval'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[16px] font-semibold text-text-primary">{fmtMoney(invoice.total_amount)}</p>
          {invoice.status !== 'paid' && invoice.status !== 'cancelled' && invoice.balance_due > 0 && (
            !canApprove ? (
              <span className="text-[12px] font-semibold text-text-secondary">
                {invoice.approval_status === 'approved' ? 'Approved · waiting to be paid' : invoice.approval_status === 'rejected' ? 'Rejected: not to be paid' : 'Waiting for approval'}
              </span>
            ) : invoice.approval_status === 'approved' ? (
              <button onClick={openPay} disabled={paying} className="btn-primary h-10 px-4 text-[13px] disabled:opacity-50">
                Record payment
              </button>
            ) : invoice.approval_status === 'rejected' ? (
              <span className="text-[12px] font-semibold text-error">Rejected: not to be paid</span>
            ) : (
              <>
                <button onClick={() => void decide('reject')} disabled={deciding || !actor} className="btn-outlined h-10 px-4 text-[13px] disabled:opacity-50">Reject</button>
                <button onClick={() => void decide('approve')} disabled={deciding || !actor} className="btn-secondary h-10 px-4 text-[13px] disabled:opacity-50">Approve</button>
                <button onClick={() => void decide('approve', true)} disabled={deciding || !actor} className="btn-primary h-10 px-4 text-[13px] disabled:opacity-50">
                  {deciding ? 'Saving…' : 'Approve & pay'}
                </button>
              </>
            )
          )}
          {invoice.status === 'paid' && (
            <span className="text-[11px] text-success font-medium flex items-center gap-1">
              <span className="material-icons text-[14px]">check_circle</span>
              Paid
            </span>
          )}
          {Number(invoice.amount_paid ?? 0) > 0 && (
            <button onClick={() => setEmailOpen(true)} className="btn-secondary h-9 px-3 text-[12px] flex items-center gap-1">
              <span className="material-icons text-[16px]">forward_to_inbox</span>Email remittance
            </button>
          )}
        </div>
      </div>

      {emailLog.length > 0 && (
        <div className="px-4 pt-2 text-[12px] text-text-secondary flex flex-col gap-0.5">
          {emailLog.slice(0, 2).map(l => <span key={l.id} className={l.status === 'failed' ? 'text-error' : ''}>Remittance: {emailedLabel(l)}</span>)}
        </div>
      )}
      {emailOpen && companyId && (
        <EmailDocumentDialog
          open
          onClose={() => setEmailOpen(false)}
          kind="remittance_supplier"
          docId={invoice.id}
          companyId={companyId}
          title="Email remittance advice"
          description={`${supplierName} gets a note that you've paid ${fmtMoney(Number(invoice.amount_paid ?? 0))}${invoice.invoice_number ? ` for invoice ${invoice.invoice_number}` : ''}.`}
          defaultTo={supplierEmail}
          onSent={() => { void loadDocumentEmails(createClient(), invoice.id, ['remittance_supplier']).then(setEmailLog) }}
        />
      )}
      {error && error !== 'not_linked' && (
        <p className="px-4 py-2 text-[12px] text-error">{error}</p>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-success text-white px-4 py-2 rounded-lg shadow-lg text-[13px] z-50 pointer-events-none">
          {toast}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Linked PO section */}
        <div className="card p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-icons text-[18px] text-text-secondary">shopping_cart</span>
            {linkedPo ? (
              <div>
                <p className="text-[12px] text-text-secondary">Linked Purchase Order</p>
                <Link href={`/dashboard/supply/purchase-orders/${linkedPo.id}`}
                  className="text-[13px] font-semibold text-primary hover:underline">
                  {linkedPo.po_number ?? 'Draft PO'} — {fmtMoney(linkedPo.total_amount)}
                </Link>
                <span className="ml-2 text-[11px] text-text-secondary capitalize">{linkedPo.status.replace(/_/g, ' ')}</span>
              </div>
            ) : (
              <span className="text-[13px] text-text-secondary">No purchase order linked</span>
            )}
          </div>
          {!linkedPo && (
            <button onClick={() => setShowLinkModal(true)} className="btn-secondary h-8 px-3 text-[12px]">
              Link to PO
            </button>
          )}
        </div>

        {linkedPo && matchLines && (() => {
          const c = billCheck(matchLines, n => fmtMoney(n))
          if (c.state === 'none') return null
          const tone = c.state === 'matched' ? 'bg-success/10 text-success border-success/30'
            : c.state === 'over' ? 'bg-red-50 text-red-700 border-red-200'
              : 'bg-amber-50 text-amber-800 border-amber-200'
          return (
            <div className={`rounded-xl border px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 ${tone}`}>
              <span className="flex items-center gap-2 text-[13px] font-semibold">
                <span className="material-icons text-[18px]">{c.state === 'matched' ? 'verified' : c.state === 'over' ? 'error' : 'schedule'}</span>
                {c.label}
              </span>
              <Link href={`/dashboard/supply/purchase-orders/${linkedPo.id}?tab=match`} className="text-[12.5px] font-semibold underline">See line by line</Link>
            </div>
          )
        })()}

        {invoice.notes && (
          <p className="text-[13px] text-text-secondary">{invoice.notes}</p>
        )}
        <div className="overflow-x-auto">
        <table className="w-full" style={{ minWidth: 560 }}>
          <thead>
            <tr className="bg-surface-elevated border-b border-divider">
              <th className="data-th text-left">#</th>
              <th className="data-th text-left">Description</th>
              <th className="data-th text-right">Qty</th>
              <th className="data-th text-right">Unit</th>
              <th className="data-th text-right">Line total</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="data-td text-center text-text-secondary py-8">
                  No line items yet. Create from a GRN or PO to copy lines automatically.
                </td>
              </tr>
            ) : lines.map(line => (
              <tr key={line.id} className="border-b border-divider">
                <td className="data-td text-[13px]">{line.line_no}</td>
                <td className="data-td text-[13px]">
                  {line.description}
                  {line.inventory_item_id && (
                    <Link
                      href={`/dashboard/inventory/${line.inventory_item_id}`}
                      className="block text-[11px] text-primary"
                    >
                      View item
                    </Link>
                  )}
                </td>
                <td className="data-td text-[13px] text-right">{line.quantity}</td>
                <td className="data-td text-[13px] text-right">{fmtMoney(line.unit_price)}</td>
                <td className="data-td text-[13px] text-right">{fmtMoney(line.total_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="max-w-xs ml-auto space-y-1 text-[13px]">
          <div className="flex justify-between"><span className="text-text-secondary">Subtotal</span><span>{fmtMoney(invoice.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">VAT</span><span>{fmtMoney(invoice.vat_amount)}</span></div>
          <div className="flex justify-between font-semibold"><span>Total</span><span>{fmtMoney(invoice.total_amount)}</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">Balance due</span><span>{fmtMoney(invoice.balance_due)}</span></div>
        </div>
      </div>

      {showPay && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="Record payment">
          <div className="bg-surface rounded-t-2xl sm:rounded-xl shadow-2xl w-full sm:w-96 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-text-primary">Record payment</h3>
              <button onClick={() => setShowPay(false)} className="text-text-secondary hover:text-text-primary" aria-label="Close">
                <span className="material-icons text-[20px]">close</span>
              </button>
            </div>
            <p className="text-[12.5px] text-text-secondary">{supplierName} · still owed {fmtMoney(invoice.balance_due)}</p>
            <label className="flex flex-col gap-1 text-[12px] text-text-secondary">Amount paid
              <input type="number" inputMode="decimal" step="0.01" min="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                className="h-11 rounded-lg border border-divider px-3 text-[14px] text-text-primary bg-surface" />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-text-secondary">Date paid
              <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                className="h-11 rounded-lg border border-divider px-3 text-[14px] text-text-primary bg-surface" />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-text-secondary">How
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
                className="h-11 rounded-lg border border-divider px-3 text-[14px] text-text-primary bg-surface">
                <option value="eft">EFT</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-text-secondary">Reference
              <input type="text" value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="e.g. bank reference"
                className="h-11 rounded-lg border border-divider px-3 text-[14px] text-text-primary bg-surface" />
            </label>
            {error && <p className="text-[12.5px] text-error">{error}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setShowPay(false)} className="btn-outlined h-10 px-4 text-[13px]">Cancel</button>
              <button onClick={() => void recordPayment()} disabled={paying} className="btn-primary h-10 px-4 text-[13px] disabled:opacity-50">
                {paying ? 'Saving…' : 'Save payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link PO modal */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface rounded-xl shadow-2xl w-96 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-text-primary">Link to Purchase Order</h3>
              <button onClick={() => setShowLinkModal(false)} className="text-text-secondary hover:text-text-primary">
                <span className="material-icons text-[20px]">close</span>
              </button>
            </div>
            {unlinkedPos.length === 0 ? (
              <p className="text-[13px] text-text-secondary py-4 text-center">No unlinked purchase orders found for this supplier.</p>
            ) : (
              <div className="max-h-64 overflow-auto space-y-1">
                {unlinkedPos.map(po => (
                  <button key={po.id} onClick={() => linkToPo(po.id)} disabled={linking}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-elevated text-[13px] disabled:opacity-50">
                    <span className="font-medium">{po.po_number ?? 'Draft PO'}</span>
                    <span className="ml-2 text-text-secondary">{fmtMoney(po.total_amount)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
