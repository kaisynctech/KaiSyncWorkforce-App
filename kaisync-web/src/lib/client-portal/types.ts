/** Client portal DTOs */

export type ClientPortalLogin = {
  client_id: string
  company_id: string
  company_code: string
  client_code: string
  client_name: string
  email?: string | null
}

export type ClientPortalJob = {
  id: string
  job_code: string | null
  title: string
  status: string
  scheduled_start: string | null
  scheduled_end: string | null
  created_at: string
  deal_id: string | null
  project_code: string | null
  project_title: string | null
}

export type ClientJobTeamMember = {
  id: string
  name: string
  on_site: boolean
  since: string | null
}

export type ClientJobChecklistItem = {
  description: string
  is_checked: boolean
  sort_order: number
}

export type ClientJobVisit = {
  sign_in_at: string
  sign_out_at: string | null
  sign_in_address: string | null
  sign_out_address: string | null
  notes: string | null
}

export type ClientJobDocument = {
  id: string
  document_name: string
  document_type: string
  file_url: string
  created_at: string
}

export type ClientPortalJobDetail = {
  id: string
  job_code: string | null
  title: string
  description: string | null
  status: string
  priority: string | null
  address: string | null
  site_name: string | null
  site_address: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  opened_at: string | null
  closed_at: string | null
  updated_at: string | null
  deal_id: string | null
  project_code: string | null
  project_title: string | null
  photos_before: string[]
  photos_after: string[]
  photos: string[]
  team: ClientJobTeamMember[]
  checklist: ClientJobChecklistItem[]
  visits: ClientJobVisit[]
  documents: ClientJobDocument[]
}

export type ClientPortalProject = {
  id: string
  company_id: string
  client_id: string
  project_code: string | null
  title: string
  status: string
  offer_amount: number
  deposit_required: number
  amount_paid: number
  progress_percent: number
  agreement_notes: string | null
  last_update_note: string | null
  last_update_at: string | null
  expected_close_date: string | null
  site_start_date: string | null
  expected_completion_date: string | null
  next_visit_date: string | null
  job_id: string | null
  quotation_notes: string | null
  quotation_valid_until: string | null
  quotation_sent_at: string | null
  quotation_response: 'pending' | 'accepted' | 'revision_requested'
  quotation_response_note: string | null
  quotation_response_at: string | null
  quotation_response_storage_path: string | null
  created_at: string
  updated_at: string
  job_count: number
  quotation_lines: QuotationLine[]
  documents: ProjectDocument[]
  activity_updates: ActivityUpdate[]
  progress_photos: ProgressPhoto[]
  messages: DealMessage[]
  payments: ClientPayment[]
}

export type QuotationLine = {
  line_no: number
  description: string
  quantity: number
  unit_price: number
}

export type ClientDocumentRequest = {
  id: string
  document_name: string
  document_type: string
  request_note: string | null
  status: string
  review_note: string | null
  storage_path: string | null
  submitted_at: string | null
  created_at: string
}

export type ProjectDocument = {
  id: string
  document_name: string
  document_type: string
  file_url: string
  created_at: string
}

export type ActivityUpdate = {
  body: string
  status_from: string | null
  status_to: string | null
  created_at: string
}

export type ProgressPhoto = {
  job_title: string
  phase: string
  url: string
}

export type DealMessage = {
  id: string
  author: 'client' | 'hr'
  body: string
  created_at: string
  sender_client_id?: string | null
}

export type ClientPayment = {
  id: string
  amount: number
  paid_at: string
  payment_method: string | null
  reference: string | null
  notes: string | null
  receipt_url: string | null
}

export type MessageInboxItem = {
  deal_id: string
  project_title: string
  project_code: string | null
  last_message_at: string | null
  last_message_preview: string | null
  last_from_hr: boolean
  has_unread?: boolean
}

export type PortalInvoice = {
  id: string
  company_id: string
  client_id: string | null
  invoice_number: string | null
  status: string
  currency: string
  subtotal: number
  vat_rate: number
  vat_amount: number
  total_amount: number
  amount_paid: number
  balance_due: number
  issue_date: string | null
  due_date: string | null
  notes: string | null
}

export function isInvoiceOutstanding(status: string): boolean {
  return ['sent', 'viewed', 'partially_paid', 'overdue'].includes((status ?? '').toLowerCase())
}
