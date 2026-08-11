'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import type { FinanceInvoice, FinanceInvoiceLine } from '@/lib/finance-types'

// ─── Extended types ────────────────────────────────────────────────────────────

type Invoice = FinanceInvoice & {
  invoice_type?: string | null
  sent_at?: string | null
  voided_at?: string | null
  void_reason?: string | null
  client_id?: string | null
  deal_id?: string | null
  client_deals?: { title: string } | null
}

type Transaction = {
  id: string
  transaction_type: string
  direction: string
  amount: number
  total_amount: number
  transaction_date: string
  payment_method: string | null
  reference: string | null
  notes: string | null
  created_at: string
}

// ─── Status badge ──────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  draft:          'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  sent:           'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  viewed:         'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  partially_paid: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  paid:           'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  overdue:        'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  voided:         'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  cancelled:      'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-500'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium capitalize ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

// ─── Modal wrapper ─────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-text-primary">{title}</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <span className="material-icons text-[20px]">close</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Field helper ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[12px] text-text-secondary font-medium">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'h-9 px-3 border border-border rounded-md text-[13px] bg-background w-full'
const selectCls = 'h-9 px-3 border border-border rounded-md text-[13px] bg-background w-full'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MoneyInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [inv, setInv]       = useState<Invoice | null>(null)
  const [lines, setLines]   = useState<FinanceInvoiceLine[]>([])
  const [txRows, setTxRows] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)

  // Modal states
  const [showPay, setShowPay]   = useState(false)
  const [showVoid, setShowVoid] = useState(false)
  const [showCN, setShowCN]     = useState(false)
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  // Record Payment form
  const [payDate, setPayDate]     = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('bank_transfer')
  const [payRef, setPayRef]       = useState('')
  const [payNotes, setPayNotes]   = useState('')

  // Void form
  const [voidReason, setVoidReason] = useState('')

  // Credit note form
  const [cnReasonCode, setCnReasonCode] = useState('returned_goods')
  const [cnReasonNotes, setCnReasonNotes] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)

    const [{ data: invoice }, { data: lineRows }, { data: transactions }] = await Promise.all([
      supabase.from('finance_invoices')
        .select('*, clients(name), client_deals(title)')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('finance_invoice_lines')
        .select('*')
        .eq('invoice_id', id)
        .order('line_no'),
      supabase.from('finance_transactions')
        .select('*')
        .eq('source_table', 'finance_invoices')
        .eq('source_id', id)
        .order('transaction_date', { ascending: false }),
    ])

    setInv(invoice as Invoice | null)
    setLines((lineRows ?? []) as FinanceInvoiceLine[])
    setTxRows((transactions ?? []) as Transaction[])

    if (invoice) {
      const bal = (invoice as Invoice).balance_due ?? 0
      setPayAmount(String(bal > 0 ? bal : 0))
      setPayDate(new Date().toISOString().split('T')[0])
    }
    setLoading(false)
  }, [id])

  useEffect(() => { void load() }, [load])

  // ── Record Payment ────────────────────────────────────────────────────────────
  async function handleRecordPayment() {
    if (!inv || !companyId) return
    const amount = Number(payAmount)
    if (!(amount > 0)) { setErr('Amount must be greater than 0'); return }
    setBusy(true)
    setErr(null)
    const supabase = createClient()
    try {
      // 1. Insert transaction
      const { error: txErr } = await supabase.from('finance_transactions').insert({
        company_id: companyId,
        transaction_type: 'payment',
        direction: 'in',
        source_table: 'finance_invoices',
        source_id: inv.id,
        amount,
        total_amount: amount,
        transaction_date: payDate,
        payment_method: payMethod,
        reference: payRef || null,
        notes: payNotes || null,
      })
      if (txErr) throw txErr

      // 2. Update invoice
      const newAmountPaid = (inv.amount_paid ?? 0) + amount
      const newBalance = (inv.total_amount ?? 0) - newAmountPaid
      const newStatus = newBalance <= 0 ? 'paid' : 'partially_paid'
      const { error: invErr } = await supabase.from('finance_invoices').update({
        amount_paid: newAmountPaid,
        balance_due: Math.max(0, newBalance),
        status: newStatus,
        paid_date: newBalance <= 0 ? new Date().toISOString().split('T')[0] : null,
      }).eq('id', inv.id)
      if (invErr) throw invErr

      // 3. Ledger entry
      if (inv.client_id) {
        await supabase.from('customer_ledger_entries').insert({
          company_id: companyId,
          client_id: inv.client_id,
          entry_type: 'payment',
          source_table: 'finance_invoices',
          source_id: inv.id,
          reference_number: inv.invoice_number,
          description: `Payment received — ${inv.invoice_number ?? inv.id}`,
          debit: 0,
          credit: amount,
          entry_date: payDate,
        })
      }

      setShowPay(false)
      await load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to record payment')
    }
    setBusy(false)
  }

  // ── Mark Sent ─────────────────────────────────────────────────────────────────
  async function handleMarkSent() {
    if (!inv) return
    setBusy(true)
    const supabase = createClient()
    await supabase.from('finance_invoices').update({ status: 'sent' }).eq('id', inv.id)
    await load()
    setBusy(false)
  }

  // ── Void Invoice ──────────────────────────────────────────────────────────────
  async function handleVoid() {
    if (!inv) return
    setBusy(true)
    setErr(null)
    const supabase = createClient()
    try {
      const { error } = await supabase.from('finance_invoices').update({
        status: 'voided',
        voided_at: new Date().toISOString(),
        void_reason: voidReason || null,
      }).eq('id', inv.id)
      if (error) throw error
      setShowVoid(false)
      await load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to void invoice')
    }
    setBusy(false)
  }

  // ── Issue Credit Note ─────────────────────────────────────────────────────────
  async function handleIssueCreditNote() {
    if (!inv || !companyId) return
    setBusy(true)
    setErr(null)
    const supabase = createClient()
    try {
      // Insert credit note
      const { data: cn, error: cnErr } = await supabase.from('credit_notes').insert({
        company_id: companyId,
        invoice_id: inv.id,
        client_id: inv.client_id ?? null,
        status: 'draft',
        reason_code: cnReasonCode,
        reason_notes: cnReasonNotes || null,
        currency: inv.currency ?? 'ZAR',
        subtotal: inv.subtotal,
        vat_amount: inv.vat_amount,
        total_amount: inv.total_amount,
        issue_date: new Date().toISOString().split('T')[0],
      }).select().maybeSingle()
      if (cnErr) throw cnErr

      // Copy invoice lines as credit note lines
      if (cn && lines.length > 0) {
        const { error: linesErr } = await supabase.from('credit_note_lines').insert(
          lines.map(l => ({
            company_id: companyId,
            credit_note_id: cn.id,
            invoice_line_id: l.id,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            subtotal: l.subtotal,
            vat_rate: l.vat_rate,
            vat_amount: l.vat_amount,
            total_amount: l.total_amount,
          }))
        )
        if (linesErr) throw linesErr
      }

      // Ledger entry
      if (cn && inv.client_id) {
        await supabase.from('customer_ledger_entries').insert({
          company_id: companyId,
          client_id: inv.client_id,
          entry_type: 'credit_note',
          source_table: 'credit_notes',
          source_id: cn.id,
          reference_number: (cn as { credit_note_number?: string | null }).credit_note_number ?? 'CN-DRAFT',
          description: `Credit note issued against ${inv.invoice_number ?? inv.id}`,
          debit: 0,
          credit: inv.total_amount,
          entry_date: new Date().toISOString().split('T')[0],
        })
      }

      setShowCN(false)
      router.push('/dashboard/money/credit-notes')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to issue credit note')
    }
    setBusy(false)
  }

  // ─── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[13px] text-text-secondary">Loading…</p>
      </div>
    )
  }

  if (!inv) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <span className="material-icons text-[40px] text-text-disabled">receipt_long</span>
        <p className="text-[14px] text-text-secondary">Invoice not found</p>
        <button onClick={() => router.push('/dashboard/money/invoices')} className="btn-primary h-9 px-4 text-[13px] mt-2">
          Back to Invoices
        </button>
      </div>
    )
  }

  const clientName = (inv.clients as { name: string } | null)?.name ?? '—'
  const projectTitle = (inv.client_deals as { title: string } | null)?.title
  const canPay = (inv.balance_due ?? 0) > 0 && !['voided', 'cancelled'].includes(inv.status)
  const canMarkSent = inv.status === 'draft'
  const canVoid = !['voided', 'paid', 'cancelled'].includes(inv.status)
  const canCreditNote = ['sent', 'paid', 'partially_paid'].includes(inv.status)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-4 space-y-5 pb-10">

        {/* Back + status */}
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => router.push('/dashboard/money/invoices')}
            className="flex items-center gap-1 text-[13px] text-primary hover:underline"
          >
            <span className="material-icons text-[16px]">arrow_back</span>Invoices
          </button>
          <StatusBadge status={inv.status} />
        </div>

        {/* Header card */}
        <div className="bg-surface-card border border-divider rounded-xl p-4 space-y-1">
          <h1 className="text-[20px] font-semibold text-text-primary">
            {inv.invoice_number || <span className="text-text-disabled italic">Draft invoice</span>}
          </h1>
          <p className="text-[13px] text-text-secondary">
            <span className="font-medium text-text-primary">{clientName}</span>
            {projectTitle && <> · {projectTitle}</>}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-1 text-[12px] text-text-secondary">
            <span>Issued: <span className="font-medium text-text-primary">{inv.issue_date ?? '—'}</span></span>
            {inv.due_date && <span>Due: <span className="font-medium text-text-primary">{inv.due_date}</span></span>}
            {inv.paid_date && <span>Paid: <span className="font-medium text-green-600">{inv.paid_date}</span></span>}
          </div>
        </div>

        {/* Line items */}
        {lines.length > 0 && (
          <div className="bg-surface-card border border-divider rounded-xl overflow-hidden">
            <p className="px-4 py-2.5 text-[12px] font-semibold text-text-secondary uppercase tracking-wide border-b border-divider">
              Line Items
            </p>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ minWidth: 480 }}>
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider">
                    <th className="data-th text-left">Description</th>
                    <th className="data-th text-right">Qty</th>
                    <th className="data-th text-right">Unit Price</th>
                    <th className="data-th text-right">VAT</th>
                    <th className="data-th text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.id} className="border-b border-divider last:border-0">
                      <td className="data-td text-[13px] text-text-primary">{l.description}</td>
                      <td className="data-td text-[13px] text-text-secondary text-right">{l.quantity}</td>
                      <td className="data-td text-[13px] text-text-secondary text-right">{fmtMoney(l.unit_price)}</td>
                      <td className="data-td text-[13px] text-text-secondary text-right">{fmtMoney(l.vat_amount)}</td>
                      <td className="data-td text-[13px] text-text-primary font-medium text-right">{fmtMoney(l.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Totals */}
        <div className="bg-surface-card border border-divider rounded-xl p-4 space-y-2">
          <div className="flex justify-between text-[13px]">
            <span className="text-text-secondary">Subtotal</span>
            <span className="text-text-primary">{fmtMoney(inv.subtotal)}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-text-secondary">VAT</span>
            <span className="text-text-primary">{fmtMoney(inv.vat_amount)}</span>
          </div>
          <div className="flex justify-between text-[13px] border-t border-divider pt-2">
            <span className="font-semibold text-text-primary">Total</span>
            <span className="font-semibold text-text-primary">{fmtMoney(inv.total_amount)}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-text-secondary">Amount Paid</span>
            <span className="text-green-600 font-medium">{fmtMoney(inv.amount_paid)}</span>
          </div>
          <div className="flex justify-between text-[15px] border-t border-divider pt-2">
            <span className="font-bold text-text-primary">Balance Due</span>
            <span className={`font-bold ${(inv.balance_due ?? 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {fmtMoney(inv.balance_due)}
            </span>
          </div>
        </div>

        {/* Payment history */}
        {txRows.length > 0 && (
          <div className="bg-surface-card border border-divider rounded-xl overflow-hidden">
            <p className="px-4 py-2.5 text-[12px] font-semibold text-text-secondary uppercase tracking-wide border-b border-divider">
              Payment History
            </p>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ minWidth: 400 }}>
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider">
                    <th className="data-th text-left">Date</th>
                    <th className="data-th text-left">Method</th>
                    <th className="data-th text-left">Reference</th>
                    <th className="data-th text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {txRows.map(t => (
                    <tr key={t.id} className="border-b border-divider last:border-0">
                      <td className="data-td text-[13px] text-text-secondary">{t.transaction_date}</td>
                      <td className="data-td text-[13px] text-text-secondary capitalize">
                        {(t.payment_method ?? '—').replace(/_/g, ' ')}
                      </td>
                      <td className="data-td text-[13px] text-text-secondary">{t.reference ?? '—'}</td>
                      <td className="data-td text-[13px] text-right font-medium text-text-primary">
                        {fmtMoney(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {canMarkSent && (
            <button
              onClick={handleMarkSent}
              disabled={busy}
              className="btn-primary h-9 px-4 text-[13px] flex items-center gap-1.5 disabled:opacity-50"
            >
              <span className="material-icons text-[16px]">send</span>Mark Sent
            </button>
          )}
          {canPay && (
            <button
              onClick={() => { setErr(null); setShowPay(true) }}
              className="btn-primary h-9 px-4 text-[13px] flex items-center gap-1.5"
            >
              <span className="material-icons text-[16px]">payments</span>Record Payment
            </button>
          )}
          {canCreditNote && (
            <button
              onClick={() => { setErr(null); setShowCN(true) }}
              className="btn-outlined h-9 px-4 text-[13px] flex items-center gap-1.5"
            >
              <span className="material-icons text-[16px]">undo</span>Issue Credit Note
            </button>
          )}
          {canVoid && (
            <button
              onClick={() => { setErr(null); setShowVoid(true) }}
              className="h-9 px-4 text-[13px] rounded-lg border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-1.5 transition-colors"
            >
              <span className="material-icons text-[16px]">block</span>Void Invoice
            </button>
          )}
        </div>
      </div>

      {/* ── Record Payment Modal ─────────────────────────────────────────────────── */}
      {showPay && (
        <Modal title="Record Payment" onClose={() => setShowPay(false)}>
          <div className="space-y-3">
            <Field label="Payment Date">
              <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label={`Amount (max ${fmtMoney(inv.balance_due)})`}>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={inv.balance_due ?? undefined}
                value={payAmount}
                onChange={e => setPayAmount(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Payment Method">
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className={selectCls}>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cash">Cash</option>
                <option value="eft">EFT</option>
                <option value="cheque">Cheque</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Reference">
              <input
                type="text"
                value={payRef}
                onChange={e => setPayRef(e.target.value)}
                placeholder="e.g. bank ref, cheque number"
                className={inputCls}
              />
            </Field>
            <Field label="Notes">
              <input
                type="text"
                value={payNotes}
                onChange={e => setPayNotes(e.target.value)}
                placeholder="Optional notes"
                className={inputCls}
              />
            </Field>
            {err && <p className="text-[12px] text-red-600">{err}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setShowPay(false)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
              <button onClick={handleRecordPayment} disabled={busy} className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">
                {busy ? 'Saving…' : 'Save Payment'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Void Modal ──────────────────────────────────────────────────────────── */}
      {showVoid && (
        <Modal title="Void Invoice" onClose={() => setShowVoid(false)}>
          <p className="text-[13px] text-text-secondary">
            This will mark the invoice as voided. This action cannot be undone.
          </p>
          <Field label="Reason (optional)">
            <textarea
              value={voidReason}
              onChange={e => setVoidReason(e.target.value)}
              rows={3}
              placeholder="Enter reason for voiding this invoice…"
              className="px-3 py-2 border border-border rounded-md text-[13px] bg-background w-full resize-none"
            />
          </Field>
          {err && <p className="text-[12px] text-red-600">{err}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowVoid(false)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
            <button
              onClick={handleVoid}
              disabled={busy}
              className="h-9 px-4 text-[13px] rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {busy ? 'Voiding…' : 'Void Invoice'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Issue Credit Note Modal ──────────────────────────────────────────────── */}
      {showCN && (
        <Modal title="Issue Credit Note" onClose={() => setShowCN(false)}>
          <p className="text-[13px] text-text-secondary">
            A full credit note for {fmtMoney(inv.total_amount)} will be created against invoice{' '}
            <span className="font-medium text-text-primary">{inv.invoice_number ?? inv.id}</span>.
          </p>
          <Field label="Reason Code">
            <select value={cnReasonCode} onChange={e => setCnReasonCode(e.target.value)} className={selectCls}>
              <option value="returned_goods">Returned Goods</option>
              <option value="service_not_rendered">Service Not Rendered</option>
              <option value="price_adjustment">Price Adjustment</option>
              <option value="duplicate_invoice">Duplicate Invoice</option>
              <option value="goodwill">Goodwill</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Notes">
            <textarea
              value={cnReasonNotes}
              onChange={e => setCnReasonNotes(e.target.value)}
              rows={3}
              placeholder="Additional notes…"
              className="px-3 py-2 border border-border rounded-md text-[13px] bg-background w-full resize-none"
            />
          </Field>
          {err && <p className="text-[12px] text-red-600">{err}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCN(false)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
            <button onClick={handleIssueCreditNote} disabled={busy} className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">
              {busy ? 'Creating…' : 'Issue Credit Note'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
