import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  type Admin, type ContactRec, type XeroToken, ensureContact, getValidXeroToken, pushContact, xero,
} from '../_shared/xero.ts'

/**
 * Works the Xero queue (called every minute by the 'xero-sync' cron, with the vault secret).
 * Each job: client, supplier, invoice, invoice_void, credit_note, payment, po_bill, supplier_bill, supplier_payment.
 * Idempotent: every document is linked to its Xero id (xero_doc_links); before creating anything it looks for
 * the same number in Xero. Failures keep Xero's message and are retried with back-off (1, 5, 15, 60 min, then
 * every 6 hours) — the Settings screen shows them with a "Try again" button.
 */

const MAX_JOBS = 40
const BACKOFF_MIN = [1, 5, 15, 60, 360]

type Conn = {
  company_id: string; sales_account_code: string | null; purchases_account_code: string | null; bank_account_code: string | null
}
type Ctx = { admin: Admin; token: XeroToken; conn: Conn; taxRates?: TaxRate[]; baseCurrency?: string }
type TaxRate = { TaxType: string; Name: string; EffectiveRate: number; Status: string; CanApplyToRevenue?: boolean; CanApplyToExpenses?: boolean }

class Skip extends Error {}   // job not needed (e.g. document dated before go-live): marked 'skipped', not an error

const day = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : new Date().toISOString().slice(0, 10))
const money = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100

async function taxType(ctx: Ctx, rate: number, side: 'sales' | 'purchases'): Promise<string> {
  if (!ctx.taxRates) {
    const r = await xero(ctx.token, '/TaxRates')
    if (!r.ok) throw new Error(r.error ?? 'Could not read VAT rates from Xero')
    ctx.taxRates = (r.data.TaxRates ?? []).filter((t: TaxRate) => t.Status === 'ACTIVE')
  }
  // Rates are stored as fractions (0.15) in most tables but as percentages (15) in some: accept both.
  const pct = rate > 1 ? Math.round(rate * 100) / 100 : Math.round(rate * 10000) / 100
  const fits = ctx.taxRates!.filter(t => Math.abs(Number(t.EffectiveRate) - pct) < 0.001
    && (side === 'sales' ? t.CanApplyToRevenue !== false : t.CanApplyToExpenses !== false))
  if (pct === 0) {
    const pick = fits.find(t => /ZERO/i.test(t.TaxType)) ?? fits.find(t => /NONE|EXEMPT/i.test(t.TaxType)) ?? fits[0]
    if (pick) return pick.TaxType
    return 'NONE'
  }
  const std = fits.find(t => (side === 'sales' ? /^OUTPUT/ : /^INPUT/).test(t.TaxType) && !/CAPITAL|IMPORT/i.test(t.Name)) ?? fits[0]
  if (!std) {
    const have = ctx.taxRates!.filter(t => side === 'sales' ? t.CanApplyToRevenue !== false : t.CanApplyToExpenses !== false)
      .map(t => `${t.Name} ${Number(t.EffectiveRate)}%`).slice(0, 8).join(', ')
    throw new Error(`Xero has no ${pct}% VAT rate for ${side}. Add it in Xero → Accounting → Advanced → Tax rates.${have ? ` Xero has: ${have}.` : ''}`)
  }
  return std.TaxType
}

/** Send a currency only when it differs from the Xero organisation's own (KaiSync documents are in rand). */
async function currencyFor(ctx: Ctx, code: string | null | undefined): Promise<string | undefined> {
  const c = (code || 'ZAR').toUpperCase()
  if (ctx.baseCurrency === undefined) {
    const r = await xero(ctx.token, '/Organisation')
    ctx.baseCurrency = r.ok ? String(r.data.Organisations?.[0]?.BaseCurrency ?? '') : ''
  }
  return ctx.baseCurrency && ctx.baseCurrency.toUpperCase() === c ? undefined : c
}

/** Xero's CurrencyRate is "1 unit of the organisation's currency = X of the document's". KaiSync keeps the opposite
 *  (1 unit of the document's currency = exchange_rate of the company's). Send the owner's own rate; keep Xero's otherwise. */
function rateForXero(doc: { exchange_rate?: number | null; rate_source?: string | null }): { CurrencyRate?: number } {
  return doc.rate_source === 'manual' && Number(doc.exchange_rate) > 0 ? { CurrencyRate: Math.round((1 / Number(doc.exchange_rate)) * 1e8) / 1e8 } : {}
}
async function keepXeroRate(ctx: Ctx, table: string, id: string, doc: { rate_source?: string | null }, xeroRate: unknown) {
  const r = Number(xeroRate)
  if (doc.rate_source === 'manual' || !(r > 0) || Math.abs(r - 1) < 1e-9) return
  await ctx.admin.from(table).update({ exchange_rate: Math.round((1 / r) * 1e8) / 1e8, rate_source: 'xero' }).eq('id', id)
}

async function docLink(ctx: Ctx, entity: string, recordId: string) {
  const { data } = await ctx.admin.from('xero_doc_links').select('xero_id, xero_number, xero_status')
    .eq('company_id', ctx.conn.company_id).eq('entity', entity).eq('record_id', recordId).maybeSingle()
  return data as { xero_id: string; xero_number: string | null; xero_status: string | null } | null
}
async function saveDocLink(ctx: Ctx, entity: string, recordId: string, xeroId: string, number: string | null, status: string | null) {
  await ctx.admin.from('xero_doc_links').upsert({
    company_id: ctx.conn.company_id, entity, record_id: recordId, xero_id: xeroId, xero_number: number, xero_status: status,
    last_synced_at: new Date().toISOString(),
  }, { onConflict: 'company_id,entity,record_id' })
}
/** The bank account for payments: saved as a Xero code, or as the AccountID when the bank account has no code. */
function bankAccount(ctx: Ctx) {
  const v = need(ctx.conn.bank_account_code, 'bank')
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v) ? { AccountID: v } : { Code: v }
}
function need(v: string | null, what: string) {
  if (!v) throw new Error(`Choose the Xero ${what} account in Settings → Integrations → Xero.`)
  return v
}

// ── Contacts ──
async function syncContact(ctx: Ctx, kind: 'client' | 'contractor', id: string) {
  const { data: c } = kind === 'client'
    ? await ctx.admin.from('clients').select('id, name, email, phone, address').eq('id', id).maybeSingle()
    : await ctx.admin.from('contractors').select('id, name, email, phone, address, vat_number').eq('id', id).maybeSingle()
  if (!c) throw new Skip('Deleted in KaiSync')
  const { data: link } = await ctx.admin.from('xero_contact_links').select('xero_contact_id')
    .eq('company_id', ctx.conn.company_id).eq('record_type', kind).eq('record_id', id).maybeSingle()
  const r = await pushContact(ctx.admin, ctx.token, ctx.conn.company_id, kind, c as ContactRec, link?.xero_contact_id ?? null)
  if (!r.ok) throw new Error(r.error)
}

// ── Sales invoices ──
async function xeroInvoiceByNumber(ctx: Ctx, number: string) {
  const r = await xero(ctx.token, `/Invoices?InvoiceNumbers=${encodeURIComponent(number)}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID,VOIDED`)
  return r.ok ? (r.data.Invoices?.[0] ?? null) : null
}

async function syncInvoice(ctx: Ctx, id: string) {
  const { data: inv } = await ctx.admin.from('finance_invoices').select('*').eq('id', id).maybeSingle()
  if (!inv) throw new Skip('Deleted in KaiSync')
  if (['draft', 'cancelled', 'voided'].includes(inv.status)) throw new Skip(`Invoice is ${inv.status}`)
  if (!inv.client_id) throw new Error('This invoice has no client, so Xero cannot take it.')
  const { data: lines } = await ctx.admin.from('finance_invoice_lines').select('*').eq('invoice_id', id).order('line_no')
  const contactId = await ensureContact(ctx.admin, ctx.token, ctx.conn.company_id, 'client', inv.client_id)
  const sales = need(ctx.conn.sales_account_code, 'sales')

  const items = []
  for (const l of lines ?? []) {
    const rate = inv.tax_type === 'no_vat' || l.tax_type === 'no_vat' ? 0 : Number(l.vat_rate ?? inv.vat_rate ?? 0)
    items.push({
      Description: (l.description ?? '').slice(0, 4000) || 'Item',
      Quantity: Number(l.quantity ?? 1), UnitAmount: Number(l.unit_price ?? 0),
      ...(Number(l.discount_amount) > 0 ? { DiscountAmount: money(l.discount_amount) }
        : Number(l.discount_percent) > 0 ? { DiscountRate: Number(l.discount_percent) } : {}),
      AccountCode: sales, TaxType: await taxType(ctx, rate, 'sales'),
    })
  }
  if (!items.length) items.push({ Description: `Invoice ${inv.invoice_number}`, Quantity: 1, UnitAmount: money(inv.subtotal ?? inv.total_amount), AccountCode: sales, TaxType: await taxType(ctx, Number(inv.vat_rate ?? 0), 'sales') })

  let link = await docLink(ctx, 'invoice', id)
  if (!link && inv.invoice_number) {
    const existing = await xeroInvoiceByNumber(ctx, inv.invoice_number)
    if (existing?.InvoiceID) link = { xero_id: existing.InvoiceID, xero_number: existing.InvoiceNumber, xero_status: existing.Status }
  }
  if (link && ['PAID', 'VOIDED'].includes(link.xero_status ?? '')) {
    await saveDocLink(ctx, 'invoice', id, link.xero_id, link.xero_number, link.xero_status)
    return  // already final in Xero: leave it alone
  }
  if (link) {
    // Xero won't take new lines once payments or credits are applied: only check the total then.
    const cur = await xero(ctx.token, `/Invoices/${link.xero_id}`)
    const xi = cur.ok ? cur.data.Invoices?.[0] : null
    if (xi && money(xi.AmountPaid) + money(xi.AmountCredited) > 0) {
      await saveDocLink(ctx, 'invoice', id, link.xero_id, xi.InvoiceNumber ?? link.xero_number, xi.Status)
      if (Math.abs(money(xi.Total) - money(inv.total_amount)) > 0.05) {
        throw new Error(`${inv.invoice_number} already has payments in Xero, so it can't be changed from KaiSync. Xero's total is ${inv.currency || 'ZAR'} ${money(xi.Total)}, KaiSync's is ${inv.currency || 'ZAR'} ${money(inv.total_amount)}: adjust it in Xero (or issue a credit note).`)
      }
      return
    }
  }
  const payload = {
    ...(link ? { InvoiceID: link.xero_id } : {}),
    Type: 'ACCREC', Contact: { ContactID: contactId }, InvoiceNumber: inv.invoice_number,
    Date: day(inv.issue_date ?? inv.created_at), DueDate: day(inv.due_date ?? inv.issue_date ?? inv.created_at),
    LineAmountTypes: inv.is_vat_inclusive ? 'Inclusive' : 'Exclusive', Status: 'AUTHORISED',
    CurrencyCode: await currencyFor(ctx, inv.currency), ...rateForXero(inv), LineItems: items,
  }
  const r = await xero(ctx.token, '/Invoices', { method: 'POST', body: JSON.stringify({ Invoices: [payload] }) })
  const x = r.ok ? r.data.Invoices?.[0] : null
  if (!x?.InvoiceID) throw new Error(r.error ?? 'Xero did not return the invoice')
  await saveDocLink(ctx, 'invoice', id, x.InvoiceID, x.InvoiceNumber, x.Status)
  await keepXeroRate(ctx, 'finance_invoices', id, inv, x.CurrencyRate)
  if (Math.abs(money(x.Total) - money(inv.total_amount)) > 0.05) {
    throw new Error(`Sent, but Xero's total (${inv.currency || 'ZAR'} ${money(x.Total)}) differs from KaiSync's (${inv.currency || 'ZAR'} ${money(inv.total_amount)}). Check the VAT rates on the lines.`)
  }
}

async function voidInvoice(ctx: Ctx, id: string) {
  const link = await docLink(ctx, 'invoice', id)
  if (!link) throw new Skip('Never sent to Xero')
  const r = await xero(ctx.token, `/Invoices/${link.xero_id}`, { method: 'POST', body: JSON.stringify({ Invoices: [{ InvoiceID: link.xero_id, Status: 'VOIDED' }] }) })
  if (!r.ok) throw new Error(`Could not void it in Xero: ${r.error}. If it has payments in Xero, remove them there first.`)
  await saveDocLink(ctx, 'invoice', id, link.xero_id, link.xero_number, 'VOIDED')
}

// ── Credit notes ──
async function syncCreditNote(ctx: Ctx, id: string) {
  const { data: cn } = await ctx.admin.from('credit_notes').select('*').eq('id', id).maybeSingle()
  if (!cn) throw new Skip('Deleted in KaiSync')
  if (cn.status !== 'approved') throw new Skip(`Credit note is ${cn.status}`)
  if (!cn.client_id) throw new Error('This credit note has no client.')
  const { data: lines } = await ctx.admin.from('credit_note_lines').select('*').eq('credit_note_id', id).order('created_at')
  const contactId = await ensureContact(ctx.admin, ctx.token, ctx.conn.company_id, 'client', cn.client_id)
  const sales = need(ctx.conn.sales_account_code, 'sales')
  const items = []
  for (const l of lines ?? []) items.push({ Description: l.description || 'Credit', Quantity: Number(l.quantity ?? 1), UnitAmount: Number(l.unit_price ?? 0), AccountCode: sales, TaxType: await taxType(ctx, Number(l.vat_rate ?? 0), 'sales') })
  if (!items.length) items.push({ Description: cn.reason_notes || 'Credit', Quantity: 1, UnitAmount: money(cn.subtotal ?? cn.total_amount), AccountCode: sales, TaxType: await taxType(ctx, Number(cn.subtotal) > 0 ? money(cn.vat_amount) / money(cn.subtotal) : 0, 'sales') })

  let link = await docLink(ctx, 'credit_note', id)
  if (!link) {
    const r = await xero(ctx.token, '/CreditNotes', { method: 'POST', body: JSON.stringify({ CreditNotes: [{
      Type: 'ACCRECCREDIT', Contact: { ContactID: contactId }, CreditNoteNumber: cn.credit_note_number, Date: day(cn.issue_date ?? cn.created_at),
      LineAmountTypes: 'Exclusive', Status: 'AUTHORISED', LineItems: items, Reference: cn.reason_code ?? undefined,
      CurrencyCode: await currencyFor(ctx, cn.currency), ...rateForXero(cn),
    }] }) })
    const x = r.ok ? r.data.CreditNotes?.[0] : null
    if (!x?.CreditNoteID) throw new Error(r.error ?? 'Xero did not return the credit note')
    await saveDocLink(ctx, 'credit_note', id, x.CreditNoteID, x.CreditNoteNumber, x.Status)
    await keepXeroRate(ctx, 'credit_notes', id, cn, x.CurrencyRate)
    link = { xero_id: x.CreditNoteID, xero_number: x.CreditNoteNumber, xero_status: x.Status }
  }
  // Allocate it to its invoice (only once, and never more than Xero says is still owed).
  if (cn.invoice_id && link.xero_status !== 'ALLOCATED') {
    const invLink = await docLink(ctx, 'invoice', cn.invoice_id)
    if (!invLink) {
      // Invoice from before go-live: leave the credit for the accountant to allocate. Otherwise wait for it.
      const { data: inv } = await ctx.admin.from('finance_invoices').select('invoice_number, issue_date, created_at, status').eq('id', cn.invoice_id).maybeSingle()
      const { data: c } = await ctx.admin.from('xero_connections').select('sync_from').eq('company_id', ctx.conn.company_id).maybeSingle()
      if (!inv || ['draft', 'cancelled', 'voided'].includes(inv.status) || (c?.sync_from && day(inv.issue_date ?? inv.created_at) < c.sync_from)) return
      throw new Error(`Credit note is in Xero; it will be allocated to ${inv.invoice_number ?? 'its invoice'} as soon as that invoice reaches Xero.`)
    }
    const xi = await xero(ctx.token, `/Invoices/${invLink.xero_id}`)
    const owed = money(xi.ok ? xi.data.Invoices?.[0]?.AmountDue : 0)
    const amount = Math.min(money(cn.applied_amount) > 0 ? money(cn.applied_amount) : money(cn.total_amount), owed)
    if (amount > 0) {
      const a = await xero(ctx.token, `/CreditNotes/${link.xero_id}/Allocations`, { method: 'PUT', body: JSON.stringify({ Allocations: [{ Amount: amount, Invoice: { InvoiceID: invLink.xero_id }, Date: day(cn.issue_date ?? cn.created_at) }] }) })
      if (!a.ok) throw new Error(`Credit note sent, but could not allocate it to the invoice: ${a.error}`)
    }
    await saveDocLink(ctx, 'credit_note', id, link.xero_id, link.xero_number, 'ALLOCATED')
  }
}

// ── Payments received ──
async function syncPayment(ctx: Ctx, ledgerId: string) {
  if (await docLink(ctx, 'payment', ledgerId)) return
  const { data: p } = await ctx.admin.from('customer_ledger_entries').select('*').eq('id', ledgerId).maybeSingle()
  if (!p) throw new Skip('Deleted in KaiSync')
  let invLink = await docLink(ctx, 'invoice', p.source_id)
  if (!invLink) {
    const { data: inv } = await ctx.admin.from('finance_invoices').select('issue_date, created_at').eq('id', p.source_id).maybeSingle()
    const { data: c } = await ctx.admin.from('xero_connections').select('sync_from').eq('company_id', ctx.conn.company_id).maybeSingle()
    if (inv && c?.sync_from && day(inv.issue_date ?? inv.created_at) < c.sync_from) throw new Skip('Invoice is from before Xero sync started')
    await syncInvoice(ctx, p.source_id)
    invLink = await docLink(ctx, 'invoice', p.source_id)
    if (!invLink) throw new Error('The invoice is not in Xero yet.')
  }
  const r = await xero(ctx.token, '/Payments', { method: 'PUT', body: JSON.stringify({ Payments: [{
    Invoice: { InvoiceID: invLink.xero_id }, Account: bankAccount(ctx),
    Date: day(p.entry_date), Amount: money(p.credit), Reference: (p.description ?? p.reference_number ?? '').slice(0, 255) || undefined,
  }] }) })
  const x = r.ok ? r.data.Payments?.[0] : null
  if (!x?.PaymentID) throw new Error(r.error ?? 'Xero did not return the payment')
  await saveDocLink(ctx, 'payment', ledgerId, x.PaymentID, null, x.Status)
}

// ── Bills: PO fully received, and supplier invoices ──
async function pushBill(ctx: Ctx, opts: { billId?: string; supplierId: string; number: string; reference: string; date: string; due?: string | null; currency?: string | null; rate?: { CurrencyRate?: number };
  status: 'DRAFT' | 'AUTHORISED'; inclusive: boolean; lines: Array<{ description: string; qty: number; price: number; rate: number }> }) {
  const contactId = await ensureContact(ctx.admin, ctx.token, ctx.conn.company_id, 'contractor', opts.supplierId)
  const purchases = need(ctx.conn.purchases_account_code, 'purchases')
  const items = []
  for (const l of opts.lines) items.push({ Description: l.description || 'Item', Quantity: l.qty, UnitAmount: l.price, AccountCode: purchases, TaxType: await taxType(ctx, l.rate, 'purchases') })
  const r = await xero(ctx.token, '/Invoices', { method: 'POST', body: JSON.stringify({ Invoices: [{
    ...(opts.billId ? { InvoiceID: opts.billId } : {}),
    Type: 'ACCPAY', Contact: { ContactID: contactId }, InvoiceNumber: opts.number, Reference: opts.reference,
    Date: opts.date, DueDate: opts.due ?? opts.date, LineAmountTypes: opts.inclusive ? 'Inclusive' : 'Exclusive', Status: opts.status, LineItems: items,
    CurrencyCode: await currencyFor(ctx, opts.currency), ...(opts.rate ?? {}),
  }] }) })
  const x = r.ok ? r.data.Invoices?.[0] : null
  if (!x?.InvoiceID) throw new Error(r.error ?? 'Xero did not return the bill')
  return x as { InvoiceID: string; InvoiceNumber: string; Status: string; CurrencyRate?: number }
}

async function syncPoBill(ctx: Ctx, poId: string) {
  const { data: po } = await ctx.admin.from('purchase_orders').select('*').eq('id', poId).maybeSingle()
  if (!po) throw new Skip('Deleted in KaiSync')
  if (!po.supplier_id) throw new Error('This purchase order has no supplier.')
  const existing = await docLink(ctx, 'po_bill', poId)
  if (existing) return  // one bill per PO; supplier invoices update it
  const { data: lines } = await ctx.admin.from('purchase_order_lines').select('*').eq('po_id', poId).order('sort_order')
  const x = await pushBill(ctx, {
    supplierId: po.supplier_id, number: po.po_number, reference: `PO ${po.po_number}`, currency: po.currency, rate: rateForXero(po),
    date: day(po.actual_delivery_date ?? new Date().toISOString()), due: null, status: 'DRAFT', inclusive: false,
    lines: (lines ?? []).map(l => ({ description: l.description, qty: Number(l.quantity_received ?? l.quantity_ordered ?? 0), price: Number(l.unit_price ?? 0), rate: Number(l.vat_rate ?? 0) })),
  })
  await saveDocLink(ctx, 'po_bill', poId, x.InvoiceID, x.InvoiceNumber, x.Status)
  await keepXeroRate(ctx, 'purchase_orders', poId, po, x.CurrencyRate)
}

async function syncSupplierBill(ctx: Ctx, id: string) {
  const { data: si } = await ctx.admin.from('supplier_invoices').select('*').eq('id', id).maybeSingle()
  if (!si) throw new Skip('Deleted in KaiSync')
  if (si.approval_status !== 'approved' || si.status === 'cancelled') throw new Skip('Not approved')
  if (!si.supplier_id) throw new Error('This supplier invoice has no supplier.')
  const { data: lines } = await ctx.admin.from('supplier_invoice_lines').select('*').eq('invoice_id', id).order('line_no')
  let target = await docLink(ctx, 'supplier_bill', id)
  if (!target && si.po_id) target = await docLink(ctx, 'po_bill', si.po_id)   // update the bill made from the PO
  const rows = (lines ?? []).length
    ? (lines ?? []).map(l => ({ description: l.description, qty: Number(l.quantity ?? 1), price: Number(l.unit_price ?? 0), rate: si.tax_type === 'no_vat' ? 0 : Number(l.vat_rate ?? si.vat_rate ?? 0) }))
    : [{ description: si.notes || `Supplier invoice ${si.invoice_number ?? ''}`, qty: 1, price: money(si.subtotal ?? si.total_amount), rate: si.tax_type === 'no_vat' ? 0 : Number(si.vat_rate ?? 0) }]
  const x = await pushBill(ctx, {
    billId: target?.xero_id, supplierId: si.supplier_id, number: si.invoice_number || si.bill_number || `SI-${id.slice(0, 8)}`,
    reference: si.po_id ? `PO ${(await ctx.admin.from('purchase_orders').select('po_number').eq('id', si.po_id).maybeSingle()).data?.po_number ?? ''}` : (si.bill_number ?? ''),
    date: day(si.approved_at ?? si.created_at), due: si.due_date ? day(si.due_date) : null, status: 'AUTHORISED',
    inclusive: !!si.is_vat_inclusive, lines: rows, currency: si.currency, rate: rateForXero(si),
  })
  await saveDocLink(ctx, 'supplier_bill', id, x.InvoiceID, x.InvoiceNumber, x.Status)
  await keepXeroRate(ctx, 'supplier_invoices', id, si, x.CurrencyRate)
  if (si.po_id) await saveDocLink(ctx, 'po_bill', si.po_id, x.InvoiceID, x.InvoiceNumber, x.Status)
}

async function syncSupplierPayment(ctx: Ctx, id: string) {
  if (await docLink(ctx, 'supplier_payment', id)) return
  const { data: si } = await ctx.admin.from('supplier_invoices').select('*').eq('id', id).maybeSingle()
  if (!si) throw new Skip('Deleted in KaiSync')
  let bill = await docLink(ctx, 'supplier_bill', id)
  if (!bill) { await syncSupplierBill(ctx, id); bill = await docLink(ctx, 'supplier_bill', id) }
  if (!bill) throw new Error('The bill is not in Xero yet.')
  const xb = await xero(ctx.token, `/Invoices/${bill.xero_id}`)
  const due = money(xb.ok ? xb.data.Invoices?.[0]?.AmountDue : 0)
  const amount = Math.min(money(si.amount_paid) > 0 ? money(si.amount_paid) : money(si.total_amount), due)
  if (amount <= 0) { await saveDocLink(ctx, 'supplier_payment', id, bill.xero_id, null, 'ALREADY_PAID'); return }
  const r = await xero(ctx.token, '/Payments', { method: 'PUT', body: JSON.stringify({ Payments: [{
    Invoice: { InvoiceID: bill.xero_id }, Account: bankAccount(ctx),
    Date: day(si.paid_at ?? new Date().toISOString()), Amount: amount, Reference: si.remittance_number ?? undefined,
  }] }) })
  const x = r.ok ? r.data.Payments?.[0] : null
  if (!x?.PaymentID) throw new Error(r.error ?? 'Xero did not return the payment')
  await saveDocLink(ctx, 'supplier_payment', id, x.PaymentID, null, x.Status)
}

async function runJob(ctx: Ctx, entity: string, recordId: string) {
  switch (entity) {
    case 'client': return syncContact(ctx, 'client', recordId)
    case 'supplier': return syncContact(ctx, 'contractor', recordId)
    case 'invoice': return syncInvoice(ctx, recordId)
    case 'invoice_void': return voidInvoice(ctx, recordId)
    case 'credit_note': return syncCreditNote(ctx, recordId)
    case 'payment': return syncPayment(ctx, recordId)
    case 'po_bill': return syncPoBill(ctx, recordId)
    case 'supplier_bill': return syncSupplierBill(ctx, recordId)
    case 'supplier_payment': return syncSupplierPayment(ctx, recordId)
    default: throw new Skip(`Unknown job ${entity}`)
  }
}

// Order inside a company: contacts first, then documents, then payments.
const ORDER: Record<string, number> = { client: 0, supplier: 0, invoice: 1, credit_note: 2, po_bill: 2, supplier_bill: 3, invoice_void: 4, payment: 5, supplier_payment: 6 }

Deno.serve(async (req: Request) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: okSecret } = await admin.rpc('xero_sync_secret_ok', { p_secret: req.headers.get('x-xero-sync-secret') ?? '' })
  if (okSecret !== true) return new Response('forbidden', { status: 403 })

  const { data: jobs } = await admin.from('xero_sync_queue').select('*').in('status', ['pending', 'error'])
    .lte('next_attempt_at', new Date().toISOString()).order('created_at').limit(MAX_JOBS)
  if (!jobs?.length) return Response.json({ ok: true, done: 0 })
  // Claim them so a second run can't do the same job.
  const ids = jobs.map(j => j.id)
  await admin.from('xero_sync_queue').update({ status: 'working', next_attempt_at: new Date().toISOString() }).in('id', ids)

  const byCompany = new Map<string, typeof jobs>()
  for (const j of jobs) byCompany.set(j.company_id, [...(byCompany.get(j.company_id) ?? []), j])
  let done = 0, failed = 0, skipped = 0

  for (const [companyId, list] of byCompany) {
    const { data: conn } = await admin.from('xero_connections').select('company_id, sales_account_code, purchases_account_code, bank_account_code, is_active')
      .eq('company_id', companyId).maybeSingle()
    const token = conn && conn.is_active !== false ? await getValidXeroToken(admin, companyId) : null
    if (!token || !conn) {
      for (const j of list) {
        await admin.from('xero_sync_queue').update({ status: 'error', attempts: j.attempts + 1, last_error: 'Xero is not connected (or the connection expired). Reconnect Xero in Settings → Integrations.',
          next_attempt_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() }).eq('id', j.id)
        failed++
      }
      continue
    }
    const ctx: Ctx = { admin, token, conn: conn as Conn }
    list.sort((a, b) => (ORDER[a.entity] ?? 9) - (ORDER[b.entity] ?? 9) || a.created_at.localeCompare(b.created_at))
    for (const j of list) {
      try {
        await runJob(ctx, j.entity, j.record_id)
        await admin.from('xero_sync_queue').update({ status: 'done', last_error: null, done_at: new Date().toISOString(), attempts: j.attempts + 1 }).eq('id', j.id)
        done++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (e instanceof Skip) {
          await admin.from('xero_sync_queue').update({ status: 'skipped', last_error: msg, done_at: new Date().toISOString() }).eq('id', j.id)
          skipped++
        } else {
          const n = j.attempts + 1
          const wait = BACKOFF_MIN[Math.min(n - 1, BACKOFF_MIN.length - 1)]
          await admin.from('xero_sync_queue').update({ status: 'error', attempts: n, last_error: msg.slice(0, 1000),
            next_attempt_at: new Date(Date.now() + wait * 60 * 1000).toISOString() }).eq('id', j.id)
          failed++
        }
      }
    }
  }
  return Response.json({ ok: true, done, failed, skipped })
})
