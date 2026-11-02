/** Shapes returned by the insights_* database functions (supabase/migrations/20261102090000_insights.sql). */

export type Period = { from: string; to: string; prev_from: string; prev_to: string }

export type PeopleKpis = {
  headcount: number; work_days: number; present_days: number; expected_days: number
  attendance_rate: number | null; absent_days: number; late_days: number; late_rate: number | null
  avg_minutes_late: number | null; hours: number; overtime_hours: number; leave_days: number
}
export type PeopleDay = { d: string; present: number; late: number; hours: number; overtime: number }
export type PeopleGroup = { name: string; headcount: number; present_days: number; late_days: number; hours: number; overtime: number }
export type PeoplePerson = { employee_id: string; name: string; department: string | null; late_days?: number; minutes_late?: number; overtime?: number }

export type PeopleResult = {
  kpis: PeopleKpis; previous: PeopleKpis; period: Period
  daily: PeopleDay[]; by_department: PeopleGroup[]; by_branch: PeopleGroup[]
  leave_by_type: { type: string; days: number }[]
  top_late: PeoplePerson[]; top_overtime: PeoplePerson[]
  on_site_now: number; pending_leave: number; branches: string[]; departments: string[]
}

export type JobsKpis = {
  opened: number; completed: number; cancelled: number; completed_value: number
  on_time_rate: number | null; callback_rate: number | null
  avg_days_to_complete: number | null; avg_hours_to_respond: number | null
}
export type JobsResult = {
  kpis: JobsKpis; previous: JobsKpis; period: Period
  weekly: { week: string; opened: number; completed: number }[]
  by_client: { name: string; value: number; opened: number; completed: number }[]
  by_service: { name: string; opened: number; completed: number }[]
  by_priority: { name: string; opened: number; avg_days: number | null }[]
  by_technician: { employee_id: string; name: string; department: string | null; completed: number; avg_days: number | null; callbacks: number; value: number }[]
  status_now: { name: string; count: number }[]
  open_now: number; overdue_now: number; unassigned_now: number
}

export type MoneyKpis = {
  invoiced: number; invoices: number; collected: number; avg_days_to_pay: number | null
  quotes_sent: number; quotes_sent_value: number; quotes_won: number; quotes_won_value: number
  quotes_lost: number; win_rate: number | null
}
export type MoneyPoint = { invoiced: number; collected: number; won: number }
export type Debtor = {
  client_id: string | null; name: string; total: number; current: number
  d30: number; d60: number; d90: number; d90plus: number; invoices: number; oldest_days: number
}
export type Ageing = { outstanding: number; overdue: number; buckets: { name: string; amount: number }[]; debtors: Debtor[] }
export type MoneyResult = {
  kpis: MoneyKpis; previous: MoneyKpis; period: Period
  monthly: (MoneyPoint & { month: string })[]
  weekly: (MoneyPoint & { week: string })[]
  by_client: { name: string; invoiced: number; invoices: number; paid: number }[]
  quote_status: { name: string; count: number; value: number }[]
  lost_reasons: { name: string; count: number }[]
  ageing: Ageing; pipeline_now: number
}

export type PayrollKpis = {
  gross: number; net: number; deductions: number; overtime_pay: number; overtime_hours: number
  payslips: number; people: number; avg_gross: number | null; pending: number; approved: number; paid: number
}
export type PayrollResult = {
  kpis: PayrollKpis; previous: PayrollKpis; period: Period
  monthly: { month: string; gross: number; net: number; deductions: number; overtime_pay: number; people: number }[]
  by_department: { name: string; people: number; gross: number; net: number; overtime_pay: number; overtime_hours: number }[]
  by_branch: { name: string; people: number; gross: number; overtime_pay: number }[]
  branches: string[]; departments: string[]
}

export type HomeResult = {
  period: Period
  people: { kpis: PeopleKpis; previous: PeopleKpis; daily: PeopleDay[] }
  jobs: { kpis: JobsKpis; previous: JobsKpis; weekly: JobsResult['weekly']; open_now: number; overdue_now: number; by_client?: JobsResult['by_client'] }
  money: { kpis: MoneyKpis; previous: MoneyKpis; monthly: MoneyResult['monthly']; weekly?: MoneyResult['weekly']; ageing: Pick<Ageing, 'outstanding' | 'overdue' | 'buckets'> }
  payroll: { kpis: PayrollKpis; previous: PayrollKpis; monthly: PayrollResult['monthly'] }
  incidents: { open_now: number; previous: number; reported: number; by_severity: { name: string; count: number }[] }
  on_site_now: number
}

export type RegisterRow = {
  employee_id: string; code: string | null; name: string; department: string | null; branch: string | null
  present_days: number; late_days: number; minutes_late: number; absent_days: number; leave_days: number
  hours: number; overtime: number
}
export type LateRow = {
  d: string; employee_id: string; name: string; department: string | null; branch: string | null
  shift_start: string; clocked_in: string; minutes_late: number
}
export type CompletedJobRow = {
  id: string; code: string | null; title: string; client: string | null; technician: string | null
  service: string | null; priority: string | null; opened: string | null; closed: string | null
  days: number | null; on_time: boolean | null; callback: boolean | null; value: number | null
}
