import type { SupabaseClient } from '@supabase/supabase-js'
import { balanceDue, roundFinancial, type PaymentState, resolvePaymentState } from '@/lib/finance-calc'
import type { FinanceDashboardKpis } from '@/lib/finance-types'

function inWindow(d: string | null | undefined, from: string, to: string): boolean {
  if (!d) return false
  const day = d.slice(0, 10)
  return day >= from && day <= to
}

export async function loadFinanceDashboardKpis(
  supabase: SupabaseClient,
  companyId: string,
  from: string,
  to: string,
): Promise<FinanceDashboardKpis> {
  const [
    { data: invoices },
    { data: suppliers },
    { data: payouts },
    { data: txns },
    { data: payroll },
  ] = await Promise.all([
    supabase
      .from('finance_invoices')
      .select('status, subtotal, balance_due, issue_date, vat_amount')
      .eq('company_id', companyId),
    supabase
      .from('supplier_invoices')
      .select('status, approval_status, balance_due, total_amount, due_date, subtotal, vat_amount')
      .eq('company_id', companyId),
    supabase
      .from('contractor_payouts')
      .select('payout_status, approval_status, total_amount, retention_amount, payout_date, subtotal')
      .eq('company_id', companyId),
    supabase
      .from('finance_transactions')
      .select('direction, total_amount, transaction_date')
      .eq('company_id', companyId)
      .gte('transaction_date', from)
      .lte('transaction_date', to),
    supabase
      .from('payment_approvals')
      .select('gross_pay')
      .eq('company_id', companyId)
      .gte('period_start', from)
      .lte('period_start', to),
  ])

  const inv = invoices ?? []
  const sup = suppliers ?? []
  const pay = payouts ?? []
  const tx = txns ?? []

  const outstandingStatuses = new Set(['sent', 'viewed', 'partially_paid', 'overdue'])
  const revenue = roundFinancial(
    inv
      .filter(i => inWindow(i.issue_date, from, to) && i.status !== 'cancelled' && i.status !== 'draft')
      .reduce((s, i) => s + Number(i.subtotal ?? 0), 0),
  )
  const outstandingList = inv.filter(i => outstandingStatuses.has(String(i.status)))
  const outstanding = roundFinancial(outstandingList.reduce((s, i) => s + Number(i.balance_due ?? 0), 0))

  const supplierPayables = roundFinancial(
    sup
      .filter(s => !['paid', 'cancelled'].includes(String(s.status)))
      .reduce((s, i) => s + Number(i.balance_due ?? i.total_amount ?? 0), 0),
  )
  const contractorPayables = roundFinancial(
    pay
      .filter(p => ['pending', 'approved'].includes(String(p.payout_status)))
      .reduce((s, p) => s + (Number(p.total_amount ?? 0) - Number(p.retention_amount ?? 0)), 0),
  )
  const payables = roundFinancial(supplierPayables + contractorPayables)

  const moneyIn = roundFinancial(
    tx.filter(t => String(t.direction) === 'incoming').reduce((s, t) => s + Number(t.total_amount ?? 0), 0),
  )
  const moneyOut = roundFinancial(
    tx.filter(t => String(t.direction) !== 'incoming').reduce((s, t) => s + Number(t.total_amount ?? 0), 0),
  )

  const payrollCosts = roundFinancial((payroll ?? []).reduce((s, p) => s + Number(p.gross_pay ?? 0), 0))
  const windowSupplier = roundFinancial(
    sup
      .filter(s => s.due_date && inWindow(s.due_date, from, to) && s.status !== 'cancelled')
      .reduce((s, i) => s + Number(i.subtotal ?? 0), 0),
  )
  const windowPayouts = roundFinancial(
    pay
      .filter(p => p.payout_date && inWindow(p.payout_date, from, to))
      .reduce((s, p) => s + Number(p.subtotal ?? 0), 0),
  )
  const profit = roundFinancial(revenue - windowSupplier - windowPayouts - payrollCosts)

  const outputVat = roundFinancial(
    inv
      .filter(i => inWindow(i.issue_date, from, to) && i.status !== 'draft' && i.status !== 'cancelled')
      .reduce((s, i) => s + Number(i.vat_amount ?? 0), 0),
  )
  const inputVat = roundFinancial(
    sup
      .filter(s => s.due_date && inWindow(s.due_date, from, to))
      .reduce((s, i) => s + Number(i.vat_amount ?? 0), 0),
  )

  const pendingApprovals =
    sup.filter(s => String(s.approval_status) === 'pending').length +
    pay.filter(p => String(p.approval_status) === 'pending' || String(p.payout_status) === 'pending').length

  return {
    revenue,
    outstanding,
    outstandingCount: outstandingList.length,
    payables,
    profit,
    moneyIn,
    moneyOut,
    vatDue: roundFinancial(outputVat - inputVat),
    pendingApprovals,
  }
}

export function paymentStatusLabel(state: PaymentState): string {
  switch (state) {
    case 'paid': return 'Paid'
    case 'partially_paid': return 'Partially paid'
    case 'overdue': return 'Overdue'
    default: return 'Unpaid'
  }
}

export { balanceDue, resolvePaymentState }
