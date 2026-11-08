/**
 * Workforce Action Centre — pending registrations, leave, and payslips.
 * Uses the same queues already shown on Employees / Leave / Payroll pages.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadScopedEmployeeIds } from '@/lib/employee-scope'
import type { HrNavFlags } from '@/lib/company-modules'

export type WorkforceActionDomain = 'registrations' | 'leave' | 'payslips'

export type WorkforceActionItem = {
  key: string
  domain: WorkforceActionDomain
  action_type: string
  title: string
  summary: string
  created_at: string | null
  ref_id: string
  entity_id: string
}

export const WORKFORCE_ACTION_TABS: { id: WorkforceActionDomain; label: string }[] = [
  { id: 'registrations', label: 'Registrations' },
  { id: 'leave', label: 'Leave' },
  { id: 'payslips', label: 'Payslips' },
]

export const WORKFORCE_ACTION_TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  registration_pending: { bg: '#DBEAFE', fg: '#1E40AF' },
  leave_pending: { bg: '#FEF3C7', fg: '#92400E' },
  payslip_pending: { bg: '#FEE2E2', fg: '#991B1B' },
}

export function workforceActionColor(actionType: string) {
  return WORKFORCE_ACTION_TYPE_COLORS[actionType] ?? { bg: '#E5E7EB', fg: '#374151' }
}

export function visibleWorkforceActionDomains(flags: HrNavFlags): WorkforceActionDomain[] {
  const out: WorkforceActionDomain[] = []
  if (flags.employees) out.push('registrations')
  if (flags.leave) out.push('leave')
  if (flags.payroll) out.push('payslips')
  return out
}

export async function loadWorkforceActionItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  companyId: string,
  employeeId: string,
  domains: WorkforceActionDomain[],
): Promise<Record<WorkforceActionDomain, WorkforceActionItem[]>> {
  const empty: Record<WorkforceActionDomain, WorkforceActionItem[]> = {
    registrations: [],
    leave: [],
    payslips: [],
  }
  if (domains.length === 0) return empty

  const tasks: Promise<void>[] = []

  if (domains.includes('registrations')) {
    tasks.push((async () => {
      try {
        const { data, error } = await supabase
          .from('employees')
          .select('id, name, surname, email, created_at')
          .eq('company_id', companyId)
          .eq('registration_status', 'pending')
          .order('created_at', { ascending: false })
          .limit(40)
        if (error) {
          console.error('workforce AC registrations', error.message)
          return
        }
        empty.registrations = (data ?? []).map(row => {
          const name = [row.name, row.surname].filter(Boolean).join(' ').trim() || 'Employee'
          return {
            key: `registrations:${row.id}`,
            domain: 'registrations' as const,
            action_type: 'registration_pending',
            title: name,
            summary: row.email ? `Pending registration · ${row.email}` : 'Pending registration approval',
            created_at: (row.created_at as string | null) ?? null,
            ref_id: row.id as string,
            entity_id: row.id as string,
          }
        })
      } catch (err) {
        console.error('workforce AC registrations load failed', err)
      }
    })())
  }

  if (domains.includes('leave')) {
    tasks.push((async () => {
      try {
        const scopeRes = await loadScopedEmployeeIds(supabase, companyId, employeeId)
        const { data, error } = await supabase
          .from('leave_requests')
          .select('id, employee_id, leave_type, start_date, end_date, total_days, status, created_at, employees(name, surname, employee_number)')
          .eq('company_id', companyId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(60)
        if (error) {
          console.error('workforce AC leave', error.message)
          return
        }
        const ids = scopeRes.ok && !scopeRes.seesAll ? scopeRes.ids : null
        empty.leave = (data ?? [])
          .filter(row => !ids || ids.has(row.employee_id as string))
          .slice(0, 40)
          .map(row => {
            const emp = row.employees as { name?: string; surname?: string; employee_number?: string } | null
            const name = [emp?.name, emp?.surname].filter(Boolean).join(' ').trim() || 'Employee'
            const days = row.total_days != null ? `${row.total_days} day(s)` : ''
            const type = String(row.leave_type ?? 'Leave').replace(/_/g, ' ')
            return {
              key: `leave:${row.id}`,
              domain: 'leave' as const,
              action_type: 'leave_pending',
              title: name,
              summary: [type, days, row.start_date && row.end_date ? `${row.start_date} → ${row.end_date}` : null]
                .filter(Boolean)
                .join(' · '),
              created_at: (row.created_at as string | null) ?? null,
              ref_id: row.id as string,
              entity_id: row.employee_id as string,
            }
          })
      } catch (err) {
        console.error('workforce AC leave load failed', err)
      }
    })())
  }

  if (domains.includes('payslips')) {
    tasks.push((async () => {
      try {
        const { data, error } = await supabase
          .from('payment_approvals')
          .select('id, employee_id, period_start, period_end, status, created_at, net_pay, employee:employees(name, surname, employee_number)')
          .eq('company_id', companyId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(40)
        if (error) {
          // net_pay may not exist on all schemas — retry with a leaner select.
          console.error('workforce AC payslips', error.message)
          const retry = await supabase
            .from('payment_approvals')
            .select('id, employee_id, period_start, period_end, status, created_at, employee:employees(name, surname, employee_number)')
            .eq('company_id', companyId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(40)
          if (retry.error) {
            console.error('workforce AC payslips retry', retry.error.message)
            return
          }
          empty.payslips = (retry.data ?? []).map(row => mapPayslipRow(row))
          return
        }
        empty.payslips = (data ?? []).map(row => mapPayslipRow(row))
      } catch (err) {
        console.error('workforce AC payslips load failed', err)
      }
    })())
  }

  await Promise.all(tasks)
  return empty
}

function mapPayslipRow(row: Record<string, unknown>): WorkforceActionItem {
  const emp = row.employee as { name?: string; surname?: string; employee_number?: string } | null
  const name = [emp?.name, emp?.surname].filter(Boolean).join(' ').trim() || 'Employee'
  const period =
    row.period_start && row.period_end
      ? `${String(row.period_start).slice(0, 10)} → ${String(row.period_end).slice(0, 10)}`
      : 'Payslip pending approval'
  return {
    key: `payslips:${row.id}`,
    domain: 'payslips',
    action_type: 'payslip_pending',
    title: name,
    summary: period,
    created_at: (row.created_at as string | null) ?? null,
    ref_id: row.id as string,
    entity_id: row.id as string,
  }
}

export function openWorkforceActionItem(
  item: WorkforceActionItem,
  router: { push: (href: string) => void },
): void {
  if (item.domain === 'registrations') {
    router.push('/dashboard/employees?tab=pending')
    return
  }
  if (item.domain === 'leave') {
    router.push('/dashboard/leave')
    return
  }
  if (item.domain === 'payslips') {
    router.push(`/dashboard/payroll/${item.entity_id}`)
  }
}
