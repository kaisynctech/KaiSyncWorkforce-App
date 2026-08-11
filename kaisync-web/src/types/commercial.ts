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
