'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { fmtMoney } from '@/lib/finance-calc'
import type { CommercialQuote, CommercialQuoteLine, QuoteCatalogueItem } from '@/types/database'

type ClientRow = { id: string; name: string; email?: string | null }
type EmpRow    = { id: string; name: string; surname: string }

const ITEM_TYPES = ['material','labour','equipment','subcontractor','other'] as const

const STATUS_COLORS: Record<CommercialQuote['status'], string> = {
  draft:           'bg-slate-100 text-slate-700',
  internal_review: 'bg-blue-100 text-blue-700',
  sent:            'bg-amber-100 text-amber-700',
  viewed:          'bg-purple-100 text-purple-700',
  accepted:        'bg-green-100 text-green-700',
  declined:        'bg-red-100 text-red-700',
  expired:         'bg-gray-100 text-gray-500',
}

function calcLine(l: CommercialQuoteLine): CommercialQuoteLine {
  if (l.item_type === 'heading') return { ...l, unit_sell_price: 0, subtotal_cost: 0, subtotal_sell: 0, vat_amount: 0, line_total: 0 }
  const unitSell = l.cost_price * (1 + l.markup_percent / 100)
  const subCost  = l.cost_price * l.quantity
  const subSell  = unitSell * l.quantity
  const vat      = subSell * l.vat_rate
  return { ...l, unit_sell_price: unitSell, subtotal_cost: subCost, subtotal_sell: subSell, vat_amount: vat, line_total: subSell + vat }
}

function blankLine(sort: number): CommercialQuoteLine {
  return {
    id: crypto.randomUUID(), company_id: '', quote_id: '',
    sort_order: sort, section_heading: null, item_type: 'material', catalogue_item_id: null,
    description: '', unit: 'each', quantity: 1, cost_price: 0, markup_percent: 20,
    unit_sell_price: 0, subtotal_cost: 0, subtotal_sell: 0, vat_rate: 0.15,
    vat_amount: 0, line_total: 0, is_optional: false, is_excluded: false,
  }
}

function emptyQuote(companyId: string): CommercialQuote {
  const d = new Date(); d.setDate(d.getDate() + 30)
  return {
    id: '', company_id: companyId, quote_number: null, version: 1,
    client_id: null, deal_id: null, job_id: null, salesperson_id: null,
    title: '', description: null, status: 'draft', currency: 'ZAR',
    subtotal: 0, discount_amount: 0, vat_amount: 0, total_amount: 0,
    cost_total: 0, gross_profit: 0, gross_margin_percent: 0,
    valid_until: d.toISOString().slice(0, 10), payment_terms_days: 30, deposit_required: 0,
    scope_notes: null, exclusions: null, assumptions: null, terms_and_conditions: null,
    internal_notes: null, sent_at: null, viewed_at: null, accepted_at: null,
    declined_at: null, declined_reason: null, created_by: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
}

export function QuoteBuilder({ quoteId, companyId }: { quoteId: string | null; companyId: string }) {
  const router = useRouter()
  const [quote,     setQuote]     = useState<CommercialQuote | null>(null)
  const [lines,     setLines]     = useState<CommercialQuoteLine[]>([])
  const [clients,   setClients]   = useState<ClientRow[]>([])
  const [emps,      setEmps]      = useState<EmpRow[]>([])
  const [catalogue, setCatalogue] = useState<QuoteCatalogueItem[]>([])
  const [tab,       setTab]       = useState<'lines'|'scope'|'summary'>('lines')
  const [saving,    setSaving]    = useState(false)
  const [showCat,   setShowCat]   = useState(false)
  const [showSend,  setShowSend]  = useState(false)
  const [showAcc,   setShowAcc]   = useState(false)
  const [showInv,   setShowInv]   = useState(false)
  const [showMore,  setShowMore]  = useState(false)
  const [sendEmail, setSendEmail] = useState('')
  const [sendSubj,  setSendSubj]  = useState('')
  const [sendMsg,   setSendMsg]   = useState('')
  const [projTitle, setProjTitle] = useState('')
  const [projStart, setProjStart] = useState('')
  const [mgr,       setMgr]       = useState('')
  const [invType,   setInvType]   = useState('standard')
  const [invIssue,  setInvIssue]  = useState(new Date().toISOString().slice(0, 10))
  const [invDue,    setInvDue]    = useState('')
  const [catQ,      setCatQ]      = useState('')
  const [catT,      setCatT]      = useState('')

  const load = useCallback(async () => {
    const sb = createClient()
    const [cRes, eRes, kRes] = await Promise.all([
      sb.from('clients').select('id,name,email').eq('company_id', companyId).eq('is_active', true).order('name').limit(200),
      sb.from('employees').select('id,name,surname').eq('company_id', companyId).eq('is_active', true).order('name').limit(200),
      sb.from('quote_catalogue_items').select('*').eq('company_id', companyId).eq('is_active', true).order('name').limit(500),
    ])
    setClients((cRes.data ?? []) as ClientRow[])
    setEmps((eRes.data ?? []) as EmpRow[])
    setCatalogue((kRes.data ?? []) as QuoteCatalogueItem[])
    if (quoteId) {
      const [qRes, lRes] = await Promise.all([
        sb.from('commercial_quotes').select('*,clients(name)').eq('id', quoteId).eq('company_id', companyId).maybeSingle(),
        sb.from('commercial_quote_lines').select('*').eq('quote_id', quoteId).order('sort_order'),
      ])
      if (qRes.data) setQuote(qRes.data as CommercialQuote)
      if (lRes.data) setLines(lRes.data as CommercialQuoteLine[])
    } else {
      setQuote(emptyQuote(companyId))
    }
  }, [quoteId, companyId])

  useEffect(() => { load() }, [load])

  const activeL   = lines.filter(l => !l.is_excluded && l.item_type !== 'heading')
  const subtotal  = activeL.reduce((s, l) => s + l.subtotal_sell, 0)
  const vatAmt    = activeL.reduce((s, l) => s + l.vat_amount, 0)
  const discount  = quote?.discount_amount ?? 0
  const totalAmt  = subtotal - discount + vatAmt
  const costTotal = activeL.reduce((s, l) => s + l.subtotal_cost, 0)
  const gp        = totalAmt - costTotal
  const gm        = totalAmt > 0 ? (gp / totalAmt) * 100 : 0

  const upd = (i: number, p: Partial<CommercialQuoteLine>) =>
    setLines(prev => { const n = [...prev]; n[i] = calcLine({ ...n[i], ...p }); return n })
  const addLine = () => setLines(prev => [...prev, calcLine(blankLine(prev.length))])
  const addHdr  = () => setLines(prev => [...prev, { ...blankLine(prev.length), item_type: 'heading' as const, description: 'Section Heading' }])
  const delLine = (i: number) => setLines(prev => prev.filter((_, j) => j !== i))
  const move    = (i: number, d: -1 | 1) => setLines(prev => {
    const n = [...prev]; const t = i + d
    if (t < 0 || t >= n.length) return prev
    ;[n[i], n[t]] = [n[t], n[i]]; return n
  })
  const fromCat = (item: QuoteCatalogueItem) => {
    setLines(prev => [...prev, calcLine({ ...blankLine(prev.length), catalogue_item_id: item.id, description: item.name, unit: item.unit, item_type: item.item_type, cost_price: item.cost_price, markup_percent: item.markup_percent, vat_rate: item.vat_rate, quantity: 1 })])
    setShowCat(false)
  }
  const pq = (p: Partial<CommercialQuote>) => setQuote(q => q ? { ...q, ...p } : q)

  async function save() {
    if (!quote) return
    setSaving(true)
    const sb = createClient()
    let qNum = quote.quote_number
    if (!qNum) {
      const { data: n } = await (sb.rpc as any)('generate_quote_number', { p_company_id: companyId })
      qNum = n
    }
    const payload: Record<string, unknown> = {
      company_id: companyId, quote_number: qNum,
      client_id: quote.client_id, title: quote.title || 'Untitled Quote',
      status: quote.status ?? 'draft', valid_until: quote.valid_until,
      payment_terms_days: quote.payment_terms_days ?? 30,
      deposit_required: quote.deposit_required ?? 0,
      salesperson_id: quote.salesperson_id, internal_notes: quote.internal_notes,
      scope_notes: quote.scope_notes, exclusions: quote.exclusions,
      assumptions: quote.assumptions, terms_and_conditions: quote.terms_and_conditions,
      discount_amount: discount, subtotal, vat_amount: vatAmt, total_amount: totalAmt,
      cost_total: costTotal, gross_profit: gp, gross_margin_percent: gm,
      updated_at: new Date().toISOString(),
    }
    if (quote.id) payload.id = quote.id
    const { data: saved } = await sb.from('commercial_quotes').upsert(payload).select().maybeSingle()
    if (saved) {
      const sid = (saved as any).id as string
      await sb.from('commercial_quote_lines').delete().eq('quote_id', sid)
      if (lines.length > 0) {
        await sb.from('commercial_quote_lines').insert(
          lines.map((l, i) => ({ ...l, id: undefined, quote_id: sid, company_id: companyId, sort_order: i }))
        )
      }
      setQuote(saved as CommercialQuote)
      if (!quote.id) router.replace(`/dashboard/money/quotes/${sid}`)
    }
    setSaving(false)
  }

  async function sendQuote() {
    if (!quote?.id) return
    const sb = createClient()
    await sb.from('commercial_quotes').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', quote.id)
    pq({ status: 'sent', sent_at: new Date().toISOString() }); setShowSend(false)
  }
  async function markDeclined() {
    if (!quote?.id) return
    const r = prompt('Decline reason (optional):') ?? ''
    await createClient().from('commercial_quotes').update({ status: 'declined', declined_at: new Date().toISOString(), declined_reason: r || null }).eq('id', quote.id)
    pq({ status: 'declined' }); setShowMore(false)
  }
  async function markAccepted() {
    if (!quote?.id) return
    await createClient().from('commercial_quotes').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', quote.id)
    pq({ status: 'accepted' }); setShowMore(false); setShowAcc(true)
  }
  async function createProject() {
    if (!quote?.id) return
    const sb = createClient()
    const { data: deal } = await sb.from('client_deals').insert({
      company_id: companyId, client_id: quote.client_id, title: projTitle || quote.title,
      status: 'active', offer_amount: totalAmt, budget_amount: totalAmt, estimated_cost: costTotal,
      deposit_required: quote.deposit_required, manager_employee_id: mgr || null, site_start_date: projStart || null,
    }).select('id').maybeSingle()
    if (deal?.id) await sb.from('commercial_quotes').update({ deal_id: deal.id }).eq('id', quote.id)
    setShowAcc(false)
  }
  async function createInvoice() {
    if (!quote?.id) return
    const sb = createClient()
    const { data: inv } = await sb.from('finance_invoices').insert({
      company_id: companyId, client_id: quote.client_id, deal_id: quote.deal_id,
      quote_id: quote.id, invoice_type: invType, issue_date: invIssue, due_date: invDue || null,
      subtotal, vat_amount: vatAmt, total_amount: totalAmt, status: 'draft',
    }).select('id').maybeSingle()
    if (inv?.id) {
      if (activeL.length > 0) {
        await sb.from('finance_invoice_lines').insert(
          activeL.map((l, i) => ({ company_id: companyId, invoice_id: inv.id, description: l.description, unit: l.unit, quantity: l.quantity, unit_price: l.unit_sell_price, subtotal: l.subtotal_sell, vat_rate: l.vat_rate, vat_amount: l.vat_amount, line_total: l.line_total, sort_order: i }))
        )
      }
      setShowInv(false); router.push(`/dashboard/money/invoices/${inv.id}`)
    }
  }

  const cats = catalogue.filter(c => (!catT || c.item_type === catT) && (!catQ || c.name.toLowerCase().includes(catQ.toLowerCase())))
  const sumByType = ITEM_TYPES.map(t => {
    const tL = lines.filter(l => l.item_type === t && !l.is_excluded)
    return { t, cost: tL.reduce((s, l) => s + l.subtotal_cost, 0), sell: tL.reduce((s, l) => s + l.subtotal_sell, 0) }
  }).filter(s => s.cost > 0 || s.sell > 0)

  if (!quote) return <div className="flex items-center justify-center h-full"><p className="text-text-secondary">Loading…</p></div>

  const clientEmail = clients.find(c => c.id === quote.client_id)?.email ?? ''

  return (
    <div className="h-full flex flex-col">
      {/* Topbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-divider bg-surface shrink-0 flex-wrap">
        <button onClick={() => router.push('/dashboard/money/quotes')} className="text-text-secondary hover:text-text-primary text-sm">← Quotes</button>
        <span className="text-text-disabled">/</span>
        <span className="text-sm font-medium text-text-primary">{quote.quote_number ?? 'New Quote'}</span>
        <div className="flex-1" />
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${STATUS_COLORS[quote.status]}`}>{quote.status.replace('_', ' ')}</span>
        <button onClick={save} disabled={saving} className="btn-primary h-8 px-3 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save Draft'}</button>
        <button onClick={() => { setSendEmail(clientEmail); setSendSubj(`Quote ${quote.quote_number ?? ''} – ${quote.title}`); setShowSend(true) }} className="btn-outlined h-8 px-3 text-sm">Send to Client</button>
        <div className="relative">
          <button onClick={() => setShowMore(v => !v)} className="btn-outlined h-8 px-2 text-sm">⋮</button>
          {showMore && (
            <div className="absolute right-0 top-10 z-50 bg-surface-card border border-divider rounded-xl shadow-lg py-1 w-52" onMouseLeave={() => setShowMore(false)}>
              <Mitem onClick={markAccepted}>Mark as Accepted</Mitem>
              <Mitem onClick={markDeclined}>Mark as Declined</Mitem>
              {quote.status === 'accepted' && <Mitem onClick={() => { setShowInv(true); setShowMore(false) }}>Create Invoice</Mitem>}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Header fields */}
        <div className="card p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Client">
            <select value={quote.client_id ?? ''} onChange={e => pq({ client_id: e.target.value || null })} className="form-input">
              <option value="">— Select Client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Title" className="sm:col-span-2">
            <input value={quote.title ?? ''} onChange={e => pq({ title: e.target.value })} placeholder="Quote title" className="form-input" />
          </Field>
          <Field label="Valid Until">
            <input type="date" value={quote.valid_until ?? ''} onChange={e => pq({ valid_until: e.target.value })} className="form-input" />
          </Field>
          <Field label="Payment Terms (days)">
            <input type="number" value={quote.payment_terms_days ?? 30} onChange={e => pq({ payment_terms_days: +e.target.value })} className="form-input" />
          </Field>
          <Field label="Deposit Required (R)">
            <input type="number" step="0.01" value={(quote.deposit_required ?? 0).toFixed(2)} onChange={e => pq({ deposit_required: +e.target.value })} className="form-input" />
          </Field>
          <Field label="Salesperson">
            <select value={quote.salesperson_id ?? ''} onChange={e => pq({ salesperson_id: e.target.value || null })} className="form-input">
              <option value="">— None —</option>
              {emps.map(e => <option key={e.id} value={e.id}>{e.name} {e.surname}</option>)}
            </select>
          </Field>
          <Field label="Internal Notes" className="sm:col-span-2">
            <textarea rows={2} value={quote.internal_notes ?? ''} onChange={e => pq({ internal_notes: e.target.value || null })} className="form-input" placeholder="Internal notes (not visible to client)" />
          </Field>
        </div>

        {/* Tabs */}
        <div className="bg-surface-card border border-divider rounded-xl p-1 flex gap-1">
          {(['lines', 'scope', 'summary'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={tab === t ? { backgroundColor: '#3B82F6', color: '#fff' } : { color: '#6B7280' }}>
              {t === 'lines' ? 'Line Items' : t === 'scope' ? 'Scope & Terms' : 'Summary'}
            </button>
          ))}
        </div>

        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0">

            {/* Lines tab */}
            {tab === 'lines' && (
              <div className="card overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 860 }}>
                  <thead>
                    <tr className="bg-surface-elevated">
                      {['', 'Type', 'Description', 'Unit', 'Qty', 'Cost', 'Mkp%', 'Sell', 'VAT%', 'Total', ''].map((h, i) => (
                        <th key={i} className="data-th text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.id} className="border-b border-divider last:border-0 bg-surface-card hover:bg-surface-elevated">
                        <td className="data-td w-6">
                          <div className="flex flex-col text-[10px] text-text-disabled leading-tight">
                            <button onClick={() => move(i, -1)} disabled={i === 0} className="hover:text-text-primary disabled:opacity-30">▲</button>
                            <button onClick={() => move(i, 1)} disabled={i === lines.length - 1} className="hover:text-text-primary disabled:opacity-30">▼</button>
                          </div>
                        </td>
                        {l.item_type === 'heading' ? (
                          <>
                            <td className="data-td"><span className="text-[10px] bg-surface-elevated text-text-disabled px-1.5 py-0.5 rounded uppercase">HDG</span></td>
                            <td className="data-td" colSpan={8}>
                              <input value={l.description} onChange={e => upd(i, { description: e.target.value })} className="w-full bg-transparent border-0 outline-none font-semibold text-text-primary" placeholder="Section heading…" />
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="data-td">
                              <select value={l.item_type} onChange={e => upd(i, { item_type: e.target.value as CommercialQuoteLine['item_type'] })} className="text-xs bg-transparent border-0 outline-none text-text-secondary">
                                {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </td>
                            <td className="data-td" style={{ minWidth: 160 }}>
                              <input value={l.description} onChange={e => upd(i, { description: e.target.value })} className="w-full bg-transparent border-0 outline-none text-text-primary" placeholder="Description…" />
                            </td>
                            <td className="data-td"><input value={l.unit} onChange={e => upd(i, { unit: e.target.value })} className="w-12 bg-transparent border-0 outline-none text-text-secondary text-center" /></td>
                            <td className="data-td text-right"><input type="number" value={l.quantity} onChange={e => upd(i, { quantity: +e.target.value })} className="w-14 bg-transparent border-0 outline-none text-right text-text-primary" /></td>
                            <td className="data-td text-right"><input type="number" step="0.01" value={l.cost_price.toFixed(2)} onChange={e => upd(i, { cost_price: +e.target.value })} className="w-20 bg-transparent border-0 outline-none text-right text-text-primary" /></td>
                            <td className="data-td text-right"><input type="number" step="0.1" value={l.markup_percent.toFixed(1)} onChange={e => upd(i, { markup_percent: +e.target.value })} className="w-16 bg-transparent border-0 outline-none text-right text-text-primary" /></td>
                            <td className="data-td text-right text-text-secondary">{fmtMoney(l.unit_sell_price)}</td>
                            <td className="data-td text-right"><input type="number" step="0.1" value={(l.vat_rate * 100).toFixed(1)} onChange={e => upd(i, { vat_rate: +e.target.value / 100 })} className="w-14 bg-transparent border-0 outline-none text-right text-text-primary" /></td>
                            <td className="data-td text-right font-medium text-text-primary">{fmtMoney(l.line_total)}</td>
                          </>
                        )}
                        <td className="data-td"><button onClick={() => delLine(i)} className="text-red-400 hover:text-red-600 px-1">✕</button></td>
                      </tr>
                    ))}
                    {lines.length === 0 && <tr><td colSpan={11} className="data-td text-center text-text-disabled py-8">No line items yet — add one below</td></tr>}
                  </tbody>
                </table>
                <div className="flex gap-2 p-3 border-t border-divider">
                  <button onClick={addLine} className="btn-outlined h-8 px-3 text-sm">+ Add Line</button>
                  <button onClick={addHdr}  className="btn-outlined h-8 px-3 text-sm">+ Add Heading</button>
                  <button onClick={() => setShowCat(true)} className="btn-outlined h-8 px-3 text-sm">📦 From Catalogue</button>
                </div>
              </div>
            )}

            {/* Scope tab */}
            {tab === 'scope' && (
              <div className="card p-4 flex flex-col gap-4">
                {([['scope_notes', 'Scope of Work'], ['exclusions', 'Exclusions'], ['assumptions', 'Assumptions'], ['terms_and_conditions', 'Terms & Conditions']] as [keyof CommercialQuote, string][]).map(([k, lbl]) => (
                  <Field key={k} label={lbl}>
                    <textarea rows={4} value={(quote[k] as string | null) ?? ''} onChange={e => pq({ [k]: e.target.value || null } as Partial<CommercialQuote>)} className="form-input" placeholder={`Enter ${lbl.toLowerCase()}…`} />
                  </Field>
                ))}
              </div>
            )}

            {/* Summary tab */}
            {tab === 'summary' && (
              <div className="card p-4">
                <p className="text-sm font-semibold text-text-primary mb-3">Cost vs Sell by Type</p>
                {sumByType.length === 0 ? <p className="text-sm text-text-disabled">No costs entered yet.</p> : (
                  <table className="w-full">
                    <thead><tr className="bg-surface-elevated"><th className="data-th text-left">Type</th><th className="data-th text-right">Cost</th><th className="data-th text-right">Sell</th><th className="data-th text-right">Margin</th></tr></thead>
                    <tbody>
                      {sumByType.map(s => (
                        <tr key={s.t} className="border-b border-divider last:border-0 bg-surface-card">
                          <td className="data-td capitalize text-text-primary">{s.t}</td>
                          <td className="data-td text-right text-text-secondary">{fmtMoney(s.cost)}</td>
                          <td className="data-td text-right text-text-secondary">{fmtMoney(s.sell)}</td>
                          <td className="data-td text-right text-text-secondary">{s.sell > 0 ? `${(((s.sell - s.cost) / s.sell) * 100).toFixed(1)}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          {/* Totals panel */}
          <div className="w-60 shrink-0 card p-4 flex flex-col gap-2 sticky top-4">
            <p className="text-[11px] text-text-secondary uppercase tracking-wide mb-1">Quote Totals</p>
            <TRow label="Subtotal (excl VAT)" val={fmtMoney(subtotal)} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-text-secondary">Discount</span>
              <div className="flex items-center gap-1">
                <span className="text-xs text-text-disabled">R</span>
                <input type="number" step="0.01" value={discount.toFixed(2)} onChange={e => pq({ discount_amount: +e.target.value })} className="w-24 text-right bg-transparent border-b border-divider outline-none text-sm text-text-primary" />
              </div>
            </div>
            <TRow label="VAT" val={fmtMoney(vatAmt)} />
            <div className="border-t border-divider pt-2"><TRow label="TOTAL" val={fmtMoney(totalAmt)} bold /></div>
            <div className="border-t border-divider pt-2 flex flex-col gap-1">
              <TRow label="Cost Total"   val={fmtMoney(costTotal)} dim />
              <TRow label="Gross Profit" val={fmtMoney(gp)} dim />
              <TRow label="Gross Margin" val={`${gm.toFixed(1)}%`} dim />
            </div>
          </div>
        </div>
      </div>

      {/* Catalogue Modal */}
      {showCat && (
        <Modal title="Add from Catalogue" onClose={() => setShowCat(false)}>
          <div className="flex gap-2 mb-3">
            <input value={catQ} onChange={e => setCatQ(e.target.value)} placeholder="Search…" className="form-input flex-1" />
            <select value={catT} onChange={e => setCatT(e.target.value)} className="form-input w-36">
              <option value="">All types</option>
              {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="overflow-y-auto max-h-80 flex flex-col gap-1">
            {cats.map(c => (
              <button key={c.id} onClick={() => fromCat(c)} className="text-left px-3 py-2 rounded-lg hover:bg-surface-elevated border border-divider">
                <div className="flex justify-between"><span className="text-sm font-medium text-text-primary">{c.name}</span><span className="text-xs text-text-disabled">{c.item_type}</span></div>
                <div className="text-xs text-text-secondary mt-0.5">Cost: {fmtMoney(c.cost_price)} · Sell: {fmtMoney(c.sell_price)} · {c.unit}</div>
              </button>
            ))}
            {cats.length === 0 && <p className="text-sm text-text-disabled text-center py-4">No items match</p>}
          </div>
        </Modal>
      )}

      {/* Send Modal */}
      {showSend && (
        <Modal title="Send Quote to Client" onClose={() => setShowSend(false)}>
          <div className="flex flex-col gap-3">
            <Field label="Recipient Email"><input value={sendEmail} onChange={e => setSendEmail(e.target.value)} className="form-input" /></Field>
            <Field label="Subject"><input value={sendSubj} onChange={e => setSendSubj(e.target.value)} className="form-input" /></Field>
            <Field label="Message"><textarea rows={3} value={sendMsg} onChange={e => setSendMsg(e.target.value)} className="form-input" placeholder="Add a personal message…" /></Field>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setShowSend(false)} className="btn-outlined h-9 px-4 text-sm">Cancel</button>
              <button onClick={sendQuote} className="btn-primary h-9 px-4 text-sm">Send Quote</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Accept → Project Modal */}
      {showAcc && (
        <Modal title="Create Project from Quote" onClose={() => setShowAcc(false)}>
          <div className="flex flex-col gap-3">
            <Field label="Project Title"><input value={projTitle} onChange={e => setProjTitle(e.target.value)} placeholder={quote.title} className="form-input" /></Field>
            <Field label="Site Start Date"><input type="date" value={projStart} onChange={e => setProjStart(e.target.value)} className="form-input" /></Field>
            <Field label="Project Manager">
              <select value={mgr} onChange={e => setMgr(e.target.value)} className="form-input">
                <option value="">— None —</option>
                {emps.map(e => <option key={e.id} value={e.id}>{e.name} {e.surname}</option>)}
              </select>
            </Field>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setShowAcc(false)} className="btn-outlined h-9 px-4 text-sm">Skip</button>
              <button onClick={createProject} className="btn-primary h-9 px-4 text-sm">Create Project</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Invoice Modal */}
      {showInv && (
        <Modal title="Create Invoice from Quote" onClose={() => setShowInv(false)}>
          <div className="flex flex-col gap-3">
            <Field label="Invoice Type">
              <select value={invType} onChange={e => setInvType(e.target.value)} className="form-input">
                {['standard', 'deposit', 'progress', 'final'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Issue Date"><input type="date" value={invIssue} onChange={e => setInvIssue(e.target.value)} className="form-input" /></Field>
              <Field label="Due Date"><input type="date" value={invDue} onChange={e => setInvDue(e.target.value)} className="form-input" /></Field>
            </div>
            <div className="bg-surface-elevated rounded-lg p-3 flex justify-between text-sm">
              <span className="text-text-secondary">Total Amount</span>
              <span className="font-semibold text-text-primary">{fmtMoney(totalAmt)}</span>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setShowInv(false)} className="btn-outlined h-9 px-4 text-sm">Cancel</button>
              <button onClick={createInvoice} className="btn-primary h-9 px-4 text-sm">Create Invoice</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Shared micro-components ─────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface-card border border-divider rounded-2xl shadow-2xl w-full max-w-md mx-4 p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-semibold text-text-primary">{title}</h3>
          <button onClick={onClose} className="text-text-disabled hover:text-text-primary text-xl leading-none">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-[11px] text-text-secondary uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

function TRow({ label, val, bold, dim }: { label: string; val: string; bold?: boolean; dim?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className={`text-sm ${dim ? 'text-text-disabled' : 'text-text-secondary'}`}>{label}</span>
      <span className={`text-sm ${bold ? 'font-bold text-text-primary' : dim ? 'text-text-disabled' : 'text-text-secondary'}`}>{val}</span>
    </div>
  )
}

function Mitem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="w-full text-left px-4 py-2 text-sm hover:bg-surface-elevated text-text-primary">{children}</button>
}
