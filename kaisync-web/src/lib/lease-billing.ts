/**
 * Lease deposit / payer taxonomy and rent payment status helpers.
 * Rent billing reuses finance_invoices (invoice_type = 'rent') — no parallel ledger.
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

export type BillingPeriod = {
  /** First day of month YYYY-MM-DD */
  start: string
  /** Last day of month YYYY-MM-DD */
  end: string
  /** Display e.g. September 2026 */
  label: string
  /** Key e.g. 2026-09 */
  key: string
}

export function billingPeriodFor(d = new Date()): BillingPeriod {
  const startDate = new Date(d.getFullYear(), d.getMonth(), 1)
  const endDate = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const y = startDate.getFullYear()
  const m = String(startDate.getMonth() + 1).padStart(2, '0')
  return {
    start: `${y}-${m}-01`,
    end: endDate.toISOString().slice(0, 10),
    label: new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(startDate),
    key: `${y}-${m}`,
  }
}

/** True when rent should bill a funder (bursary/sponsor), not the occupant. */
export function isFunderPayer(payerType: string | null | undefined): boolean {
  return payerType === 'bursary' || payerType === 'sponsor'
}

/**
 * Resolve Money bill-to client for a rent invoice.
 * Bursary/sponsor → payer_client_id (required for correct ledger); else tenant; else site fallback.
 */
export function resolveRentBillToClientId(
  lease: Pick<PropertyLease, 'payer_type' | 'payer_client_id' | 'tenant_client_id'>,
  siteClientId?: string | null,
): string | null {
  if (isFunderPayer(lease.payer_type) && lease.payer_client_id) {
    return lease.payer_client_id
  }
  return lease.tenant_client_id ?? siteClientId ?? null
}

/**
 * Find or create a company client for a bursary/sponsor name (e.g. NSFAS).
 * Matches case-insensitively within the company.
 */
export async function ensurePayerClientFromName(
  supabase: SupabaseClient,
  opts: { companyId: string; name: string },
): Promise<{ ok: true; clientId: string; created: boolean } | { ok: false; message: string }> {
  const name = opts.name.trim()
  if (!name) return { ok: false, message: 'Sponsor / bursary name is required.' }

  const { data: existing, error: findErr } = await supabase
    .from('clients')
    .select('id')
    .eq('company_id', opts.companyId)
    .ilike('name', name)
    .limit(1)
    .maybeSingle()

  if (findErr) return { ok: false, message: findErr.message }
  if (existing?.id) return { ok: true, clientId: existing.id, created: false }

  const { data: created, error: createErr } = await supabase
    .from('clients')
    .insert({
      company_id: opts.companyId,
      name,
      type: 'company',
      notes: 'Created as bursary / sponsor bill-to from property lease',
    })
    .select('id')
    .single()

  if (createErr || !created) {
    return { ok: false, message: createErr?.message ?? 'Failed to create sponsor client' }
  }
  return { ok: true, clientId: created.id, created: true }
}

/** Active non-void rent invoice for lease whose issue_date falls in the billing month. */
export async function findRentInvoiceForPeriod(
  supabase: SupabaseClient,
  opts: { companyId: string; leaseId: string; period: BillingPeriod },
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('finance_invoices')
    .select('id')
    .eq('company_id', opts.companyId)
    .eq('lease_id', opts.leaseId)
    .eq('invoice_type', 'rent')
    .gte('issue_date', opts.period.start)
    .lte('issue_date', opts.period.end)
    .not('status', 'in', '("cancelled","voided")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('findRentInvoiceForPeriod', error.message)
    return null
  }
  return data?.id ? { id: data.id } : null
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
  /** Billing month (defaults to current calendar month) */
  periodDate?: Date
  /** When true (default), skip create if a rent invoice already exists for the period */
  skipIfExists?: boolean
}

export type CreateRentInvoiceResult =
  | { ok: true; invoiceId: string; created: true }
  | { ok: true; invoiceId: string; created: false; reason: 'already_invoiced' }
  | { ok: false; message: string }

/** One-click rent invoice for a calendar month (idempotent per lease + month). */
export async function createRentInvoiceForLease(
  supabase: SupabaseClient,
  input: CreateRentInvoiceInput,
): Promise<CreateRentInvoiceResult> {
  const rent = Number(input.lease.rent_amount)
  if (!Number.isFinite(rent) || rent <= 0) {
    return { ok: false, message: 'Lease has no rent amount.' }
  }

  const period = billingPeriodFor(input.periodDate ?? new Date())
  const skipIfExists = input.skipIfExists !== false

  if (skipIfExists) {
    const existing = await findRentInvoiceForPeriod(supabase, {
      companyId: input.companyId,
      leaseId: input.lease.id,
      period,
    })
    if (existing) {
      return { ok: true, invoiceId: existing.id, created: false, reason: 'already_invoiced' }
    }
  }

  const issueDate = period.start
  const dueDate = period.end
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

  const funderBilling = isFunderPayer(input.lease.payer_type)
  const description =
    input.description
    ?? (funderBilling
      ? `Rent (billed to ${payerTypeLabel(input.lease.payer_type)}${input.lease.sponsor_name ? `: ${input.lease.sponsor_name}` : ''}) — ${period.label}`
      : `Rent — ${period.label}${payerNote}`)

  const noteParts: string[] = []
  if (input.lease.tenant_name) {
    noteParts.push(funderBilling ? `Occupant: ${input.lease.tenant_name}` : `Tenant: ${input.lease.tenant_name}`)
  }
  if (funderBilling && input.lease.sponsor_name) {
    noteParts.push(`Funder: ${input.lease.sponsor_name}`)
  }

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
      notes: noteParts.length > 0 ? noteParts.join(' · ') : null,
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

  return { ok: true, invoiceId: inv.id, created: true }
}

export type BulkRentInvoiceFailure = {
  leaseId: string
  tenant: string | null
  message: string
}

export type BulkRentInvoiceResult = {
  period: BillingPeriod
  created: number
  skipped: number
  failed: BulkRentInvoiceFailure[]
  invoiceIds: string[]
}

export type GenerateMonthlyRentInvoicesInput = {
  companyId: string
  employeeId: string
  /** Limit to one property; omit for whole company */
  siteId?: string | null
  periodDate?: Date
  send?: boolean
  vatPercent?: number
}

/**
 * Generate rent invoices for all eligible active monthly leases in a billing month.
 * Skips leases already invoiced for the period. Weekly/other frequencies are skipped
 * (invoice those from the lease/unit screen).
 */
export async function generateMonthlyRentInvoices(
  supabase: SupabaseClient,
  input: GenerateMonthlyRentInvoicesInput,
): Promise<BulkRentInvoiceResult> {
  const period = billingPeriodFor(input.periodDate ?? new Date())
  const result: BulkRentInvoiceResult = {
    period,
    created: 0,
    skipped: 0,
    failed: [],
    invoiceIds: [],
  }

  let q = supabase
    .from('property_leases')
    .select('*, sites(id, client_id)')
    .eq('company_id', input.companyId)
    .eq('status', 'active')
    .gt('rent_amount', 0)
    .lte('start_date', period.end)
    .or(`end_date.is.null,end_date.gte.${period.start}`)
    .order('tenant_name')

  if (input.siteId) {
    q = q.eq('site_id', input.siteId)
  }

  const { data: rows, error } = await q.limit(5000)
  if (error) {
    result.failed.push({ leaseId: '', tenant: null, message: error.message })
    return result
  }

  type LeaseRow = PropertyLease & { sites?: { id: string; client_id: string | null } | null }

  for (const raw of (rows ?? []) as LeaseRow[]) {
    const lease = raw as PropertyLease
    if (lease.payment_frequency !== 'monthly') {
      result.skipped += 1
      continue
    }

    if (isFunderPayer(lease.payer_type) && !lease.payer_client_id) {
      result.failed.push({
        leaseId: lease.id,
        tenant: lease.tenant_name,
        message: 'Bursary/sponsor lease has no bill-to client — set payer client on the lease first.',
      })
      continue
    }

    const clientId = resolveRentBillToClientId(lease, raw.sites?.client_id ?? null)
    const created = await createRentInvoiceForLease(supabase, {
      companyId: input.companyId,
      employeeId: input.employeeId,
      lease,
      clientId,
      send: input.send !== false,
      vatPercent: input.vatPercent ?? 0,
      periodDate: input.periodDate,
      skipIfExists: true,
    })

    if (!created.ok) {
      result.failed.push({
        leaseId: lease.id,
        tenant: lease.tenant_name,
        message: created.message,
      })
      continue
    }

    if (created.created) {
      result.created += 1
      result.invoiceIds.push(created.invoiceId)
    } else {
      result.skipped += 1
    }
  }

  return result
}
