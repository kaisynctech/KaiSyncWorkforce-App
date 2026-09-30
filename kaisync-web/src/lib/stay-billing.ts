/**
 * Guest-house check-out billing.
 * Reuses finance_invoices (invoice_type = 'stay'). Rent invoices stay on lease_id.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { roundFinancial } from '@/lib/finance-calc'
import { recordInvoicePayment } from '@/lib/finance-api'
import { nightsBetween } from '@/lib/property-stays'
import type { PropertyStay, StayDepositStatus } from '@/types/database'

export type StayCharge = {
  nights: number
  charge: number | null
  depositApplied: number
  quantity: number
  unitPrice: number
}

const DEPOSIT_RECEIVED: StayDepositStatus[] = ['paid', 'held']

export function computeStayCheckoutCharge(
  stay: Pick<
    PropertyStay,
    'check_in_date' | 'check_out_date' | 'nightly_rate' | 'total_amount' | 'deposit_amount' | 'deposit_status'
  >,
): StayCharge {
  const nights = Math.max(nightsBetween(stay.check_in_date, stay.check_out_date), 0)
  const rate = stay.nightly_rate != null && Number.isFinite(Number(stay.nightly_rate))
    ? Number(stay.nightly_rate)
    : null
  const storedTotal = stay.total_amount != null && Number.isFinite(Number(stay.total_amount))
    ? Number(stay.total_amount)
    : null

  let charge: number | null = null
  if (storedTotal != null && storedTotal > 0) charge = roundFinancial(storedTotal)
  else if (rate != null && rate > 0) charge = roundFinancial(rate * Math.max(nights, 1))

  const depositRaw = stay.deposit_amount != null && Number.isFinite(Number(stay.deposit_amount))
    ? Number(stay.deposit_amount)
    : 0
  const depositReceived = DEPOSIT_RECEIVED.includes(stay.deposit_status) && depositRaw > 0
  const depositApplied = charge != null && depositReceived
    ? roundFinancial(Math.min(depositRaw, charge))
    : 0

  const billableNights = Math.max(nights, 1)
  const rateMatches = rate != null && rate > 0 && charge != null
    && Math.abs(roundFinancial(rate * billableNights) - charge) < 0.02

  return {
    nights: billableNights,
    charge,
    depositApplied,
    quantity: rateMatches ? billableNights : 1,
    unitPrice: rateMatches && rate != null ? roundFinancial(rate) : (charge ?? 0),
  }
}

export type StayInvoiceResult =
  | {
      ok: true
      skipped: false
      created: boolean
      invoiceId: string
      invoiceNumber: string | null
      balanceDue: number
      charge: number
      depositApplied: number
    }
  | { ok: true; skipped: true; reason: 'no_charge' }
  | { ok: false; message: string }

type StayInvoiceRow = {
  id: string
  invoice_number: string | null
  balance_due: number
  amount_paid: number
  total_amount: number
}

async function findOpenStayInvoice(
  supabase: SupabaseClient,
  opts: { companyId: string; stayId: string },
): Promise<{ ok: true; row: StayInvoiceRow | null } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from('finance_invoices')
    .select('id, invoice_number, balance_due, amount_paid, total_amount')
    .eq('company_id', opts.companyId)
    .eq('stay_id', opts.stayId)
    .eq('invoice_type', 'stay')
    .not('status', 'in', '("cancelled","voided")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { ok: false, message: error.message }
  return { ok: true, row: (data as StayInvoiceRow | null) ?? null }
}

/**
 * Create one stay invoice, or return the existing open one.
 * A paid or held deposit is recorded as money already received, capped at the charge.
 */
export async function createStayCheckoutInvoice(
  supabase: SupabaseClient,
  input: { companyId: string; employeeId: string | null; stay: PropertyStay },
): Promise<StayInvoiceResult> {
  const charge = computeStayCheckoutCharge(input.stay)
  if (charge.charge == null || charge.charge <= 0) {
    return { ok: true, skipped: true, reason: 'no_charge' }
  }

  const existing = await findOpenStayInvoice(supabase, {
    companyId: input.companyId,
    stayId: input.stay.id,
  })
  if (!existing.ok) return existing

  if (existing.row) {
    const applied = await applyDepositIfNeeded(supabase, {
      companyId: input.companyId,
      employeeId: input.employeeId,
      invoice: existing.row,
      depositApplied: charge.depositApplied,
    })
    if (!applied.ok) return applied
    return {
      ok: true,
      skipped: false,
      created: false,
      invoiceId: existing.row.id,
      invoiceNumber: existing.row.invoice_number,
      balanceDue: applied.balanceDue,
      charge: Number(existing.row.total_amount),
      depositApplied: charge.depositApplied,
    }
  }

  const { data: unit } = await supabase
    .from('units')
    .select('unit_number')
    .eq('id', input.stay.unit_id)
    .eq('company_id', input.companyId)
    .maybeSingle()

  const guest = [input.stay.guest_name, input.stay.guest_surname].filter(Boolean).join(' ').trim()
  const room = unit?.unit_number ? `Room ${unit.unit_number}` : 'Room'
  const description = `${room} · ${guest || 'Guest'} · ${charge.nights} night${charge.nights === 1 ? '' : 's'} (${input.stay.check_in_date} → ${input.stay.check_out_date})`

  const { data: num } = await (supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: string | null }>)('generate_invoice_number', {
    p_company_id: input.companyId,
  })

  const today = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()
  const { data: inv, error } = await supabase
    .from('finance_invoices')
    .insert({
      company_id: input.companyId,
      client_id: null,
      stay_id: input.stay.id,
      site_id: input.stay.site_id,
      invoice_number: num ?? null,
      status: 'sent',
      sent_at: now,
      currency: input.stay.currency || 'ZAR',
      subtotal: charge.charge,
      vat_rate: 0,
      vat_amount: 0,
      total_amount: charge.charge,
      amount_paid: 0,
      balance_due: charge.charge,
      is_vat_inclusive: false,
      tax_type: 'exempt',
      issue_date: today,
      due_date: input.stay.check_out_date || today,
      created_by: input.employeeId,
      invoice_type: 'stay',
      notes: guest ? `Guest: ${guest}` : null,
    })
    .select('id, invoice_number, balance_due, amount_paid, total_amount')
    .single()

  if (error || !inv) {
    if (error?.code === '23505') {
      const again = await findOpenStayInvoice(supabase, {
        companyId: input.companyId,
        stayId: input.stay.id,
      })
      if (!again.ok) return again
      if (again.row) {
        const applied = await applyDepositIfNeeded(supabase, {
          companyId: input.companyId,
          employeeId: input.employeeId,
          invoice: again.row,
          depositApplied: charge.depositApplied,
        })
        if (!applied.ok) return applied
        return {
          ok: true,
          skipped: false,
          created: false,
          invoiceId: again.row.id,
          invoiceNumber: again.row.invoice_number,
          balanceDue: applied.balanceDue,
          charge: Number(again.row.total_amount),
          depositApplied: charge.depositApplied,
        }
      }
    }
    return { ok: false, message: error?.message ?? 'Failed to create stay invoice' }
  }

  const row = inv as StayInvoiceRow
  const { error: lineErr } = await supabase.from('finance_invoice_lines').insert({
    invoice_id: row.id,
    company_id: input.companyId,
    line_no: 1,
    description,
    quantity: charge.quantity,
    unit_price: charge.unitPrice,
    vat_rate: 0,
    vat_amount: 0,
    subtotal: charge.charge,
    total_amount: charge.charge,
    is_vat_inclusive: false,
    tax_type: 'exempt',
  })

  if (lineErr) {
    await supabase
      .from('finance_invoices')
      .delete()
      .eq('id', row.id)
      .eq('company_id', input.companyId)
    return { ok: false, message: lineErr.message }
  }

  const applied = await applyDepositIfNeeded(supabase, {
    companyId: input.companyId,
    employeeId: input.employeeId,
    invoice: row,
    depositApplied: charge.depositApplied,
  })
  if (!applied.ok) return applied

  return {
    ok: true,
    skipped: false,
    created: true,
    invoiceId: row.id,
    invoiceNumber: row.invoice_number,
    balanceDue: applied.balanceDue,
    charge: charge.charge,
    depositApplied: charge.depositApplied,
  }
}

async function applyDepositIfNeeded(
  supabase: SupabaseClient,
  opts: {
    companyId: string
    employeeId: string | null
    invoice: StayInvoiceRow
    depositApplied: number
  },
): Promise<{ ok: true; balanceDue: number } | { ok: false; message: string }> {
  const alreadyPaid = Number(opts.invoice.amount_paid) || 0
  if (opts.depositApplied <= 0 || alreadyPaid > 0) {
    const total = Number(opts.invoice.total_amount) || 0
    return { ok: true, balanceDue: roundFinancial(Math.max(0, total - alreadyPaid)) }
  }

  try {
    await recordInvoicePayment(
      supabase,
      opts.invoice.id,
      opts.depositApplied,
      'deposit',
      opts.employeeId,
      null,
      { notes: 'Stay deposit applied at check-out' },
    )
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Failed to apply stay deposit' }
  }

  const total = Number(opts.invoice.total_amount) || 0
  return { ok: true, balanceDue: roundFinancial(Math.max(0, total - opts.depositApplied)) }
}
