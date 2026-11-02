/**
 * The report library. Each report loads its rows from an insights_* database function (which checks
 * the person may see this company) and describes its tables once, for screen, CSV and PDF.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { count, hours, money, moneyShort, pct } from '@/lib/insights/format'
import type { PdfKpi } from '@/lib/insights/pdf'
import type { TableSpec } from '@/lib/insights/table'
import type {
  CompletedJobRow, JobsResult, LateRow, MoneyResult, PayrollResult, PeopleResult, RegisterRow,
} from '@/lib/insights/types'

export type ReportFilters = { from: string; to: string; branch: string; department: string }
export type ReportOutput = { kpis?: PdfKpi[]; tables: TableSpec<any>[]; options?: { branches: string[]; departments: string[] } } // eslint-disable-line @typescript-eslint/no-explicit-any

export type ReportDef = {
  key: string
  title: string
  description: string
  section: 'People' | 'Jobs' | 'Money' | 'Payroll'
  icon: string
  /** Uses the site and department filters. */
  org?: boolean
  /** Shows the position today rather than for the period. */
  asAt?: boolean
  load: (sb: SupabaseClient, companyId: string, f: ReportFilters) => Promise<ReportOutput>
}

async function call<T>(sb: SupabaseClient, fn: string, companyId: string, f: ReportFilters, org: boolean): Promise<T> {
  const args: Record<string, unknown> = { p_company_id: companyId, p_from: f.from, p_to: f.to }
  if (org) { args.p_branch = f.branch || null; args.p_department = f.department || null }
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

const sum = <T,>(rows: T[], key: keyof T) => Math.round(rows.reduce((a, r) => a + (Number(r[key]) || 0), 0) * 100) / 100

/** Site and department lists for the filter, from the cheap payroll call when a report has none. */
async function orgOptions(sb: SupabaseClient, companyId: string, f: ReportFilters) {
  const p = await call<PayrollResult>(sb, 'insights_payroll', companyId, { ...f, branch: '', department: '' }, true)
  return { branches: p.branches ?? [], departments: p.departments ?? [] }
}

export const REPORTS: ReportDef[] = [
  {
    key: 'attendance-register',
    title: 'Attendance register',
    description: 'Every person: days at work, late days, absences, leave, hours and overtime.',
    section: 'People', icon: 'fact_check', org: true,
    async load(sb, id, f) {
      const [rows, options] = await Promise.all([call<RegisterRow[]>(sb, 'insights_attendance_register', id, f, true), orgOptions(sb, id, f)])
      const r = rows ?? []
      return {
        options,
        kpis: [
          { label: 'People', value: count(r.length) },
          { label: 'Days at work', value: count(sum(r, 'present_days')) },
          { label: 'Late days', value: count(sum(r, 'late_days')) },
          { label: 'Hours worked', value: hours(sum(r, 'hours')) },
        ],
        tables: [{
          title: 'Attendance register',
          columns: [
            { key: 'code', label: 'No.', width: 0.8 },
            { key: 'name', label: 'Name', width: 1.8 },
            { key: 'department', label: 'Department', width: 1.5 },
            { key: 'branch', label: 'Site', width: 1.6 },
            { key: 'present_days', label: 'At work', kind: 'count', width: 0.8 },
            { key: 'late_days', label: 'Late', kind: 'count', width: 0.7 },
            { key: 'minutes_late', label: 'Min late', kind: 'count', width: 0.8 },
            { key: 'absent_days', label: 'Absent', kind: 'count', width: 0.8 },
            { key: 'leave_days', label: 'Leave', kind: 'count', width: 0.7 },
            { key: 'hours', label: 'Hours', kind: 'hours', width: 0.9 },
            { key: 'overtime', label: 'Overtime', kind: 'hours', width: 0.9 },
          ],
          rows: r,
          totals: {
            present_days: sum(r, 'present_days'), late_days: sum(r, 'late_days'), minutes_late: sum(r, 'minutes_late'),
            absent_days: sum(r, 'absent_days'), leave_days: sum(r, 'leave_days'), hours: sum(r, 'hours'), overtime: sum(r, 'overtime'),
          },
          note: 'A work day is a weekday when at least a fifth of the team clocked in. Late means more than 5 minutes after the shift start.',
        } satisfies TableSpec<RegisterRow>],
      }
    },
  },
  {
    key: 'late-arrivals',
    title: 'Late arrivals',
    description: 'Each late clock-in: who, when, their shift start and how many minutes late.',
    section: 'People', icon: 'schedule', org: true,
    async load(sb, id, f) {
      const [rows, options] = await Promise.all([call<LateRow[]>(sb, 'insights_late_arrivals', id, f, true), orgOptions(sb, id, f)])
      const r = rows ?? []
      const people = new Set(r.map(x => x.employee_id)).size
      return {
        options,
        kpis: [
          { label: 'Late arrivals', value: count(r.length) },
          { label: 'People', value: count(people) },
          { label: 'Minutes late in total', value: count(sum(r, 'minutes_late')) },
          { label: 'Average minutes late', value: r.length ? count(Math.round(sum(r, 'minutes_late') / r.length)) : '—' },
        ],
        tables: [{
          title: 'Late arrivals',
          columns: [
            { key: 'd', label: 'Day', kind: 'day', width: 1.1 },
            { key: 'name', label: 'Name', width: 1.8 },
            { key: 'department', label: 'Department', width: 1.5 },
            { key: 'branch', label: 'Site', width: 1.6 },
            { key: 'shift_start', label: 'Shift starts', width: 0.9 },
            { key: 'clocked_in', label: 'Clocked in', width: 0.9 },
            { key: 'minutes_late', label: 'Minutes late', kind: 'count', width: 0.9 },
          ],
          rows: r,
          note: r.length >= 2000 ? 'Showing the first 2 000 late arrivals. Pick a shorter period, a site or a department to see the rest.' : undefined,
        } satisfies TableSpec<LateRow>],
      }
    },
  },
  {
    key: 'overtime-by-department',
    title: 'Overtime and hours by department',
    description: 'Hours, overtime and lateness for each department and site, and who worked the most overtime.',
    section: 'People', icon: 'more_time', org: true,
    async load(sb, id, f) {
      const d = await call<PeopleResult>(sb, 'insights_people', id, f, true)
      const groupCols = (first: string) => [
        { key: 'name', label: first, width: 2 },
        { key: 'headcount', label: 'People', kind: 'count' as const },
        { key: 'present_days', label: 'Days at work', kind: 'count' as const },
        { key: 'late_days', label: 'Late days', kind: 'count' as const },
        { key: 'hours', label: 'Hours', kind: 'hours' as const },
        { key: 'overtime', label: 'Overtime', kind: 'hours' as const },
      ]
      return {
        options: { branches: d.branches ?? [], departments: d.departments ?? [] },
        kpis: [
          { label: 'Hours worked', value: hours(d.kpis.hours) },
          { label: 'Overtime hours', value: hours(d.kpis.overtime_hours) },
          { label: 'Overtime share', value: d.kpis.hours ? pct((d.kpis.overtime_hours / d.kpis.hours) * 100) : '—' },
          { label: 'People', value: count(d.kpis.headcount) },
        ],
        tables: [
          { title: 'By department', columns: groupCols('Department'), rows: d.by_department, totals: { headcount: sum(d.by_department, 'headcount'), present_days: sum(d.by_department, 'present_days'), late_days: sum(d.by_department, 'late_days'), hours: sum(d.by_department, 'hours'), overtime: sum(d.by_department, 'overtime') } },
          { title: 'By site', columns: groupCols('Site'), rows: d.by_branch },
          { title: 'Most overtime', columns: [{ key: 'name', label: 'Person', width: 2 }, { key: 'department', label: 'Department', width: 1.6 }, { key: 'overtime', label: 'Overtime', kind: 'hours' }], rows: d.top_overtime },
        ],
      }
    },
  },
  {
    key: 'payroll-summary',
    title: 'Payroll summary',
    description: 'Gross, deductions and net pay by month, department and site.',
    section: 'Payroll', icon: 'payments', org: true,
    async load(sb, id, f) {
      const d = await call<PayrollResult>(sb, 'insights_payroll', id, f, true)
      const k = d.kpis
      return {
        options: { branches: d.branches ?? [], departments: d.departments ?? [] },
        kpis: [
          { label: 'Gross pay', value: moneyShort(k.gross) },
          { label: 'Deductions', value: moneyShort(k.deductions) },
          { label: 'Net pay', value: moneyShort(k.net) },
          { label: 'People paid', value: count(k.people), sub: `${count(k.payslips)} payslips` },
        ],
        tables: [
          {
            title: 'By month',
            columns: [
              { key: 'month', label: 'Month', kind: 'day' }, { key: 'people', label: 'People', kind: 'count' },
              { key: 'gross', label: 'Gross', kind: 'money', width: 1.3 }, { key: 'deductions', label: 'Deductions', kind: 'money', width: 1.3 },
              { key: 'net', label: 'Net', kind: 'money', width: 1.3 }, { key: 'overtime_pay', label: 'Overtime pay', kind: 'money', width: 1.2 },
            ],
            rows: d.monthly,
            totals: { gross: k.gross, deductions: k.deductions, net: k.net, overtime_pay: k.overtime_pay },
          },
          {
            title: 'By department',
            columns: [
              { key: 'name', label: 'Department', width: 2 }, { key: 'people', label: 'People', kind: 'count' },
              { key: 'gross', label: 'Gross', kind: 'money', width: 1.3 }, { key: 'net', label: 'Net', kind: 'money', width: 1.3 },
              { key: 'overtime_pay', label: 'Overtime pay', kind: 'money', width: 1.2 }, { key: 'overtime_hours', label: 'Overtime hours', kind: 'hours' },
            ],
            rows: d.by_department,
            totals: { people: k.people, gross: k.gross, net: k.net, overtime_pay: k.overtime_pay, overtime_hours: k.overtime_hours },
          },
          {
            title: 'By site',
            columns: [
              { key: 'name', label: 'Site', width: 2 }, { key: 'people', label: 'People', kind: 'count' },
              { key: 'gross', label: 'Gross', kind: 'money', width: 1.3 }, { key: 'overtime_pay', label: 'Overtime pay', kind: 'money', width: 1.2 },
            ],
            rows: d.by_branch,
            totals: { people: k.people, gross: k.gross, overtime_pay: k.overtime_pay },
            note: 'Each payslip counts in the period its pay period ends. Rejected payslips are left out.',
          },
        ],
      }
    },
  },
  {
    key: 'jobs-completed',
    title: 'Jobs completed',
    description: 'Every job finished in the period with client, technician, days taken, on time and value.',
    section: 'Jobs', icon: 'task_alt',
    async load(sb, id, f) {
      const rows = (await call<CompletedJobRow[]>(sb, 'insights_jobs_completed', id, f, false)) ?? []
      const onTime = rows.filter(r => r.on_time === true).length
      const withPlan = rows.filter(r => r.on_time != null).length
      return {
        kpis: [
          { label: 'Jobs completed', value: count(rows.length) },
          { label: 'Value', value: moneyShort(sum(rows, 'value')) },
          { label: 'Finished on time', value: withPlan ? pct((onTime / withPlan) * 100) : '—' },
          { label: 'Callbacks', value: count(rows.filter(r => r.callback).length) },
        ],
        tables: [{
          title: 'Jobs completed',
          columns: [
            { key: 'code', label: 'Job', width: 0.9 },
            { key: 'title', label: 'Title', width: 2 },
            { key: 'client', label: 'Client', width: 1.6 },
            { key: 'technician', label: 'Technician', width: 1.3 },
            { key: 'service', label: 'Service', width: 1.1 },
            { key: 'priority', label: 'Priority', kind: 'words', width: 0.8 },
            { key: 'opened', label: 'Opened', kind: 'day', width: 1 },
            { key: 'closed', label: 'Closed', kind: 'day', width: 1 },
            { key: 'days', label: 'Days', kind: 'count', width: 0.6, get: r => (r.days == null ? null : Math.round(r.days * 10) / 10) },
            { key: 'on_time', label: 'On time', kind: 'yesno', width: 0.7 },
            { key: 'callback', label: 'Callback', kind: 'yesno', width: 0.7 },
            { key: 'value', label: 'Value', kind: 'money', width: 1.2 },
          ],
          rows,
          totals: { value: sum(rows, 'value') },
        } satisfies TableSpec<CompletedJobRow>],
      }
    },
  },
  {
    key: 'technician-productivity',
    title: 'Technician productivity',
    description: 'Jobs each technician completed, how long they took, callbacks and the value of the work.',
    section: 'Jobs', icon: 'engineering',
    async load(sb, id, f) {
      const d = await call<JobsResult>(sb, 'insights_jobs', id, f, false)
      return {
        kpis: [
          { label: 'Jobs completed', value: count(d.kpis.completed) },
          { label: 'Technicians', value: count(d.by_technician.length) },
          { label: 'Average days to complete', value: d.kpis.avg_days_to_complete == null ? '—' : String(d.kpis.avg_days_to_complete) },
          { label: 'Callback rate', value: pct(d.kpis.callback_rate) },
        ],
        tables: [{
          title: 'Technician productivity',
          columns: [
            { key: 'name', label: 'Technician', width: 2 }, { key: 'department', label: 'Department', width: 1.6 },
            { key: 'completed', label: 'Completed', kind: 'count' }, { key: 'avg_days', label: 'Average days', kind: 'days' },
            { key: 'callbacks', label: 'Callbacks', kind: 'count' }, { key: 'value', label: 'Value', kind: 'money', width: 1.3 },
          ],
          rows: d.by_technician,
          totals: { completed: sum(d.by_technician, 'completed'), callbacks: sum(d.by_technician, 'callbacks'), value: sum(d.by_technician, 'value') },
          note: 'Counts the lead technician on each completed job.',
        }],
      }
    },
  },
  {
    key: 'debtors-ageing',
    title: 'Debtors ageing',
    description: 'Who owes you money today and how long it has been owed.',
    section: 'Money', icon: 'hourglass_top', asAt: true,
    async load(sb, id, f) {
      const d = await call<MoneyResult>(sb, 'insights_money', id, f, false)
      const r = d.ageing.debtors
      return {
        kpis: [
          { label: 'Owed to you', value: moneyShort(d.ageing.outstanding) },
          { label: 'Overdue', value: moneyShort(d.ageing.overdue) },
          { label: 'Over 90 days', value: moneyShort(sum(r, 'd90plus')) },
          { label: 'Clients owing', value: count(r.length) },
        ],
        tables: [{
          title: 'Debtors ageing',
          columns: [
            { key: 'name', label: 'Client', width: 2.2 },
            { key: 'invoices', label: 'Invoices', kind: 'count', width: 0.8 },
            { key: 'current', label: 'Not yet due', kind: 'money', width: 1.2 },
            { key: 'd30', label: '1–30 days', kind: 'money', width: 1.1 },
            { key: 'd60', label: '31–60 days', kind: 'money', width: 1.1 },
            { key: 'd90', label: '61–90 days', kind: 'money', width: 1.1 },
            { key: 'd90plus', label: '90+ days', kind: 'money', width: 1.1 },
            { key: 'total', label: 'Total', kind: 'money', width: 1.2 },
            { key: 'oldest_days', label: 'Oldest (days)', kind: 'count', width: 0.9 },
          ],
          rows: r,
          totals: { invoices: sum(r, 'invoices'), current: sum(r, 'current'), d30: sum(r, 'd30'), d60: sum(r, 'd60'), d90: sum(r, 'd90'), d90plus: sum(r, 'd90plus'), total: sum(r, 'total') },
          note: 'Customer invoices that are sent, part-paid or overdue. Age counts from the due date.',
        }],
      }
    },
  },
  {
    key: 'sales-by-client',
    title: 'Sales by client',
    description: 'What each client was invoiced and has paid, and the jobs done for them.',
    section: 'Money', icon: 'storefront',
    async load(sb, id, f) {
      const [m, j] = await Promise.all([
        call<MoneyResult>(sb, 'insights_money', id, f, false),
        call<JobsResult>(sb, 'insights_jobs', id, f, false),
      ])
      return {
        kpis: [
          { label: 'Invoiced', value: moneyShort(m.kpis.invoiced) },
          { label: 'Collected', value: moneyShort(m.kpis.collected) },
          { label: 'Invoices', value: count(m.kpis.invoices) },
          { label: 'Clients invoiced', value: count(m.by_client.length) },
        ],
        tables: [
          {
            title: 'Invoiced by client',
            columns: [
              { key: 'name', label: 'Client', width: 2.4 }, { key: 'invoices', label: 'Invoices', kind: 'count' },
              { key: 'invoiced', label: 'Invoiced', kind: 'money', width: 1.3 }, { key: 'paid', label: 'Paid so far', kind: 'money', width: 1.3 },
            ],
            rows: m.by_client,
            totals: { invoices: sum(m.by_client, 'invoices'), invoiced: sum(m.by_client, 'invoiced'), paid: sum(m.by_client, 'paid') },
            note: 'The 15 biggest clients by amount invoiced.',
          },
          {
            title: 'Jobs by client',
            columns: [
              { key: 'name', label: 'Client', width: 2.4 }, { key: 'opened', label: 'Opened', kind: 'count' },
              { key: 'completed', label: 'Completed', kind: 'count' }, { key: 'value', label: 'Completed value', kind: 'money', width: 1.4 },
            ],
            rows: j.by_client,
          },
        ],
      }
    },
  },
  {
    key: 'quote-win-rate',
    title: 'Quote win rate',
    description: 'Quotes sent, won and lost, where open quotes stand, and why work was lost.',
    section: 'Money', icon: 'emoji_events',
    async load(sb, id, f) {
      const m = await call<MoneyResult>(sb, 'insights_money', id, f, false)
      const k = m.kpis
      return {
        kpis: [
          { label: 'Win rate', value: pct(k.win_rate), sub: `${count(k.quotes_won)} won · ${count(k.quotes_lost)} lost` },
          { label: 'Quotes sent', value: moneyShort(k.quotes_sent_value), sub: `${count(k.quotes_sent)} quotes` },
          { label: 'Quotes won', value: moneyShort(k.quotes_won_value) },
          { label: 'Open quotes now', value: moneyShort(m.pipeline_now) },
        ],
        tables: [
          {
            title: 'Quotes made in the period, by where they are now',
            columns: [{ key: 'name', label: 'Status', kind: 'words', width: 2 }, { key: 'count', label: 'Quotes', kind: 'count' }, { key: 'value', label: 'Value', kind: 'money' }],
            rows: m.quote_status,
            totals: { count: sum(m.quote_status, 'count'), value: sum(m.quote_status, 'value') },
          },
          {
            title: 'Why quotes were lost',
            columns: [{ key: 'name', label: 'Reason', width: 3 }, { key: 'count', label: 'Quotes', kind: 'count' }],
            rows: m.lost_reasons,
            note: `Win rate = quotes won ÷ quotes won or lost in the period. Sent in the period: ${money(k.quotes_sent_value)}.`,
          },
        ],
      }
    },
  },
]

export const SECTION_ORDER: ReportDef['section'][] = ['People', 'Jobs', 'Money', 'Payroll']
