export type AccessLevel = 'owner' | 'manager' | 'hr' | 'employee'

export interface Employee {
  id: string
  company_id: string
  user_id: string | null
  name: string
  surname: string
  employee_code: string | null
  access_level: AccessLevel
  is_active: boolean
  department: string | null
  job_title: string | null
  position: string | null
  email: string | null
  phone: string | null
  id_number: string | null
  start_date: string | null
  employment_date: string | null
  employment_type: string | null
  worker_type: string | null
  hourly_rate: number | null
  monthly_salary: number | null
  daily_rate: number | null
  paye_rate: number | null
  exempt_from_uif: boolean
  medical_aid_deduction: number | null
  pension_deduction: number | null
  union_deduction: number | null
  work_days_per_week: number | null
  daily_hours: number | null
  pay_by_hour: boolean
  pay_basis: string | null
  manager_id: string | null
  branch_id: string | null
  shift_template_id: string | null
  bank_name: string | null
  bank_account: string | null
  bank_branch_code: string | null
  account_type: string | null
  profile_photo_url: string | null
  bank_details_updated_at: string | null
  bank_details_updated_by: string | null
  date_of_birth: string | null
  created_at: string
}

export interface Company {
  id: string
  name: string
  owner_user_id: string
  company_code: string | null
  industry: string | null
  size_range: string | null
  address: string | null
  enabled_modules?: Record<string, boolean> | null
  created_at: string
}

export interface Branch {
  id: string
  company_id: string
  name: string
  address: string | null
}

export interface BreakSlot {
  id: string
  label: string
  minutes: number
}

export interface ShiftTemplate {
  id: string
  company_id: string
  name: string
  summary: string | null
  start_time: string | null
  end_time: string | null
  days: string | null
  is_default: boolean
  breaks: BreakSlot[]
}

export interface Client {
  id: string
  company_id: string
  name: string
  code: string | null
  email: string | null
  phone: string | null
  address: string | null
  contact_person: string | null
  type: string | null
  notes: string | null
  created_at: string
}

export type JobStatus = 'open' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
export type JobPriority = 'low' | 'medium' | 'high'

export interface Site {
  id: string
  company_id: string
  client_id: string | null
  name: string
  address: string | null
  radius_meters?: number
  has_coordinates?: boolean
  latitude?: number | null
  longitude?: number | null
}

export interface Project {
  id: string
  company_id: string
  name: string
  code: string | null
  status: string | null
  client_id: string | null
  manager_id: string | null
  offer_amount: number | null
  paid_amount: number | null
  notes: string | null
  agreement_notes: string | null
  quotation_notes: string | null
  quotation_valid_until: string | null
  site_start_date: string | null
  expected_completion_date: string | null
  next_visit_date: string | null
  expected_close_date: string | null
  created_at: string
  clients?: { id: string; name: string } | null
  employees?: { id: string; name: string; surname: string } | null
}

export interface ProjectDocument {
  id: string
  project_id: string
  document_name: string
  document_type: string | null
  url: string
  storage_path: string
  created_at: string
}

export interface ProjectQuotationLine {
  id: string
  project_id: string
  description: string
  detail: string | null
  amount: number
  sort_order: number
}

export interface Job {
  id: string
  company_id: string
  title: string
  description: string | null
  status: JobStatus
  priority: JobPriority
  estimated_cost: number | null
  actual_cost: number | null
  labor_cost: number | null
  inventory_cost: number | null
  scheduled_start: string | null
  scheduled_end: string | null
  client_id: string | null
  site_id: string | null
  project_id: string | null
  address: string | null
  assigned_employee_id: string | null
  first_response_at: string | null
  closed_at: string | null
  created_at: string
  clients?: Pick<Client, 'name' | 'code'> | null
  sites?: Pick<Site, 'name' | 'address'> | null
  projects?: Pick<Project, 'name'> | null
}

export interface LeaveRequest {
  id: string
  company_id: string
  employee_id: string
  leave_type: string
  start_date: string
  end_date: string
  days_requested: number
  reason: string | null
  status: 'pending' | 'approved' | 'declined' | 'cancelled'
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  employees?: Pick<Employee, 'name' | 'surname' | 'employee_code'>
}

export interface TimePunch {
  id: string
  company_id: string
  employee_id: string
  type: 'in' | 'out'
  date_time: string
  latitude: number | null
  longitude: number | null
  address: string | null
  job_id: string | null
  notes: string | null
  created_at: string
  punched_by_manager_id: string | null
}

export interface SecuritySettings {
  id: string
  company_id: string
  step_up_required: boolean
  session_timeout_minutes: number
  lockout_threshold: number
  require_portal_code_for_punch: boolean
}

export interface CompanySettings {
  id: string
  company_id: string
  allow_self_punch: boolean
  overtime_threshold_hours: number
  pay_period: 'weekly' | 'fortnightly' | 'monthly'
  timezone: string
}

export interface AuditEvent {
  id: string
  company_id: string
  actor_user_id: string
  event_type: string
  target_table: string | null
  target_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface Contractor {
  id: string
  company_id: string
  name: string
  contractor_code: string | null
  partner_kind?: string | null
  is_supplier?: boolean
  contact_person: string | null
  phone: string | null
  email: string | null
  address: string | null
  tax_number: string | null
  is_vat_registered: boolean
  vat_number: string | null
  is_active: boolean
  rating: number
  notes: string | null
  contractor_code_expires_at: string | null
  compliance_pack: string | null
  bank_name: string | null
  bank_account: string | null
  account_holder_name: string | null
  branch_code: string | null
  account_type: string | null
  swift_bic: string | null
  payment_terms: string | null
  preferred_payment_method: string | null
  is_banking_verified: boolean
  payment_hold: boolean
  compliance_hold: boolean
  created_at: string
}

export interface ContractorTeamMember {
  id: string
  contractor_id: string
  employee_id: string
  role: string | null
  is_primary: boolean
  employees?: { name: string; surname: string } | null
}

export interface PendingBankingUpdate {
  id: string
  contractor_id: string
  account_holder_name: string | null
  bank_name: string | null
  bank_account: string | null
  account_type: string | null
  submitted_at: string
  status: 'pending' | 'approved' | 'rejected'
}

export interface JobContractor {
  id: string
  job_id: string
  contractor_id: string
  role: string | null
  agreed_amount: number | null
  paid_amount: number | null
  approved_amount: number | null
  has_compliance_hold: boolean
  contractors?: Pick<Contractor, 'name' | 'contractor_code'>
}

export interface LaborEntry {
  id: string
  job_id: string
  employee_id: string
  work_date: string
  hours: number
  total_cost: number
  employees?: Pick<Employee, 'name' | 'surname'>
}

export interface JobInventoryItem {
  id: string
  job_id: string
  name: string
  supplier: string | null
  quantity: number
  unit_cost: number
  total_cost: number
}

export interface InventoryItem {
  id: string
  name: string
  sku: string | null
  description: string | null
  unit_of_measure: string | null
  unit_cost: number
  selling_price: number | null
  quantity_on_hand: number
  reorder_level: number
  is_active: boolean
  needs_reorder: boolean
  stock_value: number
  supplier_id: string | null
  supplier?: { id: string; name: string }
}

export interface JobPhoto {
  id: string
  job_id: string
  url: string
  photo_type: 'before' | 'after'
  storage_path: string
  created_at: string
}

export interface JobMessage {
  id: string
  job_id: string
  body: string
  sender_id: string
  created_at: string
  employees?: Pick<Employee, 'name' | 'surname'>
}

export interface AppNotification {
  id: string
  company_id: string
  recipient_employee_id: string | null
  type: string | null
  title: string
  body: string
  is_read: boolean
  created_at: string
}

export interface IncidentReport {
  id: string
  company_id: string
  title: string | null
  description: string
  severity: string
  status: string
  category: string | null
  job_id: string | null
  deal_id: string | null
  contractor_id: string | null
  assigned_to: string | null
  resolution_notes: string | null
  created_at: string
  jobs?: { title: string } | null
  employees?: { name: string; surname: string } | null
}

export interface IncidentComment {
  id: string
  incident_id: string
  body: string
  author_id: string
  created_at: string
  employees?: { name: string; surname: string } | null
}

export interface PaymentApproval {
  id: string
  company_id: string
  period_start: string
  period_end: string
  gross_pay: number
  status: string
  created_at: string
}

export interface ComplianceDocument {
  id: string
  contractor_id: string
  document_type: string
  document_name: string | null
  is_required: boolean
  status: 'valid' | 'expired' | 'pending' | 'rejected' | 'expiring'
  expiry_date: string | null
  rejection_reason: string | null
  created_at: string
}

export interface ContractorActionItem {
  id: string
  company_id: string
  contractor_id: string
  action_type: string
  summary: string
  created_at: string
  contractors?: Pick<Contractor, 'name'>
}

// ── Payroll ──────────────────────────────────────────────────────────────────
export interface EmployeePayment {
  id: string
  employee_id: string
  company_id: string
  period_label: string
  gross_pay: number
  deductions: number
  net_pay: number
  hours: number
  status: 'pending' | 'approved' | 'paid' | 'rejected'
  is_visible_to_employee: boolean
  can_release_to_employee: boolean
  is_period_locked: boolean
  can_edit_overrides: boolean
  pay_full_base_salary: boolean
  waive_penalties: boolean
  manual_paye_override: number | null
  manual_adjustment: number | null
  adjustment_note: string | null
  bonus_amount: number | null
  bonus_note: string | null
  days_worked: number
  approved_leave: number
  absent_days: number
  regular_hours: number
  overtime_hours: number
  regular_pay: number
  overtime_pay: number
  has_earnings_lines: boolean
  has_deduction_lines: boolean
  has_ytd: boolean
  has_policy_snapshot: boolean
  has_audit_entries: boolean
  policy_snapshot_summary: string | null
  employee?: { name: string; surname: string }
  earnings_lines?: PayrollLineItem[]
  deduction_lines?: PayrollLineItem[]
  ytd_totals?: YtdTotals | null
  audit_entries?: PayrollAuditEntry[]
}

export interface PayrollLineItem {
  label: string
  amount: number
}

export interface YtdTotals {
  gross_pay: number
  paye: number
  uif: number
  net_pay: number
}

export interface PayrollAuditEntry {
  action: string
  detail: string | null
  at: string
}

// ── Compliance Packs ──────────────────────────────────────────────────────────
export interface CompliancePack {
  id: string
  name: string
  description: string | null
  is_default: boolean
  required_count: number
  recommended_count: number
  items: CompliancePackItem[]
}

export interface CompliancePackItem {
  doc_type_id: string
  requirement: 'required' | 'recommended' | 'none'
  doc_type?: { name: string }
}

// ── Work Teams ────────────────────────────────────────────────────────────────
export interface WorkTeam {
  id: string
  name: string
  description: string | null
  is_active: boolean
  member_count: number
  members?: TeamMember[]
}

export interface TeamMember {
  id: string
  employee_id: string
  is_leader: boolean
  employee?: { name: string; surname: string; branch: string | null }
}

// ── Phase 6 ───────────────────────────────────────────────────────────────────
export interface PunchActivity {
  id: string
  employee_id: string
  employee_name: string
  date_time: string
  type_label: 'Clock In' | 'Clock Out'
  address: string | null
}

export interface ActiveSession {
  session_id: string
  employee_id: string
  employee_name: string
  login_method_display: string
  created_at: string
  expires_at: string
}

export interface Asset {
  id: string
  company_id: string
  display_name: string
  asset_type: string | null
  serial_number: string | null
  manufacturer: string | null
  warranty_expires: string | null
  status_raw: 'active' | 'retired' | string
}

export interface CalendarEvent {
  id: string
  company_id: string
  title: string
  start_time: string
  end_time: string | null
  description: string | null
  event_type?: string | null
  attendee_ids?: string[] | null
  created_by?: string | null
  /** @deprecated use start_time date portion */
  date?: string
}

export interface Resident {
  id: string
  company_id: string
  site_id: string
  unit_id?: string | null
  name: string
  surname: string
  phone: string | null
  email?: string | null
  move_in_date: string | null
  move_out_date?: string | null
  notes?: string | null
  /** Derived client-side */
  full_name?: string
  is_current_resident?: boolean
}

export interface Unit {
  id: string
  company_id: string
  site_id: string
  unit_number: string
  unit_type: string | null
  address?: string | null
  floor?: string | null
  is_occupied?: boolean | null
  notes?: string | null
  /** Derived / legacy alias */
  display_name?: string
}

export interface SiteComplianceEntry {
  id: string
  company_id: string
  site_id: string | null
  compliance_type: string
  certificate_number?: string | null
  issued_date?: string | null
  expiry_date: string | null
  issued_by?: string | null
  notes?: string | null
  /** Derived client-side for UI */
  title?: string
  category?: string
  status?: string
}

export interface PayrollSettings {
  id: string
  company_id: string
  payroll_default_pay_basis: string
  default_hourly_rate: number
  overtime_multiplier: number
  overtime_threshold_hours: number
  allow_overtime_for_salary: boolean
  pay_full_salary_for_mid_month_joiners: boolean
  pay_salary_on_public_holidays: boolean
  pay_hourly_on_public_holidays: boolean
  late_threshold_minutes: number
  ot_start_after_minutes: number
  deduct_absent_from_pay: boolean
  salary_ignore_attendance_deductions: boolean
  absent_penalty_mode: string
  absent_penalty_threshold: number
  absent_penalty_deduct_days: number
  late_penalty_mode: string
  late_penalty_threshold: number
  late_penalty_deduct_hours: number
  early_penalty_mode: string
  early_penalty_threshold: number
  early_penalty_deduct_hours: number
  uif_enabled: boolean
  uif_rate_percent: number
  uif_ceiling_monthly: number
  paye_enabled: boolean
  default_paye_rate_percent: number
  use_sars_tax_tables: boolean
  payslip_release_day: number
  auto_release_payslips_on_release_day: boolean
  public_holidays_text: string
}

export interface JobContractorDocument {
  id: string
  job_id: string
  contractor_id: string
  document_name: string
  type_label: string
  type_icon: string
  storage_path: string
  created_display: string
}
