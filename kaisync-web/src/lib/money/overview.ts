/**
 * Money overview: everything coming in and going out for a period, from one database call
 * (money_overview). Owner, HR and admins only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ClientAccount = {
  client_id: string | null; name: string; owed: number; not_due: number; d30: number; d60: number; d90: number
  invoices: number; oldest_days: number | null; last_paid: string | null
}
export type SupplierAccount = {
  supplier_id: string | null; name: string; owe: number; not_due: number; overdue: number; open_bills: number; paid: number; last_paid: string | null
}
export type ContractorAccount = {
  contractor_id: string | null; name: string; jobs: number; paid: number; approved_unpaid: number; waiting: number; retention: number
}
export type ExpenseItem = {
  id: string; name: string; category: string; amount: number; vat_amount: number
  frequency: 'once' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  start_date: string; end_date: string | null; payment_method: string | null; notes: string | null
  next_date: string | null; in_period: number
}

export type MoneyOverview = {
  from: string
  to: string
  vat_registered: boolean
  income: { invoiced: number; invoice_count: number; invoiced_vat: number; credit_notes: number; credit_note_count: number; credit_note_vat: number; refunded: number; total: number }
  payroll: { gross: number; net: number; overtime: number; paye: number; uif: number; meibc: number; people: number; net_paid: number; net_unpaid: number
    departments: { name: string; people: number; gross: number; overtime: number; net: number }[] }
  contractors: { cost: number; cost_vat: number; paid: number; approved_unpaid: number; waiting: number; waiting_count: number; retention: number; accounts: ContractorAccount[] }
  suppliers: { cost: number; cost_vat: number; owe: number; overdue: number; paid: number; to_approve: number; due_soon: number; accounts: SupplierAccount[] }
  expenses: { paid: number; cost: number; vat: number; regular_cost: number; once_off_cost: number; monthly_equivalent: number; due_soon: number; items: ExpenseItem[] }
  clients: { owed: number; not_due: number; d30: number; d60: number; d90: number; open_invoices: number; late_60: number; avg_days_to_pay: number | null; received: number; accounts: ClientAccount[] }
  quotes: { quoted: number; quoted_count: number; accepted: number; accepted_count: number; invoiced: number; invoiced_count: number; paid: number; paid_count: number }
  cash_out: { payroll: number; contractors: number; suppliers: number; expenses: number; refunds: number }
  cash_out_total: number
  vat: { output: number; input: number }
  series: { month: string; in: number; out: number }[]
}

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** Numbers arrive as JSON numbers or strings; make every amount a number. */
function numbers<T>(v: T): T {
  if (Array.isArray(v)) return v.map(numbers) as T
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x) && !/(date|_at|month|from|to)$/.test(k) ? n(x) : numbers(x)
    }
    return out as T
  }
  return v
}

export async function loadMoneyOverview(supabase: SupabaseClient, companyId: string, from: string, to: string): Promise<MoneyOverview> {
  const { data, error } = await supabase.rpc('money_overview', { p_company_id: companyId, p_from: from, p_to: to })
  if (error) throw new Error(/NOT_ALLOWED/.test(error.message) ? 'NOT_ALLOWED' : error.message)
  return numbers(data as MoneyOverview)
}

/** Profit and loss for the period (amounts excl. VAT). */
export function totals(o: MoneyOverview) {
  const income = o.income.total
  const lines = [
    { key: 'payroll', label: 'Employees (gross pay)', value: o.payroll.gross },
    { key: 'contractors', label: 'Contractors', value: o.contractors.cost },
    { key: 'suppliers', label: 'Suppliers and materials', value: o.suppliers.cost },
    { key: 'regular', label: 'Subscriptions and regular costs', value: o.expenses.regular_cost },
    { key: 'once', label: 'Once-off expenses', value: o.expenses.once_off_cost },
  ]
  const expenses = lines.reduce((s, l) => s + l.value, 0)
  return { income, lines, expenses, profit: Math.round((income - expenses) * 100) / 100 }
}

export const FREQUENCY_LABEL: Record<ExpenseItem['frequency'], string> = {
  once: 'Once-off', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Every 3 months', yearly: 'Yearly',
}
export const PAYMENT_LABEL: Record<string, string> = {
  card: 'Card', debit_order: 'Debit order', eft: 'EFT', cash: 'Cash', other: 'Other',
}
export const EXPENSE_CATEGORIES = [
  'Software', 'Phones and data', 'Premises and rent', 'Vehicles and fuel', 'Insurance', 'Utilities',
  'Professional fees', 'Bank charges', 'Marketing', 'Equipment', 'Training', 'Other',
]

export function monthlyEquivalent(e: Pick<ExpenseItem, 'amount' | 'frequency'>): number {
  switch (e.frequency) {
    case 'weekly': return (e.amount * 52) / 12
    case 'monthly': return e.amount
    case 'quarterly': return e.amount / 3
    case 'yearly': return e.amount / 12
    default: return 0
  }
}
