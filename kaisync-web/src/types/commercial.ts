// ─── Suppliers ───────────────────────────────────────────────────────────────
// Suppliers ARE contractors with partner_kind = 'supplier'
// No separate type needed — reuse existing Contractor type, filter by partner_kind

// ─── RFQs ────────────────────────────────────────────────────────────────────
export type RfqStatus = 'draft' | 'sent' | 'responses_received' | 'closed' | 'cancelled'

export interface Rfq {
  id: string
  company_id: string
  rfq_number: string | null
  title: string
  deal_id: string | null
  quote_id: string | null
  status: RfqStatus
  description: string | null
  delivery_address: string | null
  required_by_date: string | null
  response_deadline: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined
  deal?: { id: string; title: string }
  client?: { id: string; name: string }
  recipients?: RfqRecipient[]
}

export interface RfqLine {
  id: string
  company_id: string
  rfq_id: string
  sort_order: number
  quote_line_id: string | null
  inventory_item_id: string | null
  description: string
  unit: string
  quantity: number
  specifications: string | null
  created_at: string
}

export interface RfqRecipient {
  id: string
  company_id: string
  rfq_id: string
  supplier_id: string
  status: 'pending' | 'sent' | 'viewed' | 'responded' | 'declined' | 'selected' | 'not_selected'
  sent_at: string | null
  responded_at: string | null
  response_subtotal: number
  response_vat_amount: number
  response_total: number
  response_delivery_days: number | null
  response_valid_until: string | null
  response_notes: string | null
  is_selected: boolean
  // Joined
  supplier?: { id: string; name: string; email: string | null; phone: string | null }
}

export interface RfqResponseLine {
  id: string
  company_id: string
  rfq_id: string
  recipient_id: string
  rfq_line_id: string
  unit_price: number
  quantity: number
  subtotal: number
  vat_rate: number
  vat_amount: number
  line_total: number
  lead_time_days: number | null
  availability_notes: string | null
}

// ─── Purchase Orders ─────────────────────────────────────────────────────────
export type PoStatus = 'draft' | 'pending_approval' | 'approved' | 'sent' | 'partially_received' | 'received' | 'cancelled'
export type PoApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface PurchaseOrder {
  id: string
  company_id: string
  po_number: string | null
  supplier_id: string | null
  deal_id: string | null
  quote_id: string | null
  rfq_id: string | null
  status: PoStatus
  approval_status: PoApprovalStatus
  currency: string
  subtotal: number
  vat_amount: number
  total_amount: number
  amount_received_value: number
  delivery_address: string | null
  required_delivery_date: string | null
  actual_delivery_date: string | null
  notes: string | null
  internal_notes: string | null
  terms_and_conditions: string | null
  approved_by: string | null
  approved_at: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
  // Joined
  supplier?: { id: string; name: string; email: string | null }
  deal?: { id: string; title: string }
}

export interface PurchaseOrderLine {
  id: string
  company_id: string
  po_id: string
  sort_order: number
  rfq_line_id: string | null
  rfq_response_line_id: string | null
  inventory_item_id: string | null
  quote_line_id: string | null
  description: string
  unit: string
  quantity_ordered: number
  unit_price: number
  subtotal: number
  vat_rate: number
  vat_amount: number
  line_total: number
  quantity_received: number
  quantity_invoiced: number
}

// ─── Goods Received Notes ────────────────────────────────────────────────────
export type GrnStatus = 'draft' | 'received' | 'partial'

export interface GoodsReceivedNote {
  id: string
  company_id: string
  grn_number: string | null
  po_id: string | null
  supplier_id: string | null
  deal_id: string | null
  status: GrnStatus
  received_date: string
  received_by: string | null
  delivery_note_number: string | null
  notes: string | null
  created_at: string
  // Joined
  supplier?: { id: string; name: string }
  po?: { id: string; po_number: string | null }
}

export interface GoodsReceivedLine {
  id: string
  company_id: string
  grn_id: string
  po_line_id: string | null
  inventory_item_id: string | null
  description: string
  unit: string
  quantity_expected: number
  quantity_received: number
  unit_cost: number
  condition_notes: string | null
}

// ─── Project Milestones ───────────────────────────────────────────────────────
export type MilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface ProjectMilestone {
  id: string
  company_id: string
  deal_id: string
  sort_order: number
  name: string
  description: string | null
  due_date: string | null
  completion_date: string | null
  invoice_amount: number
  invoice_percentage: number
  triggers_invoice: boolean
  invoice_id: string | null
  is_retention_release: boolean
  status: MilestoneStatus
  completed_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// ─── Project Cost Entries ────────────────────────────────────────────────────
export type CostType = 'estimated' | 'committed' | 'actual'
export type CostCategory = 'labour' | 'materials' | 'subcontract' | 'equipment' | 'overhead' | 'other'
export type CostSource = 'manual' | 'purchase_order' | 'supplier_invoice' | 'quote_estimate'

export interface ProjectCostEntry {
  id: string
  company_id: string
  deal_id: string
  cost_type: CostType
  category: CostCategory
  source: CostSource
  source_id: string | null
  source_reference: string | null
  description: string
  quantity: number
  unit_cost: number
  total_cost: number
  cost_date: string
  notes: string | null
  created_at: string
}

// ─── Project Financial Summary (view) ────────────────────────────────────────
export interface ProjectFinancialSummary {
  deal_id: string
  company_id: string
  title: string
  status: string
  contract_type: string
  contract_value: number
  budget_amount: number
  estimated_cost: number
  committed_cost: number
  actual_cost: number
  retention_percent: number
  retention_amount_held: number
  retention_released_at: string | null
  total_invoiced: number
  total_received: number
  invoice_count: number
  outstanding_balance: number
  estimated_cost_entries: number
  committed_cost_entries: number
  actual_cost_entries: number
  total_po_value: number
  total_po_received: number
  total_supplier_invoiced: number
  total_supplier_paid: number
  total_milestones: number
  completed_milestones: number
  invoiced_milestones: number
  best_actual_cost: number
  gross_profit: number
  gross_margin_percent: number
  estimated_budget_variance: number
  actual_budget_variance: number
}

// ─── AI Features ─────────────────────────────────────────────────────────────

export interface BoqExtractedLine {
  description: string
  quantity: number
  unit: string
  unit_price: number | null
  item_type: 'material' | 'labour' | 'subcontract' | 'equipment' | 'other'
  section?: string
  notes?: string
}

export interface QuoteAssistSuggestion {
  description: string
  quantity: number
  unit: string
  item_type: 'material' | 'labour' | 'subcontract' | 'equipment' | 'other'
  catalogue_item_id: string | null
  catalogue_match_name: string | null
  suggested_cost_price: number
  suggested_sell_price: number
  markup_percent: number
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
}

export interface PriceSuggestion {
  catalogue_item_id: string
  name: string
  unit: string
  item_type: string
  cost_price: number
  sell_price: number
  markup_percent: number
  similarity_score: number
  usage_count: number
}

// ─── Automation ───────────────────────────────────────────────────────────────
export type AutomationTriggerType =
  | 'quote_accepted'
  | 'invoice_overdue'
  | 'milestone_due'
  | 'po_approved'
  | 'quote_expiring'

export type AutomationActionType =
  | 'create_project'
  | 'create_rfq'
  | 'send_notification'
  | 'create_milestone_invoice'

export interface CommercialAutomationRule {
  id: string
  company_id: string
  name: string
  description: string | null
  trigger_type: AutomationTriggerType
  trigger_config: Record<string, unknown>
  action_type: AutomationActionType
  action_config: Record<string, unknown>
  is_active: boolean
  is_system: boolean
  run_count: number
  last_run_at: string | null
  created_at: string
  updated_at: string
}

export interface AutomationRuleExecution {
  id: string
  company_id: string
  rule_id: string | null
  trigger_type: string
  trigger_entity_id: string
  trigger_entity_type: string
  action_type: string
  status: 'success' | 'failed' | 'skipped'
  result: Record<string, unknown>
  error_message: string | null
  executed_at: string
}

// ─── Intelligence (Phase 6) ──────────────────────────────────────────────────
export interface CashFlowWeek {
  company_id: string
  week_offset: number
  week_start: string
  week_end: string
  week_label: string
  projected_inflow: number
  projected_outflow: number
  net_cash_flow: number
  invoice_inflow: number
  milestone_inflow: number
  po_outflow: number
  supplier_invoice_outflow: number
}

export interface ClientPaymentIntelligence {
  company_id: string
  client_id: string
  client_name: string
  total_invoices: number
  paid_invoices: number
  outstanding_invoices: number
  overdue_invoices: number
  total_invoiced: number
  total_paid: number
  total_outstanding: number
  overdue_amount: number
  avg_days_to_pay: number | null
  avg_days_vs_due: number | null
  on_time_rate_percent: number | null
  reliability_score: number | null
  payment_risk: 'high' | 'medium' | 'low'
}

export interface QuoteWinLossSummary {
  company_id: string
  total_quotes: number
  total_sent_or_decided: number
  currently_open: number
  total_won: number
  total_lost: number
  win_rate_percent: number | null
  avg_quote_value: number | null
  avg_won_value: number | null
  avg_lost_value: number | null
  total_won_value: number
  pipeline_value: number
  avg_days_to_decision: number | null
  avg_won_margin_percent: number | null
}

export interface ProjectCostVariance {
  deal_id: string
  company_id: string
  title: string
  status: string
  contract_value: number
  estimated_cost: number
  committed_cost: number
  actual_cost: number
  cost_overrun_percent: number | null
  commitment_rate_percent: number | null
  projected_margin_percent: number | null
  cost_risk: 'high' | 'medium' | 'low'
  total_invoiced: number
  progress_percent: number | null
  site_start_date: string | null
  expected_completion_date: string | null
}

export interface BusinessDigest {
  health_score: number
  cash_flow_summary: string
  client_risk_summary: string
  quote_performance_summary: string
  cost_performance_summary: string
  top_actions: string[]
  generated_at: string
}

// ─── Three-Way Match ─────────────────────────────────────────────────────────
export type MatchStatus = 'NO_ORDER' | 'OVER_INVOICED' | 'SHORT_DELIVERY' | 'MATCHED' | 'PARTIAL'

export interface ThreeWayMatchLine {
  po_line_id: string
  po_id: string
  po_number: string | null
  supplier_id: string | null
  description: string
  unit: string
  unit_price: number
  quantity_ordered: number
  quantity_received: number
  quantity_invoiced: number
  value_ordered: number
  value_received: number
  value_invoiced: number
  receipt_variance: number
  invoice_variance: number
  match_status: MatchStatus
  company_id: string
}
