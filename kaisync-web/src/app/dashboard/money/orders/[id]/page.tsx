'use client'

/**
 * One order (an accepted quote) with everything done for it in one place.
 * A small "what's next" card with one button, then three tabs:
 *  What was sold · Invoices & payments (with credit notes) · Buying in (purchase orders, goods received, RFQs, bills).
 * A service-only order with nothing bought in has no Buying in tab.
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
import { createJob } from '@/lib/jobs'
import { createProject } from '@/lib/projects'
import { isServiceOnly, lineSupply, processOrder, type OrderPoLine, type SupplyMode } from '@/lib/money/order-supply'
import { GoodsReceivedPanel, PurchaseOrdersPanel, type SupplyBill, type SupplyGrn, type SupplyGrnLine, type SupplyPo } from '@/components/money/OrderSupply'

type Quote = {
  id: string; company_id: string; quote_number: string | null; title: string | null; status: string; currency: string | null
  subtotal: number | null; vat_amount: number | null; total_amount: number | null; cost_total: number | null
  gross_profit: number | null; gross_margin_percent: number | null; accepted_at: string | null; valid_until: string | null
  accepted_by_name: string | null
  client_id: string | null; job_id: string | null; deal_id: string | null
  clients?: { name: string } | null
  jobs?: { job_code: string | null; title: string | null } | null
  client_deals?: { project_code: string | null; title: string | null } | null
}
type Line = {
  id: string; description: string | null; quantity: number | null; unit: string | null; unit_sell_price: number | null
  discount_percent: number | null; subtotal_sell: number | null; cost_price: number | null; is_excluded: boolean | null
  supply_mode: SupplyMode; supplier_id: string | null
}
type Payment = { id: string; source_id: string; amount: number | null; transaction_date: string | null; created_at: string; payment_method: string | null; reference_number: string | null; receipt_number: string | null }
type CreditNote = { id: string; invoice_id: string | null; credit_note_number: string | null; status: string | null; currency: string | null; total_amount: number | null; issue_date: string | null }
type Rfq = { id: string; rfq_number: string | null; title: string | null; status: string | null; created_at: string }
type Po = SupplyPo
type PoLine = OrderPoLine
type Grn = SupplyGrn
type Bill = SupplyBill & { subtotal: number | null; amount_paid: number | null; balance_due: number | null; due_date: string | null }
type Payout = { id: string; payout_status: string | null; total_amount: number | null; subtotal: number | null; payout_date: string | null; remittance_number: string | null; contractor?: { name: string } | null }

type Tab = 'sold' | 'money' | 'buying'
type BuyTab = 'pos' | 'received' | 'other'
/** Old links (?tab=invoices, ?tab=pos …) still land on the right tab. */
function tabFrom(v: string | null): { tab: Tab; buy: BuyTab } {
  if (v === 'invoices' || v === 'payments' || v === 'credits' || v === 'money') return { tab: 'money', buy: 'pos' }
  if (v === 'pos' || v === 'buying') return { tab: 'buying', buy: 'pos' }
  if (v === 'received') return { tab: 'buying', buy: 'received' }
  if (v === 'purchasing') return { tab: 'buying', buy: 'other' }
  return { tab: 'sold', buy: 'pos' }
}

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
  const [tab, setTab] = useState<Tab>(() => tabFrom(sp.get('tab')).tab)
  const [buyTab, setBuyTab] = useState<BuyTab>(() => tabFrom(sp.get('tab')).buy)
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
  const [grnLines, setGrnLines] = useState<SupplyGrnLine[]>([])
  const [sendTo, setSendTo] = useState<Map<string, string>>(new Map())
  const [processing, setProcessing] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [bills, setBills] = useState<Bill[]>([])
  const [allBills, setAllBills] = useState<Bill[]>([])
  const [payouts, setPayouts] = useState<Payout[]>([])

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)
    const cid = member.companyId
    const { data: q, error: qErr } = await supabase.from('commercial_quotes')
      .select('id, company_id, quote_number, title, status, currency, subtotal, vat_amount, total_amount, cost_total, gross_profit, gross_margin_percent, accepted_at, accepted_by_name, valid_until, client_id, job_id, deal_id, clients(name), jobs!commercial_quotes_job_id_fkey(job_code, title), client_deals!commercial_quotes_deal_id_fkey(project_code, title)')
      .eq('id', id).eq('company_id', cid).maybeSingle()
    if (qErr || !q) { setError(qErr?.message ?? 'Order not found.'); setLoading(false); return }
    const qq = q as unknown as Quote
    setQuote(qq)

    const [lRes, iRes, rRes, pRes, payRes] = await Promise.all([
      supabase.from('commercial_quote_lines').select('id, description, quantity, unit, unit_sell_price, discount_percent, subtotal_sell, cost_price, is_excluded, supply_mode, supplier_id').eq('quote_id', id).order('sort_order'),
      supabase.from('finance_invoices').select('id, quote_id, invoice_number, status, currency, subtotal, total_amount, amount_paid, balance_due, issue_date, due_date').eq('company_id', cid).eq('quote_id', id).order('created_at'),
      supabase.from('rfqs').select('id, rfq_number, title, status, created_at').eq('company_id', cid).eq('quote_id', id).order('created_at'),
      supabase.from('purchase_orders').select('id, po_number, status, currency, subtotal, vat_amount, total_amount, required_delivery_date, created_at, approved_at, sent_at, delivery_address, notes, terms_and_conditions, supplier_id, supplier:contractors!purchase_orders_supplier_id_fkey(name, email)').eq('company_id', cid).eq('quote_id', id).order('created_at'),
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
    const rfqIds = ((rRes.data ?? []) as Rfq[]).map(r => r.id)
    const none = Promise.resolve({ data: [] as unknown[] })
    const [txRes, cnRes, plRes, gRes, bRes, rcRes] = await Promise.all([
      invIds.length ? supabase.from('finance_transactions').select('id, source_id, amount, transaction_date, created_at, payment_method, reference_number, receipt_number').eq('source_table', 'finance_invoices').eq('direction', 'incoming').in('source_id', invIds).order('transaction_date') : none,
      invIds.length ? supabase.from('credit_notes').select('id, invoice_id, credit_note_number, status, currency, total_amount, issue_date').in('invoice_id', invIds).order('created_at') : none,
      poIds.length ? supabase.from('purchase_order_lines').select('id, po_id, quote_line_id, description, unit, quantity_ordered, quantity_received, unit_price, vat_rate').in('po_id', poIds).order('sort_order') : none,
      poIds.length ? supabase.from('goods_received_notes').select('id, grn_number, po_id, status, received_date, created_at, delivery_note_number, notes').in('po_id', poIds).order('created_at', { ascending: false }) : none,
      poIds.length ? supabase.from('supplier_invoices').select('id, invoice_number, bill_number, po_id, grn_id, status, approval_status, currency, subtotal, total_amount, amount_paid, balance_due, due_date').eq('company_id', cid).in('po_id', poIds) : none,
      rfqIds.length ? supabase.from('rfq_recipients').select('supplier_id, send_to').in('rfq_id', rfqIds) : none,
    ])
    setPayments((txRes.data ?? []) as Payment[])
    setCredits((cnRes.data ?? []) as CreditNote[])
    setPoLines((plRes.data ?? []) as PoLine[])
    const grnRows = (gRes.data ?? []) as Grn[]
    setGrns(grnRows)
    const allBills = (bRes.data ?? []) as Bill[]
    setAllBills(allBills)
    setBills(allBills.filter(b => !['voided', 'cancelled', 'rejected'].includes(String(b.status))))
    setSendTo(new Map(((rcRes.data ?? []) as { supplier_id: string; send_to: string | null }[]).filter(r => r.send_to).map(r => [r.supplier_id, r.send_to as string])))
    const gl = grnRows.length ? await supabase.from('goods_received_lines').select('grn_id, description, quantity_received').in('grn_id', grnRows.map(g => g.id)) : { data: [] }
    setGrnLines((gl.data ?? []) as SupplyGrnLine[])
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
    if (money.toInvoice <= 0.01 && invoices.some(i => !['voided', 'cancelled'].includes(String(i.status)))) { setTab('money'); return }
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
  /** Process order: one PO per chosen supplier, shown on the Purchase orders tab to send. */
  async function runProcessOrder() {
    if (!quote) return
    setProcessing(true); setError(null); setNote(null)
    const r = await processOrder(createClient(), quote.id)
    setProcessing(false)
    if (!r.ok) { setError(r.message); return }
    setNote(r.created.length
      ? `Made ${r.created.map(c => c.po_number).join(', ')}. Check them, then Send all.`
      : 'Nothing new to put on a purchase order.')
    setTab('buying'); setBuyTab('pos')
    await load()
  }
  /** Link the order to a new job or project (what "What's next?" used to offer after accepting). */
  async function makeJobOrProject(kind: 'job' | 'project') {
    if (!companyId || !quote) return
    setBusy(kind); setError(null)
    const supabase = createClient()
    const title = quote.title?.trim() || quote.quote_number || (kind === 'job' ? 'Job from order' : 'Project from order')
    const r = kind === 'job'
      ? await createJob(supabase, { companyId, title, clientId: quote.client_id, dealId: quote.deal_id, createdByEmployeeId: employeeId, assignCode: true, status: 'open' })
      : await createProject(supabase, { companyId, title, clientId: quote.client_id, status: 'in_progress', assignCode: true, notes: null })
    if (!r.ok) { setBusy(null); setError(r.message); return }
    await supabase.from('commercial_quotes').update(kind === 'job' ? { job_id: r.data.id } : { deal_id: r.data.id }).eq('id', quote.id).eq('company_id', companyId)
    setBusy(null)
    router.push(kind === 'job' ? `/dashboard/jobs/${r.data.id}` : `/dashboard/projects/${r.data.id}`)
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
  const counted = lines.filter(l => !l.is_excluded)
  const supply = new Map(counted.map(l => [l.id, lineSupply(l, poLines, pos)]))
  const canProcess = !notAccepted && [...supply.values()].some(x => x.key === 'ready')
  const toSource = [...supply.values()].filter(x => x.key === 'to_source').length
  const serviceOnly = isServiceOnly(lines, pos)
  const showBuying = !serviceOnly || rfqs.length + bills.length + payouts.length > 0
  const liveGrns = grns.filter(g => g.status !== 'cancelled')
  const sentInvoices = invoices.filter(i => !['voided', 'cancelled', 'draft'].includes(String(i.status)))
  const posToSend = pos.filter(p => p.status === 'approved' && !p.sent_at)
  const TABS: { id: Tab; label: string; short: string; icon: string; count: number }[] = [
    { id: 'sold', label: 'What was sold', short: 'Sold', icon: 'inventory_2', count: counted.length },
    { id: 'money', label: 'Invoices & payments', short: 'Invoices', icon: 'receipt_long', count: invoices.length + payments.length + credits.length },
    ...(showBuying ? [{ id: 'buying' as Tab, label: 'Buying in', short: 'Buying in', icon: 'local_shipping', count: pos.length + liveGrns.length + rfqs.length + bills.length + payouts.length }] : []),
  ]
  const BUY_TABS: { id: BuyTab; label: string; count: number }[] = [
    { id: 'pos', label: 'Purchase orders', count: pos.length },
    { id: 'received', label: 'Goods received', count: liveGrns.length },
    { id: 'other', label: 'Supplier prices & bills', count: rfqs.length + bills.length + payouts.length },
  ]

  // ── What's next: one sentence, one button ──
  const owingInvoice = sentInvoices.find(i => (Number(i.balance_due) || 0) > 0.004)
  const draftInvoice = invoices.find(i => String(i.status) === 'draft')
  const paidPct = money.value > 0 ? Math.min(100, Math.round((money.paid / money.value) * 100)) : 0
  type Next = { tone: 'amber' | 'blue' | 'green'; icon: string; title: string; sub: string; action?: { label: string; href?: string; onClick?: () => void } }
  const next: Next | null = notAccepted ? null
    : draftInvoice ? { tone: 'blue', icon: 'edit_note', title: 'An invoice is ready to check and send', sub: `${draftInvoice.invoice_number ?? 'Draft'} · ${formatCurrency(Number(draftInvoice.total_amount) || 0, cur)}`, action: { label: 'Open invoice', href: `/dashboard/money/invoices/${draftInvoice.id}` } }
    : money.state === 'to_invoice' ? { tone: 'blue', icon: 'receipt_long', title: 'Next: invoice the client', sub: `Nothing invoiced yet · order ${formatCurrency(money.value, cur)}`, action: { label: 'Create invoice', onClick: startInvoice } }
    : owingInvoice ? { tone: 'amber', icon: 'hourglass_top', title: `Waiting for payment: ${formatCurrency(money.owing, cur)}`, sub: `${formatCurrency(money.paid, cur)} paid of ${formatCurrency(money.value, cur)}`, action: { label: 'Record payment', href: `/dashboard/money/invoices/${owingInvoice.id}?pay=1` } }
    : money.toInvoice > 0.01 ? { tone: 'blue', icon: 'receipt_long', title: `Next: invoice the rest, ${formatCurrency(money.toInvoice, cur)}`, sub: `${formatCurrency(money.paid, cur)} paid of ${formatCurrency(money.value, cur)}`, action: { label: 'Create invoice', onClick: startInvoice } }
    : { tone: 'green', icon: 'check_circle', title: 'All paid', sub: `${formatCurrency(money.paid, cur)} received` }
  const toneCls = {
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    blue: 'bg-blue-50 text-[#2563EB] dark:bg-blue-950/40 dark:text-blue-300',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  }
  const btnCls = 'h-9 px-4 rounded-[10px] bg-[#2563EB] text-white text-[13px] font-semibold hover:bg-[#1D4ED8] disabled:opacity-60 inline-flex items-center justify-center whitespace-nowrap'
  const chip = 'inline-flex items-center gap-1 h-7 px-2.5 rounded-full border text-[12px] whitespace-nowrap'

  // Team only: one profit line (actual once costs are in, otherwise from the quote's cost prices).
  const hasActual = profit.actualCost > 0
  const profitAmt = hasActual ? profit.actualProfit : profit.quotedSell - profit.quotedCost
  const profitPct = hasActual ? profit.actualMargin : profit.quotedMargin
  const showProfit = hasActual || profit.quotedCost > 0
  const subtotal = Number(quote.subtotal) || 0
  const anyCost = counted.some(l => Number(l.cost_price) > 0)
  const teamCol = anyCost ? 'hidden sm:table-cell' : 'hidden'
  const vat = Number(quote.vat_amount) || 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 py-4 space-y-3">
        {/* ── Header ── */}
        <div className="flex items-center gap-2.5">
          <Link href="/dashboard/money/orders" className="w-9 h-9 rounded-[9px] border border-divider text-text-primary flex items-center justify-center shrink-0 hover:bg-surface-elevated" aria-label="Back to orders">
            <span className="material-icons !text-[20px]">chevron_left</span>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[17px] sm:text-[18px] font-semibold text-text-primary">Order {quote.quote_number ?? ''}</h1>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
            </div>
            <p className="text-[12.5px] text-text-secondary truncate">
              {[quote.clients?.name, quote.title].filter(Boolean).join(' · ')}
              {link && <> · <Link href={link.href} className="text-primary hover:underline">{link.text}</Link></>}
            </p>
          </div>
          <Link href={`/dashboard/money/quotes/${quote.id}?view=quote&step=4`} className="h-9 px-3 rounded-[10px] border border-divider bg-surface text-[12.5px] font-semibold text-text-primary hover:bg-surface-elevated inline-flex items-center gap-1 shrink-0">
            <span className="material-icons !text-[16px] text-text-secondary">description</span><span className="hidden sm:inline">View the quote</span><span className="sm:hidden">Quote</span>
          </Link>
        </div>

        {notAccepted && (
          <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900">
            This quote is {label(quote.status)}, not accepted, so it isn&apos;t an order yet.
          </p>
        )}
        {error && <p className="text-[12px] text-error bg-red-50 border border-red-100 rounded-lg px-3 py-2 dark:bg-red-950/40 dark:border-red-900">{error}</p>}
        {note && !error && <p className="text-[12.5px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900" role="status">{note}</p>}

        {/* ── What's next (small) ── */}
        {next && (
          <div className="rounded-xl border border-divider bg-surface px-3 py-2.5 flex items-center gap-3 flex-wrap sm:flex-nowrap">
            <span className={cn('w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0', toneCls[next.tone])}><span className="material-icons !text-[18px]">{next.icon}</span></span>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold text-text-primary leading-tight">{next.title}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[11.5px] text-text-secondary whitespace-nowrap">{next.sub}</span>
                {money.value > 0 && <span className="flex-1 max-w-[180px] h-1.5 rounded-full bg-surface-elevated border border-divider overflow-hidden"><i className="block h-full bg-emerald-500" style={{ width: `${paidPct}%` }} /></span>}
              </div>
            </div>
            {next.action && (next.action.href
              ? <Link href={next.action.href} className={cn(btnCls, 'w-full sm:w-auto')}>{next.action.label}</Link>
              : <button type="button" disabled={!!busy} onClick={next.action.onClick} className={cn(btnCls, 'w-full sm:w-auto')}>{busy === 'invoice' ? 'Opening…' : next.action.label}</button>)}
          </div>
        )}

        {/* ── Done, and small to-dos ── */}
        {!notAccepted && (
          <div className="flex gap-1.5 flex-wrap">
            <span className={cn(chip, 'border-divider bg-surface text-text-primary')}><span className="material-icons !text-[15px] text-emerald-600">check</span>Accepted{quote.accepted_by_name ? ` & signed by ${quote.accepted_by_name}` : ''}{quote.accepted_at ? `, ${fmtDay(quote.accepted_at)}` : ''}</span>
            {sentInvoices.length > 0 && <span className={cn(chip, 'border-divider bg-surface text-text-primary')}><span className="material-icons !text-[15px] text-emerald-600">check</span>{sentInvoices.length === 1 ? 'Invoice sent' : `${sentInvoices.length} invoices sent`}</span>}
            {canProcess && <button type="button" disabled={processing} onClick={() => void runProcessOrder()} className={cn(chip, 'border-[#2563EB]/40 bg-blue-50 text-[#2563EB] font-semibold dark:bg-blue-950/40 dark:text-blue-300')}><span className="material-icons !text-[15px]">local_shipping</span>{processing ? 'Making purchase orders…' : 'To do: process order'}</button>}
            {posToSend.length > 0 && <button type="button" onClick={() => { setTab('buying'); setBuyTab('pos') }} className={cn(chip, 'border-[#2563EB]/40 bg-blue-50 text-[#2563EB] font-semibold dark:bg-blue-950/40 dark:text-blue-300')}><span className="material-icons !text-[15px]">send</span>To do: send {posToSend.length === 1 ? 'the purchase order' : `${posToSend.length} purchase orders`}</button>}
            {toSource > 0 && <span className={cn(chip, 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900')}>{toSource} item{toSource === 1 ? ' needs' : 's need'} a supplier</span>}
            {!link && <>
              <button type="button" disabled={!!busy} onClick={() => void makeJobOrProject('job')} className={cn(chip, 'border-dashed border-divider text-text-secondary hover:text-text-primary')}><span className="material-icons !text-[15px]">add</span>{busy === 'job' ? 'Creating…' : 'Job'}</button>
              <button type="button" disabled={!!busy} onClick={() => void makeJobOrProject('project')} className={cn(chip, 'border-dashed border-divider text-text-secondary hover:text-text-primary')}><span className="material-icons !text-[15px]">add</span>{busy === 'project' ? 'Creating…' : 'Project'}</button>
            </>}
          </div>
        )}

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

        {/* ── Tabs: big and clear, so you know where you're going ── */}
        <div role="tablist" className={cn('grid gap-1.5 p-1.5 rounded-2xl bg-surface-elevated border border-divider', TABS.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
          {TABS.map(t => {
            const on = tab === t.id
            return (
              <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => { setTab(t.id); setNote(null) }}
                className={cn('h-11 rounded-xl flex items-center justify-center gap-1.5 px-2 text-[13px] sm:text-[14px] font-semibold transition-colors min-w-0',
                  on ? 'bg-[#2563EB] text-white shadow-md shadow-blue-600/25' : 'text-text-secondary hover:text-text-primary hover:bg-surface')}>
                <span className="material-icons !text-[18px] hidden sm:inline">{t.icon}</span>
                <span className="truncate sm:hidden">{t.short}</span><span className="truncate hidden sm:inline">{t.label}</span>
                {t.count > 0 && <span className={cn('min-w-[20px] h-5 px-1.5 rounded-full text-[11px] leading-5 text-center', on ? 'bg-white/25 text-white' : 'bg-surface border border-divider text-text-secondary')}>{t.count}</span>}
              </button>
            )
          })}
        </div>

        {/* ── What was sold ── */}
        {tab === 'sold' && (
          <div className="space-y-2">
            <div className="rounded-xl border border-divider bg-surface overflow-hidden">
              <ResponsiveDataView table={
                <table className="w-full">
                  <thead><tr className="bg-surface-elevated border-b border-divider">
                    <th className={`${MONEY_TH} text-left w-full`}>Item</th>
                    <th className={`${MONEY_TH} !text-right`}>Qty</th>
                    <th className={`${MONEY_TH} !text-right`}>Price</th>
                    <th className={`${MONEY_TH} !text-right`}>Total</th>
                    <th className={`${MONEY_TH} !text-right ${teamCol} !text-amber-700 dark:!text-amber-300`} title="Only your team sees this">Cost</th>
                    <th className={`${MONEY_TH} !text-right ${teamCol} !text-amber-700 dark:!text-amber-300`} title="Only your team sees this">Margin</th>
                    {!serviceOnly && <th className={`${MONEY_TH} text-left hidden md:table-cell`}>Supplier · PO</th>}
                    {!serviceOnly && <th className={`${MONEY_TH} text-left hidden sm:table-cell`}>Status</th>}
                  </tr></thead>
                  <tbody>
                    {counted.length === 0 && <tr><td colSpan={8}><Empty text="No lines on this order." /></td></tr>}
                    {counted.map(l => {
                      const x = supply.get(l.id)!
                      const supplierName = x.po ? pos.find(p => p.id === x.po!.id)?.supplier?.name : null
                      const sell = Number(l.subtotal_sell) || 0
                      const qty = Number(l.quantity ?? 0)
                      const costTotal = (Number(l.cost_price) || 0) * qty
                      const m = costTotal > 0 && sell > 0 ? ((sell - costTotal) / sell) * 100 : null
                      return (
                        <tr key={l.id} className="border-b border-divider">
                          <td className={`${MONEY_TD} text-text-primary !whitespace-normal font-medium`}>
                            {l.description || '—'}
                            {!serviceOnly && <span className={cn('sm:hidden ml-1.5 inline-block text-[10px] font-semibold rounded-full px-1.5 py-px align-middle', x.cls)}>{x.label}</span>}
                          </td>
                          <td className={`${MONEY_TD} text-right tabular-nums`}>{qty} {l.unit && l.unit !== 'each' ? l.unit : ''}</td>
                          <td className={`${MONEY_TD} text-right tabular-nums`}>{formatCurrency(Number(l.unit_sell_price) || 0, cur)}</td>
                          <td className={`${MONEY_TD} text-right tabular-nums font-semibold text-text-primary`}>{formatCurrency(sell, cur)}</td>
                          <td className={`${MONEY_TD} text-right tabular-nums text-text-secondary ${teamCol}`}>{costTotal > 0 ? formatCurrency(costTotal, cur) : '—'}</td>
                          <td className={`${MONEY_TD} text-right tabular-nums text-text-secondary ${teamCol}`}>{m != null ? `${Math.round(m)}%` : '—'}</td>
                          {!serviceOnly && <td className={`${MONEY_TD} !whitespace-normal hidden md:table-cell`}>{x.po ? <Link className="text-primary hover:underline" href={`/dashboard/supply/purchase-orders/${x.po.id}`}>{[supplierName, x.po.po_number].filter(Boolean).join(' · ')}</Link> : <span className="text-text-secondary">—</span>}</td>}
                          {!serviceOnly && <td className={`${MONEY_TD} hidden sm:table-cell`}><span className={cn('inline-block text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap', x.cls)}>{x.label}</span></td>}
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    {vat > 0 && <>
                      <tr><td colSpan={3} className={`${MONEY_TD} text-right text-text-secondary`}>Subtotal</td><td className={`${MONEY_TD} text-right tabular-nums`}>{formatCurrency(subtotal, cur)}</td><td colSpan={4} className="hidden sm:table-cell" /></tr>
                      <tr><td colSpan={3} className={`${MONEY_TD} text-right text-text-secondary`}>VAT</td><td className={`${MONEY_TD} text-right tabular-nums`}>{formatCurrency(vat, cur)}</td><td colSpan={4} className="hidden sm:table-cell" /></tr>
                    </>}
                    <tr className="bg-surface-elevated border-t border-divider">
                      <td colSpan={3} className={`${MONEY_TD} text-right font-semibold text-text-primary`}>Total{vat > 0 ? ' incl. VAT' : ''}</td>
                      <td className={`${MONEY_TD} text-right tabular-nums font-bold text-text-primary`}>{formatCurrency(Number(quote.total_amount) || 0, cur)}</td>
                      <td colSpan={4} className="hidden sm:table-cell" />
                    </tr>
                  </tfoot>
                </table>
              } />
            </div>
            {showProfit && (
              <div className="rounded-xl px-3.5 py-2 bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900 flex items-center justify-between gap-2 text-[12.5px] font-semibold">
                <span className="flex items-center gap-1.5 min-w-0"><span className="material-icons !text-[15px]">lock</span><span className="truncate">Your profit{hasActual ? '' : ' (from the quote)'}<span className="hidden sm:inline font-normal opacity-80"> · only your team sees this</span></span></span>
                <span className="tabular-nums whitespace-nowrap">{formatCurrency(profitAmt, cur)}{profitPct != null ? ` · ${Math.round(profitPct)}%` : ''}</span>
              </div>
            )}
            {profit.excluded > 0 && <p className="text-[11.5px] text-text-secondary">{profit.excluded} cost{profit.excluded === 1 ? ' is' : 's are'} in another currency and not counted in the profit.</p>}
          </div>
        )}

        {/* ── Invoices & payments ── */}
        {tab === 'money' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-divider bg-surface overflow-hidden">
              <ResponsiveDataView table={
                <table className="w-full">
                  <thead><tr className="bg-surface-elevated border-b border-divider">
                    <th className={`${MONEY_TH} !text-right`}>Order value</th>
                    <th className={`${MONEY_TH} !text-right`}>Invoiced</th>
                    <th className={`${MONEY_TH} !text-right`}>Paid</th>
                    <th className={`${MONEY_TH} !text-right`}>Owing</th>
                    <th className={`${MONEY_TH} !text-right`}>Still to invoice</th>
                  </tr></thead>
                  <tbody><tr>
                    <td className={`${MONEY_TD} text-right tabular-nums font-semibold`}>{formatCurrency(money.value, cur)}</td>
                    <td className={`${MONEY_TD} text-right tabular-nums`}>{formatCurrency(money.invoiced, cur)}</td>
                    <td className={`${MONEY_TD} text-right tabular-nums text-emerald-700 dark:text-emerald-400`}>{formatCurrency(money.paid, cur)}</td>
                    <td className={cn(MONEY_TD, 'text-right tabular-nums', money.owing > 0.004 ? 'text-error font-semibold' : '')}>{formatCurrency(money.owing, cur)}</td>
                    <td className={`${MONEY_TD} text-right tabular-nums`}>{formatCurrency(money.toInvoice, cur)}</td>
                  </tr></tbody>
                </table>
              } />
            </div>
            <InvoicesList embedded plain quoteId={quote.id} onNew={notAccepted || (money.toInvoice <= 0.01 && !money.hasDraft) ? undefined : () => { startInvoice(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
              newLabel={money.hasDraft ? 'Open draft invoice' : 'Create invoice'} />
            <Section title={`Payments received${payments.length ? ` (${payments.length})` : ''}`}>
              {payments.length === 0 ? <Empty text="No payments yet. Use Record payment when the money comes in." /> : (
                <ResponsiveDataView table={
                  <table className="w-full" style={{ minWidth: 520 }}>
                    <thead><tr className="bg-surface-elevated border-b border-divider">
                      <th className={`${MONEY_TH} text-left`}>Date</th>
                      <th className={`${MONEY_TH} text-left`}>Invoice</th>
                      <th className={`${MONEY_TH} text-left`}>Receipt</th>
                      <th className={`${MONEY_TH} text-left`}>Method · reference</th>
                      <th className={`${MONEY_TH} !text-right`}>Amount</th>
                    </tr></thead>
                    <tbody>
                      {payments.map(p => (
                        <tr key={p.id} className="border-b border-divider last:border-0">
                          <td className={MONEY_TD}>{fmtDay(p.transaction_date ?? p.created_at)}</td>
                          <td className={MONEY_TD}><Link className="text-primary hover:underline" href={`/dashboard/money/invoices/${p.source_id}`}>{invNumber.get(p.source_id) ?? 'Invoice'}</Link></td>
                          <td className={`${MONEY_TD} text-text-secondary`}>{p.receipt_number ?? '—'}</td>
                          <td className={`${MONEY_TD} text-text-secondary`}>{[label(p.payment_method), p.reference_number].filter(v => v && v !== '—').join(' · ') || '—'}</td>
                          <td className={`${MONEY_TD} text-right tabular-nums font-medium text-emerald-700 dark:text-emerald-400`}>{formatCurrency(Number(p.amount) || 0, cur)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                } />
              )}
            </Section>
            {credits.length > 0 && (
              <Section title={`Credit notes (${credits.length})`}>
                <ResponsiveDataView table={
                  <table className="w-full" style={{ minWidth: 520 }}>
                    <thead><tr className="bg-surface-elevated border-b border-divider">
                      <th className={`${MONEY_TH} text-left`}>Credit note</th>
                      <th className={`${MONEY_TH} text-left`}>Invoice</th>
                      <th className={`${MONEY_TH} text-left`}>Date</th>
                      <th className={`${MONEY_TH} text-left`}>Status</th>
                      <th className={`${MONEY_TH} !text-right`}>Amount</th>
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
              </Section>
            )}
          </div>
        )}

        {/* ── Buying in ── */}
        {tab === 'buying' && (
          <div className="space-y-3">
            <div className="flex gap-1.5 overflow-x-auto">
              {BUY_TABS.map(b => (
                <button key={b.id} type="button" onClick={() => setBuyTab(b.id)}
                  className={cn('h-8 px-3 rounded-full border text-[12.5px] font-semibold whitespace-nowrap',
                    buyTab === b.id ? 'border-[#2563EB] bg-blue-50 text-[#2563EB] dark:bg-blue-950/40 dark:text-blue-300' : 'border-divider bg-surface text-text-secondary hover:text-text-primary')}>
                  {b.label}{b.count > 0 ? ` (${b.count})` : ''}
                </button>
              ))}
            </div>
            {buyTab === 'pos' && companyId && (
              <PurchaseOrdersPanel companyId={companyId} quoteId={quote.id} pos={pos} poLines={poLines} sendTo={sendTo} toSource={toSource}
                canProcess={canProcess} processing={processing} onProcess={() => void runProcessOrder()} onChanged={async () => { setNote(null); await load() }} />
            )}
            {buyTab === 'received' && (
              <GoodsReceivedPanel grns={grns} grnLines={grnLines} bills={allBills} pos={pos} onChanged={async () => { setNote(null); await load() }} />
            )}
            {buyTab === 'other' && (
              <>
                <Section title="Prices asked from suppliers (RFQs)" action={<button type="button" onClick={() => void createRfq()} disabled={!!busy} className="btn-outlined h-7 px-2.5 text-[11.5px] disabled:opacity-50">{busy === 'rfq' ? 'Opening…' : 'Ask for prices'}</button>}>
                  {rfqs.length === 0 ? <Empty text="None yet." /> : (
                    <ResponsiveDataView table={
                      <table className="w-full">
                        <thead><tr className="bg-surface-elevated border-b border-divider">
                          <th className={`${MONEY_TH} text-left`}>RFQ</th><th className={`${MONEY_TH} text-left w-full`}>For</th><th className={`${MONEY_TH} text-left`}>Status</th>
                        </tr></thead>
                        <tbody>
                          {rfqs.map(r => (
                            <tr key={r.id} onClick={() => router.push(`/dashboard/supply/rfqs/${r.id}`)} className="border-b border-divider last:border-0 cursor-pointer hover:bg-surface-elevated">
                              <td className={`${MONEY_TD} font-mono`}>{r.rfq_number ?? '—'}</td><td className={`${MONEY_TD} !whitespace-normal`}>{r.title ?? '—'}</td><td className={MONEY_TD}><span className={pill}>{label(r.status)}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    } />
                  )}
                </Section>
                <Section title="Supplier bills">
                  {bills.length === 0 ? <Empty text="No supplier bills for this order's purchase orders yet." /> : (
                    <ResponsiveDataView table={
                      <table className="w-full" style={{ minWidth: 520 }}>
                        <thead><tr className="bg-surface-elevated border-b border-divider">
                          <th className={`${MONEY_TH} text-left`}>Bill</th>
                          <th className={`${MONEY_TH} text-left`}>For PO</th>
                          <th className={`${MONEY_TH} text-left`}>Status</th>
                          <th className={`${MONEY_TH} !text-right`}>Total</th>
                          <th className={`${MONEY_TH} !text-right`}>Still to pay</th>
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
                      <ResponsiveDataView table={
                        <table className="w-full" style={{ minWidth: 480 }}>
                          <thead><tr className="bg-surface-elevated border-b border-divider">
                            <th className={`${MONEY_TH} text-left`}>Contractor</th><th className={`${MONEY_TH} text-left`}>Date</th><th className={`${MONEY_TH} text-left`}>Status</th><th className={`${MONEY_TH} !text-right`}>Amount</th>
                          </tr></thead>
                          <tbody>
                            {payouts.map(p => (
                              <tr key={p.id} className="border-b border-divider last:border-0">
                                <td className={MONEY_TD}>{p.contractor?.name ?? 'Contractor'}{p.remittance_number ? ` · ${p.remittance_number}` : ''}</td>
                                <td className={MONEY_TD}>{fmtDay(p.payout_date)}</td>
                                <td className={MONEY_TD}><span className={pill}>{label(p.payout_status)}</span></td>
                                <td className={`${MONEY_TD} text-right tabular-nums`}>{formatCurrency(Number(p.total_amount) || 0, 'ZAR')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      } />
                    )}
                  </Section>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
