'use client'

/**
 * One order (an accepted quote) with everything done for it in one place:
 *  Overview · Items · Invoices · Payments · Credit notes · Purchasing.
 * The id in the address is the quote's id.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { formatCurrency } from '@/lib/currencies'
import { MONEY_TD, MONEY_TH } from '@/components/ui/StatusFilterTabs'
import { ResponsiveDataView } from '@/components/ui/ResponsiveDataView'
import { InvoicesList } from '@/components/money/InvoicesList'
import { createInvoiceFromQuote, createPartInvoiceFromQuote } from '@/lib/money/quote-invoice'
import { createSupplyRfqFromQuote } from '@/lib/supply-rfq'
import { ORDER_STATE, orderMoney, type OrderInvoice } from '@/lib/money/orders'
import { cn } from '@/lib/utils'

type Quote = {
  id: string; company_id: string; quote_number: string | null; title: string | null; status: string; currency: string | null
  subtotal: number | null; vat_amount: number | null; total_amount: number | null; cost_total: number | null
  gross_profit: number | null; gross_margin_percent: number | null; accepted_at: string | null; valid_until: string | null
  client_id: string | null; job_id: string | null; deal_id: string | null
  clients?: { name: string } | null
  jobs?: { job_code: string | null; title: string | null } | null
  client_deals?: { project_code: string | null; title: string | null } | null
}
type Line = {
  id: string; description: string | null; quantity: number | null; unit: string | null; unit_sell_price: number | null
  discount_percent: number | null; subtotal_sell: number | null; cost_price: number | null; is_excluded: boolean | null
}
type Payment = { id: string; source_id: string; amount: number | null; transaction_date: string | null; created_at: string; payment_method: string | null; reference_number: string | null; receipt_number: string | null }
type CreditNote = { id: string; invoice_id: string | null; credit_note_number: string | null; status: string | null; currency: string | null; total_amount: number | null; issue_date: string | null }
type Rfq = { id: string; rfq_number: string | null; title: string | null; status: string | null; created_at: string }
type Po = { id: string; po_number: string | null; status: string | null; currency: string | null; subtotal: number | null; total_amount: number | null; required_delivery_date: string | null; created_at: string; supplier?: { name: string } | null }
type PoLine = { po_id: string; quote_line_id: string | null; quantity_ordered: number | null; quantity_received: number | null }
type Grn = { id: string; grn_number: string | null; po_id: string | null; status: string | null; received_date: string | null }
type Bill = { id: string; invoice_number: string | null; bill_number: string | null; po_id: string | null; status: string | null; currency: string | null; subtotal: number | null; total_amount: number | null; amount_paid: number | null; balance_due: number | null; due_date: string | null }
type Payout = { id: string; payout_status: string | null; total_amount: number | null; subtotal: number | null; payout_date: string | null; remittance_number: string | null; contractor?: { name: string } | null }

type Tab = 'overview' | 'items' | 'invoices' | 'payments' | 'credits' | 'purchasing'

const fmtDay = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
const label = (s: string | null | undefined) => String(s ?? '—').replace(/_/g, ' ')
const pill = 'px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-700'
const sameCur = (a: string | null | undefined, b: string | null | undefined) => (a || 'ZAR').toUpperCase() === (b || 'ZAR').toUpperCase()

function Card({ title, value, sub, tone }: { title: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-divider bg-surface px-3 py-2.5 min-w-0">
      <p className="text-[10.5px] uppercase tracking-wide text-text-secondary">{title}</p>
      <p className={cn('text-[16px] font-semibold tabular-nums truncate', tone ?? 'text-text-primary')}>{value}</p>
      {sub && <p className="text-[11px] text-text-secondary truncate">{sub}</p>}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-[12.5px] text-text-secondary">{text}</p>
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-divider bg-surface overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-divider">
        <h3 className="text-[13px] font-semibold text-text-primary">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

export default function OrderPage() {
  const { id } = useParams<{ id: string }>()
  const sp = useSearchParams()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>((sp.get('tab') as Tab) || 'overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Create invoice: the rest of the order, or a deposit / progress invoice (a % of the order).
  const [invoicePanel, setInvoicePanel] = useState(false)
  const [partPct, setPartPct] = useState('50')
  const [partLabel, setPartLabel] = useState('Deposit')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [invoices, setInvoices] = useState<OrderInvoice[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [credits, setCredits] = useState<CreditNote[]>([])
  const [rfqs, setRfqs] = useState<Rfq[]>([])
  const [pos, setPos] = useState<Po[]>([])
  const [poLines, setPoLines] = useState<PoLine[]>([])
  const [grns, setGrns] = useState<Grn[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [payouts, setPayouts] = useState<Payout[]>([])

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)
    const cid = member.companyId
    const { data: q, error: qErr } = await supabase.from('commercial_quotes')
      .select('id, company_id, quote_number, title, status, currency, subtotal, vat_amount, total_amount, cost_total, gross_profit, gross_margin_percent, accepted_at, valid_until, client_id, job_id, deal_id, clients(name), jobs!commercial_quotes_job_id_fkey(job_code, title), client_deals!commercial_quotes_deal_id_fkey(project_code, title)')
      .eq('id', id).eq('company_id', cid).maybeSingle()
    if (qErr || !q) { setError(qErr?.message ?? 'Order not found.'); setLoading(false); return }
    const qq = q as unknown as Quote
    setQuote(qq)

    const [lRes, iRes, rRes, pRes, payRes] = await Promise.all([
      supabase.from('commercial_quote_lines').select('id, description, quantity, unit, unit_sell_price, discount_percent, subtotal_sell, cost_price, is_excluded').eq('quote_id', id).order('sort_order'),
      supabase.from('finance_invoices').select('id, quote_id, invoice_number, status, currency, subtotal, total_amount, amount_paid, balance_due, issue_date, due_date').eq('company_id', cid).eq('quote_id', id).order('created_at'),
      supabase.from('rfqs').select('id, rfq_number, title, status, created_at').eq('company_id', cid).eq('quote_id', id).order('created_at'),
      supabase.from('purchase_orders').select('id, po_number, status, currency, subtotal, total_amount, required_delivery_date, created_at, supplier:contractors!purchase_orders_supplier_id_fkey(name)').eq('company_id', cid).eq('quote_id', id).order('created_at'),
      qq.job_id
        ? supabase.from('contractor_payouts').select('id, payout_status, total_amount, subtotal, payout_date, remittance_number, contractor:contractors(name)').eq('company_id', cid).or(`quote_id.eq.${id},job_id.eq.${qq.job_id}`)
        : supabase.from('contractor_payouts').select('id, payout_status, total_amount, subtotal, payout_date, remittance_number, contractor:contractors(name)').eq('company_id', cid).eq('quote_id', id),
    ])
    setLines((lRes.data ?? []) as Line[])
    const invs = (iRes.data ?? []) as OrderInvoice[]
    setInvoices(invs)
    setRfqs((rRes.data ?? []) as Rfq[])
    const poRows = (pRes.data ?? []) as unknown as Po[]
    setPos(poRows)
    setPayouts(((payRes.data ?? []) as unknown as Payout[]).filter(p => p.payout_status !== 'cancelled'))

    const invIds = invs.map(i => i.id)
    const poIds = poRows.map(p => p.id)
    const none = Promise.resolve({ data: [] as unknown[] })
    const [txRes, cnRes, plRes, gRes, bRes] = await Promise.all([
      invIds.length ? supabase.from('finance_transactions').select('id, source_id, amount, transaction_date, created_at, payment_method, reference_number, receipt_number').eq('source_table', 'finance_invoices').eq('direction', 'incoming').in('source_id', invIds).order('transaction_date') : none,
      invIds.length ? supabase.from('credit_notes').select('id, invoice_id, credit_note_number, status, currency, total_amount, issue_date').in('invoice_id', invIds).order('created_at') : none,
      poIds.length ? supabase.from('purchase_order_lines').select('po_id, quote_line_id, quantity_ordered, quantity_received').in('po_id', poIds) : none,
      poIds.length ? supabase.from('goods_received_notes').select('id, grn_number, po_id, status, received_date').in('po_id', poIds).order('received_date') : none,
      poIds.length ? supabase.from('supplier_invoices').select('id, invoice_number, bill_number, po_id, status, currency, subtotal, total_amount, amount_paid, balance_due, due_date').eq('company_id', cid).in('po_id', poIds) : none,
    ])
    setPayments((txRes.data ?? []) as Payment[])
    setCredits((cnRes.data ?? []) as CreditNote[])
    setPoLines((plRes.data ?? []) as PoLine[])
    setGrns((gRes.data ?? []) as Grn[])
    setBills(((bRes.data ?? []) as Bill[]).filter(b => !['voided', 'cancelled', 'rejected'].includes(String(b.status))))
    setLoading(false)
  }, [id])

  useEffect(() => { void load() }, [load])

  const cur = quote?.currency ?? 'ZAR'
  const money = useMemo(() => orderMoney(Number(quote?.total_amount) || 0, invoices), [quote, invoices])
  const invNumber = useMemo(() => new Map(invoices.map(i => [i.id, i.invoice_number ?? 'Draft'])), [invoices])
  const poNumber = useMemo(() => new Map(pos.map(p => [p.id, p.po_number ?? 'PO'])), [pos])

  // Team only: estimated (from the quote's cost prices) and actual (supplier bills and contractor payouts, excl. VAT).
  const profit = useMemo(() => {
    const quotedSell = Number(quote?.subtotal) || 0
    const quotedCost = Number(quote?.cost_total) || 0
    const invoicedExVat = invoices.filter(i => !['voided', 'cancelled', 'draft'].includes(String(i.status))).reduce((s, i) => s + (Number(i.subtotal) || 0), 0)
    const billsIn = bills.filter(b => sameCur(b.currency, cur))
    const payoutsIn = sameCur('ZAR', cur) ? payouts : []
    const actualCost = billsIn.reduce((s, b) => s + (Number(b.subtotal) || 0), 0) + payoutsIn.reduce((s, p) => s + (Number(p.subtotal ?? p.total_amount) || 0), 0)
    const excluded = (bills.length - billsIn.length) + (payouts.length - payoutsIn.length)
    const sellBase = invoicedExVat > 0 ? invoicedExVat : quotedSell
    return {
      quotedSell, quotedCost, quotedMargin: quotedCost > 0 && quotedSell > 0 ? ((quotedSell - quotedCost) / quotedSell) * 100 : null,
      actualCost, excluded, sellBase, invoicedExVat,
      actualProfit: sellBase - actualCost,
      actualMargin: sellBase > 0 && actualCost > 0 ? ((sellBase - actualCost) / sellBase) * 100 : null,
    }
  }, [quote, invoices, bills, payouts, cur])

  async function createPartInvoice() {
    if (!companyId || !quote) return
    setBusy('part')
    const r = await createPartInvoiceFromQuote(createClient(), { companyId, quoteId: quote.id, employeeId, percent: Number(partPct.replace(',', '.')), label: partLabel })
    setBusy(null)
    if ('error' in r) { setError(r.error); return }
    router.push(r.created ? `/dashboard/money/invoices/${r.id}/edit` : `/dashboard/money/invoices/${r.id}`)
  }
  /** "Create invoice": a draft is opened; otherwise choose the rest of the order or a deposit / progress %. */
  function startInvoice() {
    const draft = invoices.find(i => String(i.status) === 'draft')
    if (draft) { router.push(`/dashboard/money/invoices/${draft.id}`); return }
    if (money.toInvoice <= 0.01 && invoices.some(i => !['voided', 'cancelled'].includes(String(i.status)))) { setTab('invoices'); return }
    setInvoicePanel(true)
  }
  async function createInvoice() {
    if (!companyId || !quote) return
    setBusy('invoice')
    setInvoicePanel(false)
    const r = await createInvoiceFromQuote(createClient(), { companyId, quoteId: quote.id, employeeId })
    setBusy(null)
    if ('error' in r) { setError(r.error); return }
    router.push(r.created ? `/dashboard/money/invoices/${r.id}/edit` : `/dashboard/money/invoices/${r.id}`)
  }
  async function createRfq() {
    if (!companyId || !quote) return
    setBusy('rfq')
    const r = await createSupplyRfqFromQuote(createClient(), { companyId, quoteId: quote.id, employeeId, dealId: quote.deal_id, reuseExisting: false })
    setBusy(null)
    if (!r.ok) { setError(r.message); return }
    router.push(`/dashboard/supply/rfqs/${r.data.id}`)
  }

  if (loading) return <p className="py-16 text-center text-[13px] text-text-secondary">Loading…</p>
  if (!quote) return <p className="py-16 text-center text-[13px] text-error">{error ?? 'Order not found.'}</p>

  const st = ORDER_STATE[money.state]
  const link = quote.deal_id && quote.client_deals
    ? { href: `/dashboard/projects/${quote.deal_id}`, text: [quote.client_deals.project_code, quote.client_deals.title].filter(Boolean).join(' · '), icon: 'folder' }
    : quote.job_id && quote.jobs
      ? { href: `/dashboard/jobs/${quote.job_id}`, text: [quote.jobs.job_code, quote.jobs.title].filter(Boolean).join(' · '), icon: 'construction' }
      : null
  const notAccepted = quote.status !== 'accepted'
  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'items', label: 'Items', count: lines.filter(l => !l.is_excluded).length },
    { id: 'invoices', label: 'Invoices', count: invoices.length },
    { id: 'payments', label: 'Payments', count: payments.length },
    { id: 'credits', label: 'Credit notes', count: credits.length },
    { id: 'purchasing', label: 'Purchasing', count: rfqs.length + pos.length + grns.length + bills.length + payouts.length },
  ]


  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 py-4 space-y-3">
        <div className="flex items-start gap-3 flex-wrap">
          <Link href="/dashboard/money/orders" className="mt-1 text-text-secondary hover:text-text-primary" aria-label="Back to orders">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[18px] font-semibold text-text-primary">Order {quote.quote_number ?? ''}</h1>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${st.cls}`}>{st.label}</span>
            </div>
            <p className="text-[12.5px] text-text-secondary truncate">
              {[quote.clients?.name, quote.title].filter(Boolean).join(' · ')}{quote.accepted_at ? ` · accepted ${fmtDay(quote.accepted_at)}` : ''}
            </p>
            {link && (
              <Link href={link.href} className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline">
                <span className="material-icons !text-[14px] !leading-none">{link.icon}</span>{link.text}
              </Link>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link href={`/dashboard/money/quotes/${quote.id}`} className="btn-outlined h-8 px-3 text-[12px] inline-flex items-center gap-1">
              <span className="material-icons text-[16px]">request_quote</span>Quote
            </Link>
            <button type="button" onClick={startInvoice} disabled={!!busy || notAccepted}
              className="btn-primary h-8 px-3 text-[12px] inline-flex items-center gap-1 disabled:opacity-50">
              <span className="material-icons text-[16px]">receipt_long</span>{busy === 'invoice' ? 'Opening…' : money.hasDraft ? 'Open draft invoice' : money.toInvoice > 0.01 ? 'Create invoice' : 'Invoices'}
            </button>
          </div>
        </div>

        {notAccepted && (
          <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            This quote is {label(quote.status)}, not accepted, so it isn&apos;t an order yet.
          </p>
        )}
        {error && <p className="text-[12px] text-error bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

        {invoicePanel && (() => {
          const pct = Number(partPct.replace(',', '.')) || 0
          const qSub = Number(quote.subtotal) || 0
          const rate = qSub > 0 ? (Number(quote.vat_amount) || 0) / qSub : 0
          const partTotal = Math.round(qSub * pct / 100 * (1 + rate) * 100) / 100
          return (
            <div className="rounded-xl border border-primary/30 bg-surface px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[13.5px] font-semibold text-text-primary">Create an invoice for this order</p>
                <button type="button" onClick={() => setInvoicePanel(false)} aria-label="Close" className="text-text-secondary hover:text-text-primary"><span className="material-icons text-[18px]">close</span></button>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-divider p-3 space-y-2">
                  <p className="text-[13px] font-medium text-text-primary">{money.invoiced > 0 ? 'Final invoice (the rest)' : 'Invoice the whole order'}</p>
                  <p className="text-[12px] text-text-secondary">
                    Every line of the quote{money.invoiced > 0 ? ', less what was already invoiced' : ''}: {formatCurrency(money.toInvoice, cur)} incl. VAT.
                  </p>
                  <button type="button" disabled={!!busy} onClick={() => void createInvoice()} className="btn-primary h-8 px-3 text-[12px] disabled:opacity-50">
                    {busy === 'invoice' ? 'Creating…' : 'Create invoice'}
                  </button>
                </div>
                <div className="rounded-lg border border-divider p-3 space-y-2">
                  <p className="text-[13px] font-medium text-text-primary">Deposit or progress invoice</p>
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    <select value={partLabel} onChange={e => setPartLabel(e.target.value)} className="h-8 rounded-lg border border-divider bg-surface px-2 text-[12.5px]">
                      <option>Deposit</option>
                      <option>Progress payment</option>
                    </select>
                    <label className="inline-flex items-center gap-1 h-8 rounded-lg border border-divider px-2 bg-surface">
                      <input value={partPct} onChange={e => setPartPct(e.target.value)} inputMode="decimal" aria-label="Percent of the order" className="w-12 text-right bg-transparent focus:outline-none" />%
                    </label>
                    <span className="text-text-secondary">of the order = <b className="text-text-primary">{formatCurrency(partTotal, cur)}</b> incl. VAT</span>
                  </div>
                  <button type="button" disabled={!!busy || !(pct > 0)} onClick={() => void createPartInvoice()} className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-50">
                    {busy === 'part' ? 'Creating…' : `Create ${partLabel.toLowerCase()} invoice`}
                  </button>
                </div>
              </div>
              <p className="text-[11.5px] text-text-secondary">The invoice opens as a draft so you can check it, then send it. The final invoice takes off what deposits and progress invoices already billed.</p>
            </div>
          )
        })()}

        <div className="flex gap-1 border-b border-divider overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('px-3 py-1.5 text-[12.5px] font-medium border-b-2 -mb-px whitespace-nowrap',
                tab === t.id ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary')}>
              {t.label}{t.count != null && <span className="ml-1 opacity-70">({t.count})</span>}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <Card title="Order value" value={formatCurrency(money.value, cur)} sub="incl. VAT" />
              <Card title="Invoiced" value={formatCurrency(money.invoiced, cur)} sub={money.hasDraft ? 'plus a draft' : `${invoices.filter(i => !['voided', 'cancelled', 'draft'].includes(String(i.status))).length} sent`} />
              <Card title="Paid" value={formatCurrency(money.paid, cur)} tone="text-emerald-700" sub={`${payments.length} payment${payments.length === 1 ? '' : 's'}`} />
              <Card title="Owing" value={formatCurrency(money.owing, cur)} tone={money.owing > 0.004 ? 'text-error' : undefined} />
              <Card title="Still to invoice" value={formatCurrency(money.toInvoice, cur)} />
            </div>
            <div className="rounded-xl border border-divider bg-surface overflow-hidden">
              <div className="px-4 py-2 border-b border-divider flex items-center gap-1 text-[13px] font-semibold text-text-primary">
                <span className="material-icons !text-[14px] !leading-none text-text-secondary">lock</span>Profit <span className="font-normal text-[11.5px] text-text-secondary ml-1">only your team sees this · excl. VAT</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
                <Card title="Quoted cost" value={profit.quotedCost > 0 ? formatCurrency(profit.quotedCost, cur) : '—'} sub={profit.quotedMargin != null ? `margin ${Math.round(profit.quotedMargin * 10) / 10}%` : 'no cost prices on the quote'} />
                <Card title="Actual cost" value={profit.actualCost > 0 ? formatCurrency(profit.actualCost, cur) : '—'} sub={`${bills.length} supplier bill${bills.length === 1 ? '' : 's'}${payouts.length ? ` · ${payouts.length} payout${payouts.length === 1 ? '' : 's'}` : ''}`} />
                <Card title={profit.invoicedExVat > 0 ? 'Invoiced (excl. VAT)' : 'Quoted (excl. VAT)'} value={formatCurrency(profit.sellBase, cur)} />
                <Card title="Actual profit" value={profit.actualCost > 0 ? formatCurrency(profit.actualProfit, cur) : '—'}
                  tone={profit.actualCost > 0 ? (profit.actualProfit < 0 ? 'text-error' : 'text-emerald-700') : undefined}
                  sub={profit.actualMargin != null ? `margin ${Math.round(profit.actualMargin * 10) / 10}%` : 'once supplier bills or payouts are in'} />
              </div>
              {profit.excluded > 0 && (
                <p className="px-4 pb-3 -mt-1 text-[11.5px] text-text-secondary">{profit.excluded} cost{profit.excluded === 1 ? ' is' : 's are'} in another currency and not included above.</p>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Section title="Next steps">
                <ul className="px-4 py-3 space-y-1.5 text-[12.5px] text-text-primary">
                  {money.state === 'to_invoice' && <li>• Nothing invoiced yet. <button type="button" onClick={startInvoice} className="text-primary hover:underline">Create the invoice</button>.</li>}
                  {money.hasDraft && <li>• A draft invoice is waiting to be sent. <button type="button" onClick={() => setTab('invoices')} className="text-primary hover:underline">Open invoices</button>.</li>}
                  {money.owing > 0.004 && <li>• {formatCurrency(money.owing, cur)} is still owing. <button type="button" onClick={() => setTab('invoices')} className="text-primary hover:underline">Record a payment</button> on the invoice when it comes in.</li>}
                  {money.toInvoice > 0.01 && money.invoiced > 0 && <li>• {formatCurrency(money.toInvoice, cur)} of the order still has to be invoiced.</li>}
                  {pos.length === 0 && <li>• Need to buy anything for this order? <Link href={`/dashboard/supply/purchase-orders/new?quote_id=${quote.id}`} className="text-primary hover:underline">Create a purchase order</Link> from its lines.</li>}
                  {money.state === 'paid' && <li>• Paid in full.</li>}
                </ul>
              </Section>
              <Section title="Documents">
                <ul className="px-4 py-3 space-y-1 text-[12.5px]">
                  <li className="flex justify-between gap-2"><span className="text-text-secondary">Quote</span><Link className="text-primary hover:underline" href={`/dashboard/money/quotes/${quote.id}`}>{quote.quote_number}</Link></li>
                  {invoices.map(i => (
                    <li key={i.id} className="flex justify-between gap-2"><span className="text-text-secondary">Invoice · {label(i.status)}</span><Link className="text-primary hover:underline" href={`/dashboard/money/invoices/${i.id}`}>{i.invoice_number ?? 'Draft'}</Link></li>
                  ))}
                  {credits.map(c => (
                    <li key={c.id} className="flex justify-between gap-2"><span className="text-text-secondary">Credit note</span><Link className="text-primary hover:underline" href={`/dashboard/money/credit-notes/${c.id}`}>{c.credit_note_number ?? 'Credit note'}</Link></li>
                  ))}
                  {pos.map(p => (
                    <li key={p.id} className="flex justify-between gap-2"><span className="text-text-secondary">Purchase order · {p.supplier?.name ?? ''}</span><Link className="text-primary hover:underline" href={`/dashboard/supply/purchase-orders/${p.id}`}>{p.po_number ?? 'PO'}</Link></li>
                  ))}
                </ul>
              </Section>
            </div>
          </div>
        )}

        {tab === 'items' && (
          <Section title="What was ordered" action={<Link href={`/dashboard/supply/purchase-orders/new?quote_id=${quote.id}`} className="btn-outlined h-7 px-2.5 text-[11.5px]">Create PO from these lines</Link>}>
            <ResponsiveDataView table={
              <table className="w-full" style={{ minWidth: 640 }}>
                <thead><tr className="bg-surface-elevated border-b border-divider">
                  <th className={`${MONEY_TH} text-left`}>Item</th>
                  <th className={`${MONEY_TH} text-right`}>Qty</th>
                  <th className={`${MONEY_TH} text-right`}>Price</th>
                  <th className={`${MONEY_TH} text-right`}>Disc.</th>
                  <th className={`${MONEY_TH} text-right`}>Total</th>
                  <th className={`${MONEY_TH} text-right`} title="Only your team sees this">Cost</th>
                  <th className={`${MONEY_TH} text-right`} title="Quantity on purchase orders / received">On PO · received</th>
                </tr></thead>
                <tbody>
                  {lines.filter(l => !l.is_excluded).map(l => {
                    const onPo = poLines.filter(p => p.quote_line_id === l.id)
                    const ordered = onPo.reduce((s, p) => s + (Number(p.quantity_ordered) || 0), 0)
                    const received = onPo.reduce((s, p) => s + (Number(p.quantity_received) || 0), 0)
                    return (
                      <tr key={l.id} className="border-b border-divider last:border-0">
                        <td className={`${MONEY_TD} text-text-primary whitespace-normal`}>{l.description || '—'}</td>
                        <td className={`${MONEY_TD} text-right tabular-nums`}>{Number(l.quantity ?? 0)} {l.unit && l.unit !== 'each' ? l.unit : ''}</td>
                        <td className={`${MONEY_TD} text-right tabular-nums`}>{formatCurrency(Number(l.unit_sell_price) || 0, cur)}</td>
                        <td className={`${MONEY_TD} text-right tabular-nums`}>{Number(l.discount_percent) > 0 ? `${Number(l.discount_percent)}%` : '—'}</td>
                        <td className={`${MONEY_TD} text-right tabular-nums font-medium`}>{formatCurrency(Number(l.subtotal_sell) || 0, cur)}</td>
                        <td className={`${MONEY_TD} text-right tabular-nums text-text-secondary`}>{Number(l.cost_price) > 0 ? formatCurrency(Number(l.cost_price), cur) : '—'}</td>
                        <td className={`${MONEY_TD} text-right tabular-nums text-text-secondary`}>{onPo.length ? `${ordered} · ${received}` : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            } />
          </Section>
        )}

        {tab === 'invoices' && (
          <InvoicesList embedded quoteId={quote.id} onNew={notAccepted || (money.toInvoice <= 0.01 && !money.hasDraft) ? undefined : () => { startInvoice(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            newLabel={money.hasDraft ? 'Open draft invoice' : 'Create invoice'} />
        )}

        {tab === 'payments' && (
          <Section title="Payments received">
            {payments.length === 0 ? <Empty text="No payments yet. Record a payment on the invoice when the money comes in." /> : (
              <ResponsiveDataView table={
                <table className="w-full" style={{ minWidth: 560 }}>
                  <thead><tr className="bg-surface-elevated border-b border-divider">
                    <th className={`${MONEY_TH} text-left`}>Date</th>
                    <th className={`${MONEY_TH} text-left`}>Invoice</th>
                    <th className={`${MONEY_TH} text-left`}>Receipt</th>
                    <th className={`${MONEY_TH} text-left`}>Method · reference</th>
                    <th className={`${MONEY_TH} text-right`}>Amount</th>
                  </tr></thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p.id} className="border-b border-divider last:border-0">
                        <td className={MONEY_TD}>{fmtDay(p.transaction_date ?? p.created_at)}</td>
                        <td className={MONEY_TD}><Link className="text-primary hover:underline" href={`/dashboard/money/invoices/${p.source_id}`}>{invNumber.get(p.source_id) ?? 'Invoice'}</Link></td>
                        <td className={`${MONEY_TD} text-text-secondary`}>{p.receipt_number ?? '—'}</td>
                        <td className={`${MONEY_TD} text-text-secondary`}>{[label(p.payment_method), p.reference_number].filter(v => v && v !== '—').join(' · ') || '—'}</td>
                        <td className={`${MONEY_TD} text-right tabular-nums font-medium text-emerald-700`}>{formatCurrency(Number(p.amount) || 0, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              } />
            )}
          </Section>
        )}

        {tab === 'credits' && (
          <Section title="Credit notes" action={<span className="text-[11.5px] text-text-secondary">Create one from the invoice it is for</span>}>
            {credits.length === 0 ? <Empty text="No credit notes. To give one, open the invoice and choose Issue credit note." /> : (
              <ResponsiveDataView table={
                <table className="w-full" style={{ minWidth: 520 }}>
                  <thead><tr className="bg-surface-elevated border-b border-divider">
                    <th className={`${MONEY_TH} text-left`}>Credit note</th>
                    <th className={`${MONEY_TH} text-left`}>Invoice</th>
                    <th className={`${MONEY_TH} text-left`}>Date</th>
                    <th className={`${MONEY_TH} text-left`}>Status</th>
                    <th className={`${MONEY_TH} text-right`}>Amount</th>
                  </tr></thead>
                  <tbody>
                    {credits.map(c => (
                      <tr key={c.id} onClick={() => router.push(`/dashboard/money/credit-notes/${c.id}`)} className="border-b border-divider last:border-0 cursor-pointer hover:bg-surface-elevated">
                        <td className={`${MONEY_TD} font-mono`}>{c.credit_note_number ?? '—'}</td>
                        <td className={MONEY_TD}>{c.invoice_id ? invNumber.get(c.invoice_id) ?? '—' : '—'}</td>
                        <td className={MONEY_TD}>{fmtDay(c.issue_date)}</td>
                        <td className={MONEY_TD}><span className={pill}>{label(c.status)}</span></td>
                        <td className={`${MONEY_TD} text-right tabular-nums`}>{formatCurrency(Number(c.total_amount) || 0, c.currency ?? cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              } />
            )}
          </Section>
        )}

        {tab === 'purchasing' && (
          <div className="space-y-3">
            <Section title="Requests for quotation" action={<button type="button" onClick={() => void createRfq()} disabled={!!busy} className="btn-outlined h-7 px-2.5 text-[11.5px] disabled:opacity-50">{busy === 'rfq' ? 'Opening…' : 'Create RFQ'}</button>}>
              {rfqs.length === 0 ? <Empty text="No RFQs. Ask suppliers for prices on this order's lines." /> : (
                <ul className="divide-y divide-divider">
                  {rfqs.map(r => (
                    <li key={r.id}><Link href={`/dashboard/supply/rfqs/${r.id}`} className="flex justify-between gap-2 px-4 py-2 text-[12.5px] hover:bg-surface-elevated">
                      <span><span className="font-mono text-text-secondary mr-2">{r.rfq_number}</span>{r.title}</span><span className={pill}>{label(r.status)}</span>
                    </Link></li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Purchase orders" action={<Link href={`/dashboard/supply/purchase-orders/new?quote_id=${quote.id}`} className="btn-outlined h-7 px-2.5 text-[11.5px]">Create PO</Link>}>
              {pos.length === 0 ? <Empty text="No purchase orders. Create one from this order's lines (at their cost price)." /> : (
                <ResponsiveDataView table={
                  <table className="w-full" style={{ minWidth: 560 }}>
                    <thead><tr className="bg-surface-elevated border-b border-divider">
                      <th className={`${MONEY_TH} text-left`}>PO</th>
                      <th className={`${MONEY_TH} text-left`}>Supplier</th>
                      <th className={`${MONEY_TH} text-left`}>Needed by</th>
                      <th className={`${MONEY_TH} text-left`}>Status</th>
                      <th className={`${MONEY_TH} text-right`}>Total</th>
                    </tr></thead>
                    <tbody>
                      {pos.map(p => (
                        <tr key={p.id} onClick={() => router.push(`/dashboard/supply/purchase-orders/${p.id}`)} className="border-b border-divider last:border-0 cursor-pointer hover:bg-surface-elevated">
                          <td className={`${MONEY_TD} font-mono`}>{p.po_number ?? '—'}</td>
                          <td className={MONEY_TD}>{p.supplier?.name ?? '—'}</td>
                          <td className={MONEY_TD}>{fmtDay(p.required_delivery_date)}</td>
                          <td className={MONEY_TD}><span className={pill}>{label(p.status)}</span></td>
                          <td className={`${MONEY_TD} text-right tabular-nums`}>{formatCurrency(Number(p.total_amount) || 0, p.currency ?? 'ZAR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                } />
              )}
            </Section>
            <Section title="Goods received">
              {grns.length === 0 ? <Empty text="Nothing received yet." /> : (
                <ul className="divide-y divide-divider">
                  {grns.map(g => (
                    <li key={g.id} className="flex justify-between gap-2 px-4 py-2 text-[12.5px]">
                      <span><span className="font-mono text-text-secondary mr-2">{g.grn_number}</span>for {g.po_id ? poNumber.get(g.po_id) : 'PO'} · {fmtDay(g.received_date)}</span><span className={pill}>{label(g.status)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Supplier bills">
              {bills.length === 0 ? <Empty text="No supplier bills linked to this order's purchase orders yet." /> : (
                <ResponsiveDataView table={
                  <table className="w-full" style={{ minWidth: 560 }}>
                    <thead><tr className="bg-surface-elevated border-b border-divider">
                      <th className={`${MONEY_TH} text-left`}>Bill</th>
                      <th className={`${MONEY_TH} text-left`}>For PO</th>
                      <th className={`${MONEY_TH} text-left`}>Status</th>
                      <th className={`${MONEY_TH} text-right`}>Total</th>
                      <th className={`${MONEY_TH} text-right`}>Still to pay</th>
                    </tr></thead>
                    <tbody>
                      {bills.map(b => (
                        <tr key={b.id} onClick={() => router.push(`/dashboard/finance/supplier-invoices/${b.id}`)} className="border-b border-divider last:border-0 cursor-pointer hover:bg-surface-elevated">
                          <td className={`${MONEY_TD} font-mono`}>{b.invoice_number ?? b.bill_number ?? '—'}</td>
                          <td className={MONEY_TD}>{b.po_id ? poNumber.get(b.po_id) : '—'}</td>
                          <td className={MONEY_TD}><span className={pill}>{label(b.status)}</span></td>
                          <td className={`${MONEY_TD} text-right tabular-nums`}>{formatCurrency(Number(b.total_amount) || 0, b.currency ?? 'ZAR')}</td>
                          <td className={`${MONEY_TD} text-right tabular-nums`}>{formatCurrency(Number(b.balance_due) || 0, b.currency ?? 'ZAR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                } />
              )}
            </Section>
            {(payouts.length > 0 || quote.job_id) && (
              <Section title="Contractor payouts">
                {payouts.length === 0 ? <Empty text="No contractor payouts for this order's job." /> : (
                  <ul className="divide-y divide-divider">
                    {payouts.map(p => (
                      <li key={p.id} className="flex justify-between gap-2 px-4 py-2 text-[12.5px]">
                        <span>{p.contractor?.name ?? 'Contractor'}{p.remittance_number ? ` · ${p.remittance_number}` : ''} · {fmtDay(p.payout_date)}</span>
                        <span className="flex items-center gap-2"><span className={pill}>{label(p.payout_status)}</span><span className="tabular-nums">{formatCurrency(Number(p.total_amount) || 0, 'ZAR')}</span></span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
