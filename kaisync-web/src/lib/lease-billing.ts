/**
 * Lease deposit / payer taxonomy and rent payment status helpers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateVatExclusive, roundFinancial } from '@/lib/finance-calc'
import type {
  LeaseDepositStatus,
  LeasePayerType,
  PropertyLease,
} from '@/types/database'

export const LEASE_DEPOSIT_STATUSES: { value: LeaseDepositStatus; label: string }[] = [
  { value: 'none', label: 'No deposit' },
  { value: 'due', label: 'Deposit due' },
  { value: 'paid', label: 'Deposit paid' },
  { value: 'partially_held', label: 'Partially held' },
  { value: 'refunded', label: 'Refunded' },
]

export const LEASE_PAYER_TYPES: { value: LeasePayerType; label: string }[] = [
  { value: 'self', label: 'Self (tenant)' },
  { value: 'bursary', label: 'Bursary / NSFAS' },
  { value: 'sponsor', label: 'Sponsor' },
  { value: 'cash', label: 'Cash' },
  { value: 'eft', label: 'EFT' },
]

export function depositStatusLabel(v: string | null | undefined): string {
  return LEASE_DEPOSIT_STATUSES.find(s => s.value === v)?.label ?? (v || '—')
}

export function payerTypeLabel(v: string | null | undefined): string {
  return LEASE_PAYER_TYPES.find(s => s.value === v)?.label ?? (v || '—')
}

export type RentInvoiceLike = {
  id: string
  lease_id: string | null
  status: string
  balance_due: number
  total_amount?: number
  amount_paid?: number
  due_date: string | null
  issue_date?: string | null
}

export type LeaseRentStatus =
  | { kind: 'no_rent'; label: string }
  | { kind: 'no_invoice'; label: string }
  | { kind: 'paid'; label: string }
  | { kind: 'partial'; label: string; balance: number; daysOverdue: number }
  | { kind: 'overdue'; label: string; balance: number; daysOverdue: number }
  | { kind: 'open'; label: string; balance: number; daysOverdue: number }

function daysPastDue(dueDate: string | null): number {
  if (!dueDate) return 0
  const due = new Date(dueDate + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.floor((today.getTime() - due.getTime()) / 86_400_000)
  return diff > 0 ? diff : 0
}

/** Summarise open rent invoices for a lease (current period tracking). */
export function summarizeLeaseRentStatus(
  lease: Pick<PropertyLease, 'rent_amount'>,
  invoices: RentInvoiceLike[],
): LeaseRentStatus {
  if (lease.rent_amount == null || !Number.isFinite(Number(lease.rent_amount))) {
    return { kind: 'no_rent', label: 'No rent set' }
  }
  const open = invoices.filter(i => {
    const bal = Number(i.balance_due) || 0
    if (bal <= 0) return false
    return !['cancelled', 'voided', 'draft'].includes(i.status)
  })
  if (invoices.length === 0) {
    return { kind: 'no_invoice', label: 'Not invoiced' }
  }
  if (open.length === 0) {
    return { kind: 'paid', label: 'Paid up' }
  }
  const balance = open.reduce((s, i) => s + (Number(i.balance_due) || 0), 0)
  const maxDays = Math.max(...open.map(i => daysPastDue(i.due_date)), 0)
  const anyPartial = open.some(i => (Number(i.amount_paid) || 0) > 0)
  if (maxDays > 0) {
    return {
      kind: 'overdue',
      label: `Overdue ${maxDays}d`,
      balance,
      daysOverdue: maxDays,
    }
  }
  if (anyPartial) {
    return { kind: 'partial', label: 'Partial', balance, daysOverdue: 0 }
  }
  return { kind: 'open', label: 'Awaiting payment', balance, daysOverdue: 0 }
}

function periodLabel(d = new Date()): string {
  return new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(d)
}

function endOfMonthIso(d = new Date()): string {
  const e = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return e.toISOString().slice(0, 10)
}

export type CreateRentInvoiceInput = {
  companyId: string
  employeeId: string
  lease: PropertyLease
  /** Billable client — required for ledger; may be null for draft tracking */
  clientId: string | null
  send?: boolean
  /** VAT percent, default 0 for residential rent */
  vatPercent?: number
  description?: string
}

export type CreateRentInvoiceResult =
  | { ok: true; invoiceId: string }
  | { ok: false; message: string }

/** One-click rent invoice for the current calendar month. */
export async function createRentInvoiceForLease(
  supabase: SupabaseClient,
  input: CreateRentInvoiceInput,
): Promise<CreateRentInvoiceResult> {
  const rent = Number(input.lease.rent_amount)
  if (!Number.isFinite(rent) || rent <= 0) {
    return { ok: false, message: 'Lease has no rent amount.' }
  }

  const issueDate = new Date().toISOString().slice(0, 10)
  const dueDate = endOfMonthIso()
  const vatPercent = input.vatPercent ?? 0
  const rate = vatPercent / 100
  const calc = calculateVatExclusive(rent, rate)
  const send = input.send !== false

  let invoiceNumber: string | null = null
  if (send) {
    const { data: num } = await (supabase.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: string | null }>)('generate_invoice_number', {
      p_company_id: input.companyId,
    })
    invoiceNumber = num ?? null
  }

  const payerNote =
    input.lease.payer_type && input.lease.payer_type !== 'self'
      ? ` · Payer: ${payerTypeLabel(input.lease.payer_type)}${input.lease.sponsor_name ? ` (${input.lease.sponsor_name})` : ''}`
      : ''

  const description =
    input.description
    ?? `Rent — ${periodLabel()}${payerNote}`

  const now = new Date().toISOString()
  const { data: inv, error } = await supabase
    .from('finance_invoices')
    .insert({
      company_id: input.companyId,
      client_id: input.clientId,
      lease_id: input.lease.id,
      site_id: input.lease.site_id,
      invoice_number: invoiceNumber,
      status: send ? 'sent' : 'draft',
      sent_at: send ? now : null,
      currency: input.lease.currency || 'ZAR',
      subtotal: calc.subtotal,
      vat_rate: rate,
      vat_amount: calc.vatAmount,
      total_amount: calc.totalAmount,
      amount_paid: 0,
      balance_due: calc.totalAmount,
      is_vat_inclusive: false,
      tax_type: vatPercent > 0 ? 'standard' : 'exempt',
      issue_date: issueDate,
      due_date: dueDate,
      created_by: input.employeeId,
      invoice_type: 'rent',
      notes: input.lease.tenant_name
        ? `Tenant: ${input.lease.tenant_name}`
        : null,
    })
    .select('id')
    .single()

  if (error || !inv) {
    return { ok: false, message: error?.message ?? 'Failed to create rent invoice' }
  }

  const { error: lineErr } = await supabase.from('finance_invoice_lines').insert({
    invoice_id: inv.id,
    company_id: input.companyId,
    line_no: 1,
    description,
    quantity: 1,
    unit_price: roundFinancial(rent),
    vat_rate: rate,
    vat_amount: calc.vatAmount,
    subtotal: calc.subtotal,
    total_amount: calc.totalAmount,
    is_vat_inclusive: false,
    tax_type: vatPercent > 0 ? 'standard' : 'exempt',
  })

  if (lineErr) {
    return { ok: false, message: lineErr.message }
  }

  return { ok: true, invoiceId: inv.id }
}
