export type FinanceInvoice = {
  id: string
  company_id: string
  client_id: string | null
  project_id: string | null
  invoice_number: string | null
  status: string
  currency: string
  subtotal: number
  vat_rate: number
  vat_amount: number
  total_amount: number
  amount_paid: number
  balance_due: number
  is_vat_inclusive: boolean
  tax_type: string
  issue_date: string
  due_date: string | null
  paid_date: string | null
  notes: string | null
  created_at: string
  clients?: { name: string } | null
}

export type FinanceInvoiceLine = {
  id: string
  invoice_id: string
  company_id: string
  description: string
  quantity: number
  unit_price: number
  vat_rate: number
  vat_amount: number
  subtotal: number
  total_amount: number
  is_vat_inclusive: boolean
  tax_type: string
  line_no: number
}

export type SupplierInvoice = {
  id: string
  company_id: string
  supplier_id: string | null
  invoice_number: string | null
  subtotal: number
  vat_rate: number
  vat_amount: number
  total_amount: number
  amount_paid: number
  balance_due: number
  is_vat_inclusive: boolean
  tax_type: string
  due_date: string | null
  status: string
  approval_status: string
  paid_at: string | null
  notes: string | null
  created_at: string
  contractors?: { name: string } | null
}

export type ContractorPayout = {
  id: string
  company_id: string
  contractor_id: string | null
  job_id: string | null
  subtotal: number
  vat_rate: number
  vat_amount: number
  total_amount: number
  retention_amount: number
  payout_status: string
  approval_status: string
  payout_date: string | null
  paid_at: string | null
  notes: string | null
  created_at: string
  contractors?: { name: string; bank_account?: string | null; bank_name?: string | null } | null
}

export type FinanceAuditEntry = {
  id: string
  company_id: string
  entity_type: string
  entity_id: string | null
  action: string
  actor_id: string | null
  actor_name: string | null
  amount: number | null
  note: string | null
  created_at: string
}

export type FinanceDashboardKpis = {
  revenue: number
  outstanding: number
  outstandingCount: number
  payables: number
  profit: number
  moneyIn: number
  moneyOut: number
  vatDue: number
  pendingApprovals: number
}
