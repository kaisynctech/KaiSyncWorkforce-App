/**
 * Phase 2 report snapshots — client-side aggregation mirroring MAUI
 * DomainAnalyticsService / FinancialAnalyticsService / TelemetryAnalyticsService.
 * Used when hr_get_*_snapshot RPCs return {} (pre-migration) or as primary for exports.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ReportSnapshot = Record<string, unknown>

const PHASE2_TABS = new Set([
  'financial',
  'incidents',
  'inventory',
  'contractors',
  'property',
  'telemetry',
])

export function isPhase2Tab(tab: string): boolean {
  return PHASE2_TABS.has(tab)
}

function monthLabel(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-ZA', { month: 'short' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 7)
  }
}

export async function buildPhase2Snapshot(
  supabase: SupabaseClient,
  tab: string,
  companyId: string,
  from: string,
  to: string,
): Promise<ReportSnapshot> {
  switch (tab) {
    case 'financial':
      return buildFinancial(supabase, companyId, from, to)
    case 'incidents':
      return buildIncidents(supabase, companyId, from, to)
    case 'inventory':
      return buildInventory(supabase, companyId, from, to)
    case 'contractors':
      return buildContractors(supabase, companyId, from, to)
    case 'property':
      return buildProperty(supabase, companyId)
    case 'telemetry':
      return buildTelemetry(supabase, companyId, from, to)
    default:
      return {}
  }
}

async function buildFinancial(
  supabase: SupabaseClient,
  companyId: string,
  from: string,
  to: string,
): Promise<ReportSnapshot> {
  const [{ data: invoices }, { data: supplierInvs }, { data: payouts }, { data: payroll }] =
    await Promise.all([
      supabase
        .from('finance_invoices')
        .select('total_amount, balance_due, status, issue_date, amount_paid')
        .eq('company_id', companyId)
        .gte('issue_date', from)
        .lte('issue_date', to),
      supabase
        .from('supplier_invoices')
        .select('total_amount, balance_due, status, created_at')
        .eq('company_id', companyId)
        .gte('created_at', `${from}T00:00:00`)
        .lte('created_at', `${to}T23:59:59`),
      supabase
        .from('contractor_payouts')
        .select('total_amount, payout_status, payout_date, created_at')
        .eq('company_id', companyId),
      supabase
        .from('payment_approvals')
        .select('gross_pay, period_start')
        .eq('company_id', companyId)
        .gte('period_start', from)
        .lte('period_start', to),
    ])

  const inv = invoices ?? []
  const sup = supplierInvs ?? []
  const pay = payouts ?? []
  const pr = payroll ?? []

  const revenue = inv
    .filter(i => i.status !== 'cancelled' && i.status !== 'draft')
    .reduce((s, i) => s + Number(i.total_amount ?? 0), 0)
  const outstanding = inv
    .filter(i => ['sent', 'viewed', 'partially_paid', 'overdue'].includes(String(i.status)))
    .reduce((s, i) => s + Number(i.balance_due ?? 0), 0)
  const supplierPayables = sup
    .filter(i => !['paid', 'cancelled'].includes(String(i.status)))
    .reduce((s, i) => s + Number(i.balance_due ?? i.total_amount ?? 0), 0)
  const contractorPayables = pay
    .filter(p => ['pending', 'approved'].includes(String(p.payout_status)))
    .reduce((s, p) => s + Number(p.total_amount ?? 0), 0)
  const payables = supplierPayables + contractorPayables
  const expenses =
    sup.reduce((s, i) => s + Number(i.total_amount ?? 0), 0) +
    pay
      .filter(p => {
        const d = p.payout_date ?? (p.created_at as string)?.slice(0, 10)
        return d && d >= from && d <= to
      })
      .reduce((s, p) => s + Number(p.total_amount ?? 0), 0) +
    pr.reduce((s, p) => s + Number(p.gross_pay ?? 0), 0)
  const profit = revenue - expenses

  const byMonth = new Map<string, { revenue: number; expenses: number }>()
  for (const i of inv) {
    if (!i.issue_date) continue
    const label = monthLabel(String(i.issue_date))
    const row = byMonth.get(label) ?? { revenue: 0, expenses: 0 }
    row.revenue += Number(i.total_amount ?? 0)
    byMonth.set(label, row)
  }
  for (const i of sup) {
    const label = monthLabel(String(i.created_at ?? from))
    const row = byMonth.get(label) ?? { revenue: 0, expenses: 0 }
    row.expenses += Number(i.total_amount ?? 0)
    byMonth.set(label, row)
  }

  const revenue_vs_expenses = Array.from(byMonth.entries()).flatMap(([label, v]) => [
    { label: `${label} Rev`, value: v.revenue },
    { label: `${label} Exp`, value: v.expenses },
  ])

  return {
    revenue,
    outstanding,
    payables,
    profit,
    revenue_vs_expenses,
  }
}

async function buildIncidents(
  supabase: SupabaseClient,
  companyId: string,
  from: string,
  to: string,
): Promise<ReportSnapshot> {
  const { data } = await supabase
    .from('incident_reports')
    .select('id, description, severity, status, is_closed, created_at')
    .eq('company_id', companyId)
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`)
    .order('created_at', { ascending: false })

  const rows = data ?? []
  const open = rows.filter(r => !r.is_closed && !['resolved', 'closed'].includes(String(r.status ?? ''))).length
  const resolved = rows.filter(r => r.is_closed || ['resolved', 'closed'].includes(String(r.status ?? ''))).length
  const critical = rows.filter(r => String(r.severity).toLowerCase() === 'critical').length
  const recent = rows.slice(0, 10).map(r => ({
    description: r.description,
    severity: r.severity,
    status: r.is_closed ? 'closed' : (r.status ?? 'open'),
  }))

  return { open, resolved, critical, recent }
}

async function buildInventory(
  supabase: SupabaseClient,
  companyId: string,
  from: string,
  to: string,
): Promise<ReportSnapshot> {
  const [{ data: items }, { data: usage }, { data: allocs }] = await Promise.all([
    supabase
      .from('inventory_items')
      .select('id, name, quantity_on_hand, unit_cost, reorder_level')
      .eq('company_id', companyId),
    supabase
      .from('inventory_usage')
      .select('inventory_item_id, quantity_used, used_at')
      .eq('company_id', companyId)
      .gte('used_at', `${from}T00:00:00`)
      .lte('used_at', `${to}T23:59:59`),
    supabase
      .from('inventory_allocations')
      .select('id')
      .eq('company_id', companyId)
      .limit(500),
  ])

  const list = items ?? []
  const total_items = list.length
  const low_stock = list.filter(
    i => Number(i.quantity_on_hand ?? 0) <= Number(i.reorder_level ?? 0),
  ).length
  const stock_value = list.reduce(
    (s, i) => s + Number(i.quantity_on_hand ?? 0) * Number(i.unit_cost ?? 0),
    0,
  )
  const on_jobs = (allocs ?? []).length || (usage ?? []).length

  const top_items = [...list]
    .map(i => ({
      name: i.name as string,
      qty: Number(i.quantity_on_hand ?? 0),
      value: Number(i.quantity_on_hand ?? 0) * Number(i.unit_cost ?? 0),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  return { total_items, low_stock, stock_value, on_jobs, top_items }
}

async function buildContractors(
  supabase: SupabaseClient,
  companyId: string,
  _from: string,
  _to: string,
): Promise<ReportSnapshot> {
  const [{ data: contractors }, { data: payouts }, { data: assignments }, { data: docs }] =
    await Promise.all([
      supabase
        .from('contractors')
        .select('id, name, is_active, compliance_hold')
        .eq('company_id', companyId),
      supabase
        .from('contractor_payouts')
        .select('contractor_id, total_amount, payout_status')
        .eq('company_id', companyId),
      supabase
        .from('job_contractors')
        .select('contractor_id, agreed_amount')
        .eq('company_id', companyId),
      supabase
        .from('contractor_documents')
        .select('contractor_id, status, expiry_date')
        .eq('company_id', companyId),
    ])

  const ct = contractors ?? []
  const active = ct.filter(c => c.is_active).length
  const pending_payments = (payouts ?? []).filter(p =>
    ['pending', 'approved'].includes(String(p.payout_status)),
  ).length

  const now = new Date()
  const in30 = new Date(); in30.setDate(in30.getDate() + 30)
  const pendingDocContractors = new Set(
    (docs ?? [])
      .filter(d => {
        const st = String(d.status ?? '').toLowerCase()
        if (st === 'pending' || st === 'expired' || st === 'rejected') return true
        if (d.expiry_date) {
          const exp = new Date(String(d.expiry_date))
          return exp <= in30
        }
        return false
      })
      .map(d => d.contractor_id as string),
  )
  const holdCount = ct.filter(c => c.compliance_hold).length
  const pending_compliance = Math.max(pendingDocContractors.size, holdCount)

  const nameById = new Map(ct.map(c => [c.id as string, c.name as string]))
  const agreedBy = new Map<string, number>()
  for (const a of assignments ?? []) {
    const id = a.contractor_id as string
    agreedBy.set(id, (agreedBy.get(id) ?? 0) + Number(a.agreed_amount ?? 0))
  }
  const paidBy = new Map<string, number>()
  for (const p of payouts ?? []) {
    if (String(p.payout_status) !== 'paid') continue
    const id = p.contractor_id as string
    paidBy.set(id, (paidBy.get(id) ?? 0) + Number(p.total_amount ?? 0))
  }

  const payment_summary = ct
    .filter(c => c.is_active)
    .map(c => ({
      name: nameById.get(c.id as string) ?? 'Contractor',
      agreed: agreedBy.get(c.id as string) ?? 0,
      paid: paidBy.get(c.id as string) ?? 0,
    }))
    .sort((a, b) => b.agreed - a.agreed)
    .slice(0, 20)

  return { active, pending_compliance, pending_payments, payment_summary }
}

async function buildProperty(
  supabase: SupabaseClient,
  companyId: string,
): Promise<ReportSnapshot> {
  const [{ data: sites }, { data: units }, { data: residents }, { data: compliance }] =
    await Promise.all([
      supabase.from('sites').select('id').eq('company_id', companyId),
      supabase.from('units').select('id, is_occupied, site_id').eq('company_id', companyId),
      supabase
        .from('residents')
        .select('id, move_out_date, site_id')
        .eq('company_id', companyId),
      supabase
        .from('compliance_entries')
        .select('id, expiry_date, site_id')
        .eq('company_id', companyId),
    ])

  const unitList = units ?? []
  const occupied_units = unitList.filter(u => u.is_occupied === true).length
  const vacantFromFlag = unitList.filter(u => u.is_occupied === false).length
  const activeResidents = (residents ?? []).filter(r => !r.move_out_date).length
  // If is_occupied unused, approximate occupancy from residents vs units
  const occupied = occupied_units > 0
    ? occupied_units
    : Math.min(activeResidents, unitList.length)
  const vacant = vacantFromFlag > 0
    ? vacantFromFlag
    : Math.max(0, unitList.length - occupied)

  const in30 = new Date(); in30.setDate(in30.getDate() + 30)
  const expiring_compliance = (compliance ?? []).filter(c => {
    if (!c.expiry_date) return false
    const exp = new Date(String(c.expiry_date))
    return exp <= in30
  }).length

  return {
    total_sites: (sites ?? []).length,
    occupied_units: occupied,
    vacant,
    expiring_compliance,
  }
}

async function buildTelemetry(
  supabase: SupabaseClient,
  companyId: string,
  from: string,
  to: string,
): Promise<ReportSnapshot> {
  const { data: events, error } = await supabase
    .from('app_events')
    .select('id, event_type, severity, created_at')
    .eq('company_id', companyId)
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`)
    .limit(500)

  if (error || !events) {
    // Fallback: audit_events volume as a coarse health signal
    const { data: audit } = await supabase
      .from('audit_events')
      .select('id, created_at')
      .eq('company_id', companyId)
      .gte('created_at', `${from}T00:00:00`)
      .lte('created_at', `${to}T23:59:59`)
      .limit(200)

    return {
      realtime_status: 'online',
      offline_queue: 0,
      error_rate: 0,
      active_connections: 1,
      event_count: (audit ?? []).length,
    }
  }

  const total = events.length
  const errors = events.filter(e => {
    const sev = String(e.severity ?? e.event_type ?? '').toLowerCase()
    return sev.includes('error') || sev.includes('fail') || sev === 'critical'
  }).length
  const error_rate = total > 0 ? Math.round((errors / total) * 1000) / 10 : 0

  return {
    realtime_status: 'online',
    offline_queue: 0,
    error_rate,
    active_connections: 1,
    event_count: total,
  }
}

/** Raw table rows for CSV exports (MAUI ExportAsync parity). */
export async function fetchIncidentsExportRows(
  supabase: SupabaseClient,
  companyId: string,
  from: string,
  to: string,
) {
  const { data } = await supabase
    .from('incident_reports')
    .select('description, severity, status, is_closed, created_at, employees(name, surname)')
    .eq('company_id', companyId)
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`)
    .order('created_at', { ascending: false })
  return data ?? []
}

export async function fetchInventoryExportRows(
  supabase: SupabaseClient,
  companyId: string,
) {
  const { data } = await supabase
    .from('inventory_items')
    .select('name, sku, quantity_on_hand, unit_cost, reorder_level, supplier')
    .eq('company_id', companyId)
    .order('name')
  return data ?? []
}

export async function fetchJobsExportRows(
  supabase: SupabaseClient,
  companyId: string,
  from: string,
  to: string,
) {
  const { data } = await supabase
    .from('jobs')
    .select('title, status, priority, scheduled_start, scheduled_end, estimated_cost, clients(name)')
    .eq('company_id', companyId)
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`)
    .order('created_at', { ascending: false })
  return data ?? []
}

export async function fetchPaymentsExportRows(
  supabase: SupabaseClient,
  companyId: string,
  from: string,
  to: string,
) {
  const { data } = await supabase
    .from('payment_approvals')
    .select('gross_pay, net_pay, status, period_start, period_end, employees(name, surname)')
    .eq('company_id', companyId)
    .gte('period_start', from)
    .lte('period_start', to)
    .order('period_start', { ascending: false })
  return data ?? []
}
