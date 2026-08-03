import type { SupabaseClient } from '@supabase/supabase-js'
import {
  balanceDue,
  calculateLine,
  calculateVatExclusive,
  calculateVatInclusive,
  resolvePaymentState,
  roundFinancial,
  summariseLines,
  type TaxType,
} from '@/lib/finance-calc'

export async function logFinanceAudit(
  supabase: SupabaseClient,
  args: {
    companyId: string
    entityType: string
    entityId: string | null
    action: string
    amount: number
    actorId: string | null
    actorName: string | null
    note?: string | null
  },
) {
  await supabase.from('finance_audit_log').insert({
    company_id: args.companyId,
    entity_type: args.entityType,
    entity_id: args.entityId,
    action: args.action,
    actor_id: args.actorId,
    actor_name: args.actorName,
    amount: args.amount,
    note: args.note ?? null,
  })
}

export async function addFinanceTransaction(
  supabase: SupabaseClient,
  args: {
    companyId: string
    transactionType: string
    direction: 'incoming' | 'outgoing'
    sourceTable: string
    sourceId: string
    referenceNumber?: string | null
    amount: number
    paymentMethod?: string | null
    createdBy?: string | null
  },
) {
  await supabase.from('finance_transactions').insert({
    company_id: args.companyId,
    transaction_type: args.transactionType,
    direction: args.direction,
    source_table: args.sourceTable,
    source_id: args.sourceId,
    reference_number: args.referenceNumber ?? null,
    amount: args.amount,
    total_amount: args.amount,
    transaction_date: new Date().toISOString().slice(0, 10),
    payment_method: args.paymentMethod ?? null,
    created_by: args.createdBy ?? null,
  })
}

export function computeInvoiceTotals(input: {
  lines: { quantity: number; unit_price: number; vat_rate: number; is_vat_inclusive: boolean; tax_type?: string }[]
  headerVatInclusive?: boolean
  headerVatRate?: number
  headerAmount?: number
}) {
  if (input.lines.length > 0) {
    const results = input.lines.map(l =>
      calculateLine(
        Number(l.quantity),
        Number(l.unit_price),
        Number(l.vat_rate),
        Boolean(l.is_vat_inclusive),
        (l.tax_type as TaxType) || 'standard',
      ),
    )
    return summariseLines(results)
  }
  const rate = input.headerVatRate ?? 0.15
  const amount = input.headerAmount ?? 0
  return input.headerVatInclusive
    ? calculateVatInclusive(amount, rate)
    : calculateVatExclusive(amount, rate)
}

export async function approveSupplierInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  actorId: string | null,
  actorName: string | null,
) {
  const { data: inv } = await supabase.from('supplier_invoices').select('*').eq('id', invoiceId).maybeSingle()
  if (!inv) throw new Error('Supplier invoice not found')
  const status = inv.status === 'received' ? 'approved' : inv.status
  await supabase.from('supplier_invoices').update({
    approval_status: 'approved',
    approved_by: actorId,
    approved_at: new Date().toISOString(),
    status,
  }).eq('id', invoiceId)
  await logFinanceAudit(supabase, {
    companyId: inv.company_id,
    entityType: 'supplier_invoice',
    entityId: invoiceId,
    action: 'approved',
    amount: Number(inv.total_amount),
    actorId,
    actorName,
  })
}

export async function rejectSupplierInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  actorId: string | null,
  actorName: string | null,
  note?: string,
) {
  const { data: inv } = await supabase.from('supplier_invoices').select('*').eq('id', invoiceId).maybeSingle()
  if (!inv) throw new Error('Supplier invoice not found')
  await supabase.from('supplier_invoices').update({
    approval_status: 'rejected',
    approved_by: actorId,
    approved_at: new Date().toISOString(),
  }).eq('id', invoiceId)
  await logFinanceAudit(supabase, {
    companyId: inv.company_id,
    entityType: 'supplier_invoice',
    entityId: invoiceId,
    action: 'rejected',
    amount: Number(inv.total_amount),
    actorId,
    actorName,
    note,
  })
}

export async function markSupplierPaid(
  supabase: SupabaseClient,
  invoiceId: string,
  amount: number,
  method: string | null,
  actorId: string | null,
  actorName: string | null,
) {
  const { data: inv } = await supabase.from('supplier_invoices').select('*').eq('id', invoiceId).maybeSingle()
  if (!inv) throw new Error('Supplier invoice not found')
  const paid = roundFinancial(Number(inv.amount_paid ?? 0) + amount)
  const due = balanceDue(Number(inv.total_amount), paid)
  const state = resolvePaymentState(Number(inv.total_amount), paid, inv.due_date)
  const status = state === 'paid' ? 'paid' : state === 'partially_paid' ? 'partially_paid' : inv.status
  await supabase.from('supplier_invoices').update({
    amount_paid: paid,
    balance_due: due,
    status,
    paid_at: status === 'paid' ? new Date().toISOString() : inv.paid_at,
  }).eq('id', invoiceId)
  await addFinanceTransaction(supabase, {
    companyId: inv.company_id,
    transactionType: 'supplier_payment',
    direction: 'outgoing',
    sourceTable: 'supplier_invoices',
    sourceId: invoiceId,
    referenceNumber: inv.invoice_number,
    amount,
    paymentMethod: method,
    createdBy: actorId,
  })
  await logFinanceAudit(supabase, {
    companyId: inv.company_id,
    entityType: 'supplier_invoice',
    entityId: invoiceId,
    action: 'paid',
    amount,
    actorId,
    actorName,
    note: method,
  })
}

export async function approveContractorPayout(
  supabase: SupabaseClient,
  payoutId: string,
  actorId: string | null,
  actorName: string | null,
) {
  const { data: p } = await supabase.from('contractor_payouts').select('*').eq('id', payoutId).maybeSingle()
  if (!p) throw new Error('Payout not found')
  await supabase.from('contractor_payouts').update({
    approval_status: 'approved',
    payout_status: 'approved',
    approved_by: actorId,
    approved_at: new Date().toISOString(),
  }).eq('id', payoutId)
  const net = Number(p.total_amount ?? 0) - Number(p.retention_amount ?? 0)
  await logFinanceAudit(supabase, {
    companyId: p.company_id,
    entityType: 'contractor_payout',
    entityId: payoutId,
    action: 'approved',
    amount: net,
    actorId,
    actorName,
  })
}

export async function rejectContractorPayout(
  supabase: SupabaseClient,
  payoutId: string,
  actorId: string | null,
  actorName: string | null,
  note?: string,
) {
  const { data: p } = await supabase.from('contractor_payouts').select('*').eq('id', payoutId).maybeSingle()
  if (!p) throw new Error('Payout not found')
  await supabase.from('contractor_payouts').update({
    approval_status: 'rejected',
    payout_status: 'cancelled',
    approved_by: actorId,
    approved_at: new Date().toISOString(),
    rejection_reason: note?.trim() || null,
  }).eq('id', payoutId)
  const net = Number(p.total_amount ?? 0) - Number(p.retention_amount ?? 0)
  await logFinanceAudit(supabase, {
    companyId: p.company_id,
    entityType: 'contractor_payout',
    entityId: payoutId,
    action: 'rejected',
    amount: net,
    actorId,
    actorName,
    note,
  })
}

export async function markContractorPayoutPaid(
  supabase: SupabaseClient,
  payoutId: string,
  method: string | null,
  actorId: string | null,
  actorName: string | null,
) {
  const { data: p } = await supabase.from('contractor_payouts').select('*').eq('id', payoutId).maybeSingle()
  if (!p) throw new Error('Payout not found')
  const today = new Date().toISOString().slice(0, 10)
  await supabase.from('contractor_payouts').update({
    payout_status: 'paid',
    paid_at: new Date().toISOString(),
    payout_date: today,
  }).eq('id', payoutId)
  const net = Number(p.total_amount ?? 0) - Number(p.retention_amount ?? 0)
  await addFinanceTransaction(supabase, {
    companyId: p.company_id,
    transactionType: 'contractor_payment',
    direction: 'outgoing',
    sourceTable: 'contractor_payouts',
    sourceId: payoutId,
    amount: net,
    paymentMethod: method,
    createdBy: actorId,
  })
  await logFinanceAudit(supabase, {
    companyId: p.company_id,
    entityType: 'contractor_payout',
    entityId: payoutId,
    action: 'paid',
    amount: net,
    actorId,
    actorName,
    note: method,
  })
}

export async function recordInvoicePayment(
  supabase: SupabaseClient,
  invoiceId: string,
  amount: number,
  method: string | null,
  actorId: string | null,
  actorName: string | null,
) {
  const { data: inv } = await supabase.from('finance_invoices').select('*').eq('id', invoiceId).maybeSingle()
  if (!inv) throw new Error('Invoice not found')
  const paid = roundFinancial(Number(inv.amount_paid ?? 0) + amount)
  const due = balanceDue(Number(inv.total_amount), paid)
  const state = resolvePaymentState(Number(inv.total_amount), paid, inv.due_date)
  const status =
    state === 'paid' ? 'paid'
      : state === 'partially_paid' ? 'partially_paid'
        : state === 'overdue' ? 'overdue'
          : inv.status
  await supabase.from('finance_invoices').update({
    amount_paid: paid,
    balance_due: due,
    status,
    paid_date: status === 'paid' ? new Date().toISOString().slice(0, 10) : inv.paid_date,
  }).eq('id', invoiceId)
  await addFinanceTransaction(supabase, {
    companyId: inv.company_id,
    transactionType: 'invoice',
    direction: 'incoming',
    sourceTable: 'finance_invoices',
    sourceId: invoiceId,
    referenceNumber: inv.invoice_number,
    amount,
    paymentMethod: method,
    createdBy: actorId,
  })
  await logFinanceAudit(supabase, {
    companyId: inv.company_id,
    entityType: 'finance_invoice',
    entityId: invoiceId,
    action: 'paid',
    amount,
    actorId,
    actorName,
    note: method,
  })
}

export type ReorderLineInput = {
  inventoryItemId: string
  description: string
  quantity: number
  unitCost: number
  supplierId: string
}

/**
 * Create one draft supplier invoice per preferred supplier from reorder lines.
 * Returns created invoice ids (ordered by supplier groups).
 */
export async function createDraftSupplierReorderInvoices(
  supabase: SupabaseClient,
  args: {
    companyId: string
    actorId: string | null
    actorName: string | null
    lines: ReorderLineInput[]
    vatRate?: number
  },
): Promise<{ invoiceIds: string[]; skippedNoSupplier: number }> {
  const vatRate = args.vatRate ?? 0.15
  const withSupplier = args.lines.filter(l => l.supplierId && l.quantity > 0)
  const skippedNoSupplier = args.lines.length - withSupplier.length

  const bySupplier = new Map<string, ReorderLineInput[]>()
  for (const line of withSupplier) {
    const list = bySupplier.get(line.supplierId) ?? []
    list.push(line)
    bySupplier.set(line.supplierId, list)
  }

  const invoiceIds: string[] = []
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  for (const [supplierId, group] of bySupplier) {
    const calcLines = group.map(l =>
      calculateLine(l.quantity, l.unitCost, vatRate, false, 'standard'),
    )
    const totals = summariseLines(calcLines)
    const invoiceNumber = `RO-${stamp}-${supplierId.slice(0, 6).toUpperCase()}`

    const { data: inv, error: invErr } = await supabase
      .from('supplier_invoices')
      .insert({
        company_id: args.companyId,
        supplier_id: supplierId,
        invoice_number: invoiceNumber,
        subtotal: totals.subtotal,
        vat_rate: vatRate,
        vat_amount: totals.vatAmount,
        total_amount: totals.totalAmount,
        amount_paid: 0,
        balance_due: totals.totalAmount,
        is_vat_inclusive: false,
        tax_type: 'standard',
        status: 'draft',
        approval_status: 'pending',
        notes: 'Draft reorder from inventory low-stock',
        created_by: args.actorId,
      })
      .select('id')
      .single()

    if (invErr || !inv) throw new Error(invErr?.message ?? 'Failed to create draft supplier invoice')

    const lineRows = group.map((l, idx) => {
      const calc = calcLines[idx]
      return {
        company_id: args.companyId,
        invoice_id: inv.id as string,
        line_no: idx + 1,
        inventory_item_id: l.inventoryItemId,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unitCost,
        subtotal: calc.subtotal,
        vat_rate: vatRate,
        vat_amount: calc.vatAmount,
        total_amount: calc.totalAmount,
        is_vat_inclusive: false,
        tax_type: 'standard',
      }
    })

    const { error: lineErr } = await supabase.from('supplier_invoice_lines').insert(lineRows)
    if (lineErr) throw new Error(lineErr.message)

    await logFinanceAudit(supabase, {
      companyId: args.companyId,
      entityType: 'supplier_invoice',
      entityId: inv.id as string,
      action: 'created',
      amount: totals.totalAmount,
      actorId: args.actorId,
      actorName: args.actorName,
      note: `Draft reorder (${group.length} line${group.length === 1 ? '' : 's'})`,
    })

    invoiceIds.push(inv.id as string)
  }

  return { invoiceIds, skippedNoSupplier }
}
