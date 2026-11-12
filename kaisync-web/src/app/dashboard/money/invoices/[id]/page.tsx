'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import { recordInvoicePayment } from '@/lib/finance-api'
import { buildInvoicePdf, downloadInvoicePdf } from '@/lib/invoice-pdf'
import { pdfBase64 } from '@/lib/document-pdf'
import { EmailDocumentDialog, type EmailPdf } from '@/components/money/EmailDocumentDialog'
import { emailedLabel, loadDocumentEmails, storeInvoicePdf, type DocumentEmailLog } from '@/lib/money/document-email'
import { companyLetterhead, type Letterhead } from '@/lib/letterhead'
import type { FinanceInvoice, FinanceInvoiceLine } from '@/lib/finance-types'
import { localISODate } from '@/lib/utils'
import { signWorkforceMediaMany } from '@/lib/media-read'

// ─── Extended types ────────────────────────────────────────────────────────────

type Invoice = FinanceInvoice & {
  invoice_type?: string | null
  sent_at?: string | null
  voided_at?: string | null
  void_reason?: string | null
  client_id?: string | null
  deal_id?: string | null
  job_id?: string | null
  client_deals?: { title: string } | null
  jobs?: { title: string; job_code: string | null } | null
}

type Transaction = {
  id: string
  transaction_type: string
  direction: string
  amount: number
  total_amount: number
  transaction_date: string
  payment_method: string | null
  reference_number: string | null
  receipt_number?: string | null
  notes: string | null
  created_at: string
}

type PaymentProof = {
  id: string
  status: string
  file_url: string | null
  storage_path: string
  amount: number | null
  reference: string | null
  notes: string | null
  submitted_at: string
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
  return (
    <Suspense fallback={<p className="p-6 text-[13px] text-text-secondary">Loading…</p>}>
      <MoneyInvoiceDetailInner />
    </Suspense>
  )
}

function MoneyInvoiceDetailInner() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const openWhatsNext = searchParams.get('whats_next') === '1'
  const openEmail = searchParams.get('email') === '1'

  const [inv, setInv]       = useState<Invoice | null>(null)
  const [lines, setLines]   = useState<FinanceInvoiceLine[]>([])
  const [txRows, setTxRows] = useState<Transaction[]>([])
  const [proofs, setProofs] = useState<PaymentProof[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('KaiSync')
  const [letterhead, setLetterhead] = useState<Letterhead | null>(null)
  const [clientEmail, setClientEmail] = useState<string | null>(null)

  // Modal states
  const [showPay, setShowPay]   = useState(false)
  const [showVoid, setShowVoid] = useState(false)
  const [showCN, setShowCN]     = useState(false)
  const [showWhatsNext, setShowWhatsNext] = useState(openWhatsNext)
  const [whatsNextMode, setWhatsNextMode] = useState<'draft' | 'sent' | 'paid'>('draft')
  const [busy, setBusy]         = useState(false)
  const [emailKind, setEmailKind] = useState<'invoice' | 'receipt' | null>(openEmail ? 'invoice' : null)
  const [emailLog, setEmailLog] = useState<DocumentEmailLog[]>([])
  const [viewedAt, setViewedAt] = useState<string | null>(null)
  // True while finishing "Send by email": closing the email dialog then shows What's next.
  const [sendFlow, setSendFlow] = useState(openEmail)
  const [justPaid, setJustPaid] = useState(false)
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
    void companyLetterhead(supabase, member.companyId).then(setLetterhead)
    setEmployeeId(member.employeeId)

    const [{ data: invoice }, { data: lineRows }, { data: transactions }, { data: company }, { data: proofRows }] = await Promise.all([
      supabase.from('finance_invoices')
        .select('*, clients(name, email, legal_name, address, billing_address, vat_number), client_deals!finance_invoices_deal_id_fkey(title), jobs(title, job_code)')
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
      supabase.from('companies').select('name').eq('id', member.companyId).maybeSingle(),
      supabase.from('finance_payment_proofs')
        .select('id, status, file_url, storage_path, amount, reference, notes, submitted_at')
        .eq('invoice_id', id)
        .eq('company_id', member.companyId)
        .order('submitted_at', { ascending: false }),
    ])

    setInv(invoice as Invoice | null)
    setLines((lineRows ?? []) as FinanceInvoiceLine[])
    setTxRows((transactions ?? []) as Transaction[])
    // Proofs sent from a linked company keep only the storage path: sign a link for those.
    const proofList = (proofRows ?? []) as PaymentProof[]
    const unsigned = proofList.filter(p => !p.file_url && p.storage_path).map(p => p.storage_path)
    if (unsigned.length) {
      const signed = await signWorkforceMediaMany(supabase, unsigned).catch(() => new Map<string, string>())
      for (const p of proofList) if (!p.file_url && p.storage_path) p.file_url = signed.get(p.storage_path.trim()) ?? null
    }
    setProofs(proofList)
    setCompanyName((company as { name?: string } | null)?.name ?? 'KaiSync')
    setClientEmail((invoice as { clients?: { email?: string | null } | null } | null)?.clients?.email ?? null)
    setEmailLog(await loadDocumentEmails(supabase, id, ['invoice', 'receipt']))
    const { data: linkStatus } = await supabase.rpc('document_link_status', { p_doc_id: id })
    setViewedAt((linkStatus as { last_viewed_at?: string | null } | null)?.last_viewed_at ?? null)

    if (invoice) {
      const bal = (invoice as Invoice).balance_due ?? 0
      setPayAmount(String(bal > 0 ? bal : 0))
      setPayDate(localISODate())
    }
    setLoading(false)
  }, [id])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (openWhatsNext) {
      setWhatsNextMode('draft')
      setShowWhatsNext(true)
    }
  }, [openWhatsNext])

  function buildPdfInput() {
    if (!inv) return null
    const justSent = inv.status === 'draft' && !!sentNumberRef.current
    return {
      invoice_number: inv.invoice_number ?? sentNumberRef.current,
      status: justSent ? 'sent' : inv.status,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      notes: inv.notes,
      client_name: (inv.clients as { name?: string } | null)?.name ?? null,
      client_email: clientEmail,
      ...(() => {
        const c = inv.clients as { legal_name?: string | null; address?: string | null; billing_address?: string | null; vat_number?: string | null } | null
        return {
          client_legal_name: c?.legal_name ?? null,
          client_address: c?.billing_address?.trim() || c?.address?.trim() || null,
          client_vat_number: c?.vat_number ?? null,
        }
      })(),
      company_name: companyName,
      letterhead,
      currency: inv.currency,
      lines: lines.map(l => ({
        description: l.description,
        qty: l.quantity,
        unit_price: l.unit_price,
        vat_amount: l.vat_amount,
        total: l.total_amount,
      })),
      subtotal: inv.subtotal,
      vat: inv.vat_amount,
      total: inv.total_amount,
      amount_paid: inv.amount_paid,
      balance_due: inv.balance_due,
    }
  }

  async function markInvoiceSent(): Promise<boolean> {
    if (!inv || !companyId) return false
    const supabase = createClient()
    const now = new Date().toISOString()
    // The database gives the invoice its number as it is sent (no gaps, no duplicates).
    const { data, error } = await supabase.from('finance_invoices').update({
      status: 'sent',
      sent_at: now,
    }).eq('id', inv.id).select('invoice_number').maybeSingle()
    if (!error) sentNumberRef.current = (data as { invoice_number?: string | null } | null)?.invoice_number ?? null
    return !error
  }

  // A draft is only marked sent (and numbered) when its email actually goes; the PDF then carries that number.
  const sentNumberRef = useRef<string | null>(null)
  async function markSentBeforeEmail(): Promise<string | null> {
    if (!inv || inv.status !== 'draft') return null
    return (await markInvoiceSent()) ? null : 'Could not mark the invoice as sent, so the email was not sent.'
  }

  async function reviewProof(proofId: string, status: 'accepted' | 'rejected') {
    if (!companyId || !employeeId) return
    setBusy(true)
    setErr(null)
    const supabase = createClient()
    const { error } = await supabase.from('finance_payment_proofs').update({
      status,
      reviewed_by: employeeId,
      reviewed_at: new Date().toISOString(),
    }).eq('id', proofId).eq('company_id', companyId)
    setBusy(false)
    if (error) { setErr(error.message); return }
    await load()
  }

  // ── Record Payment ────────────────────────────────────────────────────────────
  async function handleRecordPayment() {
    if (!inv || !companyId) return
    const amount = Number(payAmount)
    if (!(amount > 0)) { setErr('Amount must be greater than 0'); return }
    setBusy(true)
    setErr(null)
    const supabase = createClient()
    try {
      await recordInvoicePayment(
        supabase,
        inv.id,
        amount,
        payMethod || null,
        employeeId,
        null,
        {
          referenceNumber: payRef || inv.invoice_number,
          notes: payNotes || null,
          transactionDate: payDate || undefined,
        },
      )
      setShowPay(false)
      // A fresh form next time (the next payment has its own reference and notes).
      setPayRef('')
      setPayNotes('')
      setPayAmount('')
      await load()
      // Offer the client a receipt straight away.
      setJustPaid(true)
      setEmailKind('receipt')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to record payment')
    }
    setBusy(false)
  }

  // ── Mark Sent ─────────────────────────────────────────────────────────────────
  async function handleMarkSent() {
    if (!inv) return
    setBusy(true)
    setErr(null)
    const ok = await markInvoiceSent()
    if (!ok) setErr('Failed to mark invoice as sent')
    else {
      // Keep the PDF as sent (with its new number), so Xero gets it attached.
      const pdf = await invoiceEmailPdf().catch(() => null)
      if (pdf) void storeInvoicePdf(createClient(), inv.id, pdf.base64)
    }
    await load()
    setWhatsNextMode('sent')
    setShowWhatsNext(true)
    setBusy(false)
  }

  /** Mark the invoice sent (it gets its number), then open the email dialog. */
  async function handleSendByEmail() {
    if (!inv) return
    setErr(null)
    // Opening the email does not mark the invoice sent: that happens when the email goes (or with Mark Sent).
    setSendFlow(false)
    setEmailKind('invoice')
  }

  async function invoiceEmailPdf(): Promise<EmailPdf | null> {
    const pdf = buildPdfInput()
    if (!pdf) return null
    const safe = (pdf.invoice_number || 'invoice').replace(/[^\w.-]+/g, '_')
    return { base64: pdfBase64(buildInvoicePdf(pdf)), filename: `Invoice_${safe}.pdf` }
  }

  function handleDownloadPdf() {
    const pdf = buildPdfInput()
    if (pdf) downloadInvoicePdf(pdf)
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
        // Issued straight away: the database gives it its number (CN0001) as it is saved.
        status: 'approved',
        reason_code: cnReasonCode,
        reason_notes: cnReasonNotes || null,
        currency: inv.currency ?? 'ZAR',
        subtotal: inv.subtotal,
        vat_amount: inv.vat_amount,
        total_amount: inv.total_amount,
        issue_date: localISODate(),
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
          reference_number: (cn as { credit_note_number?: string | null }).credit_note_number ?? null,
          description: `Credit note issued against ${inv.invoice_number ?? inv.id}`,
          debit: 0,
          credit: inv.total_amount,
          entry_date: localISODate(),
        })
      }

      setShowCN(false)
      if (cn) router.push(`/dashboard/money/credit-notes/${cn.id}?whats_next=1`)
      else router.push('/dashboard/money/credit-notes')
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
  // VAT shows only when this invoice charges it (a company that is not VAT-registered never does).
  const showVat = Math.abs(Number(inv.vat_amount) || 0) > 0.004
  const projectTitle = (inv.client_deals as { title: string } | null)?.title
  const jobLabel = inv.jobs
    ? (inv.jobs.job_code ? `${inv.jobs.job_code} · ${inv.jobs.title}` : inv.jobs.title)
    : null
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
            {jobLabel && <> · {jobLabel}</>}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-1 text-[12px] text-text-secondary">
            <span>Issued: <span className="font-medium text-text-primary">{inv.issue_date ?? '—'}</span></span>
            {inv.due_date && <span>Due: <span className="font-medium text-text-primary">{inv.due_date}</span></span>}
            {inv.paid_date && <span>Paid: <span className="font-medium text-green-600">{inv.paid_date}</span></span>}
          </div>
          {inv.job_id && (
            <button
              type="button"
              onClick={() => router.push(`/dashboard/jobs/${inv.job_id}`)}
              className="mt-2 text-[12px] text-primary hover:underline"
            >
              Open linked job
            </button>
          )}
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
                    {showVat && <th className="data-th text-right">VAT</th>}
                    <th className="data-th text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.id} className="border-b border-divider last:border-0">
                      <td className="data-td text-[13px] text-text-primary">{l.description}</td>
                      <td className="data-td text-[13px] text-text-secondary text-right">{l.quantity}</td>
                      <td className="data-td text-[13px] text-text-secondary text-right">{fmtMoney(l.unit_price, inv.currency)}</td>
                      {showVat && <td className="data-td text-[13px] text-text-secondary text-right">{fmtMoney(l.vat_amount, inv.currency)}</td>}
                      <td className="data-td text-[13px] text-text-primary font-medium text-right">{fmtMoney(l.total_amount, inv.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Totals */}
        <div className="bg-surface-card border border-divider rounded-xl p-4 space-y-2">
          {showVat && (
            <>
              <div className="flex justify-between text-[13px]">
                <span className="text-text-secondary">Total excl. VAT</span>
                <span className="text-text-primary">{fmtMoney(inv.subtotal, inv.currency)}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="text-text-secondary">VAT</span>
                <span className="text-text-primary">{fmtMoney(inv.vat_amount, inv.currency)}</span>
              </div>
            </>
          )}
          <div className={`flex justify-between text-[13px] ${showVat ? 'border-t border-divider pt-2' : ''}`}>
            <span className="font-semibold text-text-primary">{showVat ? 'Total incl. VAT' : 'Total'}</span>
            <span className="font-semibold text-text-primary">{fmtMoney(inv.total_amount, inv.currency)}</span>
          </div>
          {inv.currency && inv.currency !== 'ZAR' && (
            <div className="flex justify-between text-[12px] text-text-secondary">
              <span>In your books</span>
              <span>{(inv as { exchange_rate?: number | null }).exchange_rate
                ? `${fmtMoney(Math.round(Number(inv.total_amount) * Number((inv as { exchange_rate?: number | null }).exchange_rate) * 100) / 100)} (1 ${inv.currency} = R ${Number((inv as { exchange_rate?: number | null }).exchange_rate).toFixed(4)}${(inv as { rate_source?: string | null }).rate_source === 'xero' ? ', Xero rate' : ''})`
                : 'Rate set when it reaches Xero'}</span>
            </div>
          )}
          <div className="flex justify-between text-[13px]">
            <span className="text-text-secondary">Amount Paid</span>
            <span className="text-green-600 font-medium">{fmtMoney(inv.amount_paid, inv.currency)}</span>
          </div>
          {['voided', 'cancelled'].includes(inv.status) ? (
          <div className="flex justify-between text-[15px] border-t border-divider pt-2">
            <span className="font-bold text-text-primary">Balance Due</span>
            <span className="font-bold text-text-secondary">Nothing — {inv.status === 'voided' ? 'voided' : 'cancelled'}</span>
          </div>
          ) : (
          <div className="flex justify-between text-[15px] border-t border-divider pt-2">
            <span className="font-bold text-text-primary">Balance Due</span>
            <span className={`font-bold ${(inv.balance_due ?? 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {fmtMoney(inv.balance_due, inv.currency)}
            </span>
          </div>
          )}
        </div>

        {/* Tenant payment proofs */}
        {proofs.length > 0 && (
          <div className="bg-surface-card border border-divider rounded-xl overflow-hidden">
            <p className="px-4 py-2.5 text-[12px] font-semibold text-text-secondary uppercase tracking-wide border-b border-divider">
              Payment proofs
            </p>
            <ul className="divide-y divide-divider">
              {proofs.map(p => (
                <li key={p.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] text-text-primary capitalize">{p.status}</p>
                    <p className="text-[12px] text-text-secondary">
                      {p.submitted_at?.slice(0, 10)}
                      {p.reference ? ` · ref ${p.reference}` : ''}
                      {p.amount != null ? ` · ${fmtMoney(p.amount, inv.currency)}` : ''}
                    </p>
                    {p.file_url && (
                      <a href={p.file_url} target="_blank" rel="noreferrer" className="text-[12px] text-primary hover:underline">
                        View file
                      </a>
                    )}
                  </div>
                  {p.status === 'submitted' && (
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={() => void reviewProof(p.id, 'accepted')} className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-50">
                        Accept
                      </button>
                      <button type="button" disabled={busy} onClick={() => void reviewProof(p.id, 'rejected')} className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-50">
                        Reject
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className="px-4 py-2 text-[11px] text-text-secondary border-t border-divider">
              Accepting a proof does not mark the invoice paid — use Record Payment after verifying.
            </p>
          </div>
        )}

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
                    <th className="data-th text-left">Receipt</th>
                    <th className="data-th text-left">Method</th>
                    <th className="data-th text-left">Reference</th>
                    <th className="data-th text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {txRows.map(t => (
                    <tr key={t.id} className="border-b border-divider last:border-0">
                      <td className="data-td text-[13px] text-text-secondary">{t.transaction_date}</td>
                      <td className="data-td text-[13px] font-medium text-text-primary">{t.receipt_number ?? '—'}</td>
                      <td className="data-td text-[13px] text-text-secondary capitalize">
                        {(t.payment_method ?? '—').replace(/_/g, ' ')}
                      </td>
                      <td className="data-td text-[13px] text-text-secondary">{t.reference_number || '—'}</td>
                      <td className="data-td text-[13px] text-right font-medium text-text-primary">
                        {fmtMoney(t.amount, inv.currency)}
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
            <>
              <button
                onClick={() => void handleSendByEmail()}
                disabled={busy}
                className="btn-primary h-9 px-4 text-[13px] flex items-center gap-1.5 disabled:opacity-50"
              >
                <span className="material-icons text-[16px]">send</span>
                {busy ? 'Sending…' : 'Send by email'}
              </button>
              <button
                onClick={() => void handleMarkSent()}
                disabled={busy}
                className="btn-outlined h-9 px-4 text-[13px] flex items-center gap-1.5 disabled:opacity-50"
              >
                Mark Sent
              </button>
              {!inv.lease_id && (
                <Link
                  href={`/dashboard/money/invoices/${inv.id}/edit`}
                  className="btn-outlined h-9 px-4 text-[13px] flex items-center gap-1.5"
                >
                  <span className="material-icons text-[16px]">edit</span>Edit
                </Link>
              )}
            </>
          )}
          {!canMarkSent && !['voided', 'cancelled'].includes(inv.status) && (
            <button
              onClick={() => setEmailKind('invoice')}
              className="btn-outlined h-9 px-4 text-[13px] flex items-center gap-1.5"
            >
              <span className="material-icons text-[16px]">forward_to_inbox</span>Email invoice
            </button>
          )}
          {Number(inv.amount_paid ?? 0) > 0 && txRows.length > 0 && (
            <button
              onClick={() => setEmailKind('receipt')}
              className="btn-outlined h-9 px-4 text-[13px] flex items-center gap-1.5"
            >
              <span className="material-icons text-[16px]">receipt</span>Email receipt
            </button>
          )}
          <button
            onClick={handleDownloadPdf}
            className="btn-outlined h-9 px-4 text-[13px] flex items-center gap-1.5"
          >
            <span className="material-icons text-[16px]">picture_as_pdf</span>PDF
          </button>
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

        {err && !showPay && !showVoid && !showCN && (
          <p className="text-[12px] text-red-600">{err}</p>
        )}
        {(emailLog.length > 0 || viewedAt) && (
          <div className="text-[12px] text-text-secondary flex flex-col gap-0.5">
            {viewedAt && (
              <span className="text-emerald-700">
                <span className="material-icons text-[13px] align-[-2px] mr-1">visibility</span>
                Client opened the online invoice · {new Date(viewedAt).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {emailLog.slice(0, 3).map(l => (
              <span key={l.id} className={l.status === 'failed' ? 'text-error' : ''}>
                <span className="material-icons text-[13px] align-[-2px] mr-1">{l.kind === 'receipt' ? 'receipt' : 'mail'}</span>
                {l.kind === 'receipt' ? 'Receipt: ' : ''}{emailedLabel(l)}
              </span>
            ))}
          </div>
        )}
      </div>

      {emailKind && companyId && (
        <EmailDocumentDialog
          open
          onClose={() => {
            const wasPayment = emailKind === 'receipt'
            setEmailKind(null)
            if (openEmail) router.replace(`/dashboard/money/invoices/${id}`)
            if (sendFlow) { setSendFlow(false); setWhatsNextMode('sent'); setShowWhatsNext(true) }
            else if (wasPayment && justPaid) { setJustPaid(false); setWhatsNextMode('paid'); setShowWhatsNext(true) }
          }}
          kind={emailKind}
          docId={inv.id}
          companyId={companyId}
          title={emailKind === 'invoice' ? `Email invoice ${inv.invoice_number ?? ''}`.trim() : 'Email a payment receipt'}
          description={emailKind === 'invoice'
            ? `${clientName} gets the invoice with the PDF attached and the amount due.`
            : `${clientName} gets a thank-you receipt for their latest payment and the balance left.`}
          defaultTo={clientEmail}
          clientId={inv.client_id ?? null}
          getPdf={emailKind === 'invoice' ? invoiceEmailPdf : undefined}
          beforeSend={emailKind === 'invoice' ? markSentBeforeEmail : undefined}
          attachmentLabel={emailKind === 'invoice' ? `Invoice_${inv.invoice_number ?? 'draft'}.pdf` : undefined}
          onSent={() => {
            // A draft just became a sent invoice: close the email and show What's next once it has reloaded.
            if (emailKind === 'invoice' && inv.status === 'draft') {
              setEmailKind(null); setSendFlow(false)
              if (openEmail) router.replace(`/dashboard/money/invoices/${id}`)
              void load().then(() => { setWhatsNextMode('sent'); setShowWhatsNext(true) })
            }
            void loadDocumentEmails(createClient(), id, ['invoice', 'receipt']).then(setEmailLog)
          }}
        />
      )}

      {/* What's next? */}
      {showWhatsNext && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="relative bg-surface rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <h3 className="text-[15px] font-semibold text-text-primary mb-1">What&apos;s next?</h3>
            <p className="text-[13px] text-text-secondary mb-5">
              {whatsNextMode === 'draft' && 'Invoice saved as draft. Send it to the client, or continue later.'}
              {whatsNextMode === 'sent' && 'The invoice is sent. Record a payment when the money comes in.'}
              {whatsNextMode === 'paid' && 'Payment recorded. Issue a credit note if needed, or continue.'}
            </p>
            <div className="flex flex-col gap-2">
              {whatsNextMode === 'draft' && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { setShowWhatsNext(false); void handleSendByEmail() }}
                    className="h-10 px-4 rounded-lg bg-primary text-white text-left text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    Send by email
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { setShowWhatsNext(false); void handleMarkSent() }}
                    className="h-10 px-4 rounded-lg border border-divider text-left text-[13px] font-medium text-text-primary hover:bg-surface-elevated transition-colors disabled:opacity-50"
                  >
                    Mark sent only
                  </button>
                </>
              )}
              {(whatsNextMode === 'sent' || whatsNextMode === 'paid') && canPay && (
                <button
                  type="button"
                  onClick={() => { setShowWhatsNext(false); setShowPay(true) }}
                  className="h-10 px-4 rounded-lg bg-primary text-white text-left text-[13px] font-medium hover:bg-primary/90 transition-colors"
                >
                  Record payment
                </button>
              )}
              {(whatsNextMode === 'sent' || whatsNextMode === 'paid') && canCreditNote && (
                <button
                  type="button"
                  onClick={() => { setShowWhatsNext(false); setShowCN(true) }}
                  className="h-10 px-4 rounded-lg border border-divider text-left text-[13px] font-medium text-text-primary hover:bg-surface-elevated transition-colors"
                >
                  Issue credit note
                </button>
              )}
              {inv.deal_id && (
                <button
                  type="button"
                  onClick={() => router.push(`/dashboard/projects/${inv.deal_id}`)}
                  className="h-10 px-4 rounded-lg border border-divider text-left text-[13px] font-medium text-text-primary hover:bg-surface-elevated transition-colors"
                >
                  Open linked project
                </button>
              )}
              {inv.job_id && (
                <button
                  type="button"
                  onClick={() => router.push(`/dashboard/jobs/${inv.job_id}`)}
                  className="h-10 px-4 rounded-lg border border-divider text-left text-[13px] font-medium text-text-primary hover:bg-surface-elevated transition-colors"
                >
                  Open linked job
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowWhatsNext(false)}
                className="h-10 px-4 rounded-lg text-[13px] text-text-secondary hover:bg-surface-elevated transition-colors"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Record Payment Modal ─────────────────────────────────────────────────── */}
      {showPay && (
        <Modal title="Record Payment" onClose={() => setShowPay(false)}>
          <div className="space-y-3">
            <Field label="Payment Date">
              <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label={`Amount (max ${fmtMoney(inv.balance_due, inv.currency)})`}>
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
            A full credit note for {fmtMoney(inv.total_amount, inv.currency)} will be created against invoice{' '}
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
