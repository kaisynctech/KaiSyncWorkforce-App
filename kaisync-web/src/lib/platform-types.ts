export type PlatformKpis = {
  total_companies: number
  total_employees: number
  active_users_today: number
  monthly_active_users: number
  monthly_revenue: number
  new_companies_this_month: number
  total_payroll_processed: number
  total_invoices_generated: number
  error_count: number
  pending_feedback: number
}

export type PlatformTrendPoint = { label: string; value: number }

export type PlatformDashboard = {
  kpis: PlatformKpis
  trends: {
    company_growth?: PlatformTrendPoint[]
    revenue_growth?: PlatformTrendPoint[]
    active_users_trend?: PlatformTrendPoint[]
    error_trend?: PlatformTrendPoint[]
  }
}

export type PlatformCompany = {
  id: string
  name: string
  code: string
  plan_code: string | null
  subscription_status: string
  employee_count: number
  employee_limit: number
  monthly_charge: number
  created_at: string
  subscription_active: boolean
}
