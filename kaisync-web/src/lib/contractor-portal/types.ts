/** Contractor portal DTOs — Phase D0/D1. */

export type ContractorPortalLogin = {
  contractor_id: string
  company_id: string
  contractor_name: string
  contractor_code: string
  company_code: string
}

export type ContractorPortalProfile = {
  name: string
  registration_number: string | null
  tax_number: string | null
  is_vat_registered: boolean
  vat_number: string | null
  contact_person: string | null
  phone: string | null
  email: string | null
  address: string | null
  company_name: string
  company_code: string
  contractor_code: string
  partner_kind: string
  banking_verified: boolean
  payment_hold: boolean
  compliance_hold: boolean
  is_active: boolean
  payment_terms: string | null
  preferred_payment_method: string | null
  compliance_pack_name: string | null
}

export type ContractorJob = {
  id: string
  title: string
  status: string
  job_code: string | null
  contractor_cost: number
  deal_id: string | null
  client_id: string | null
  photo_urls_before?: string[]
  photo_urls_after?: string[]
}

export type JobSiteVisit = {
  id: string
  job_id: string
  sign_in_at: string
  sign_out_at: string | null
  sign_in_address?: string | null
  sign_out_address?: string | null
  reported_by_name?: string | null
}

export type JobSiteSessionRow = {
  sign_in_at: string
  sign_out_at: string | null
  total_hours: number
  hours_display: string
  is_open: boolean
}

export type JobMessage = {
  id: string
  body: string
  created_at: string
  sender_display_name: string | null
  sender_contractor_id: string | null
  is_contractor: boolean
}

export type ContractorPayout = {
  id: string
  company_id: string
  contractor_id: string | null
  job_id: string | null
  job_contractor_id: string | null
  subtotal: number
  vat_amount: number
  total_amount: number
  retention_amount: number
  payout_status: string
  approval_status: string
  rejection_reason: string | null
  notes: string | null
  payout_date: string | null
  approved_at: string | null
  paid_at: string | null
  created_at: string | null
  job_title: string | null
  job_code: string | null
}

export function payoutNetPayable(p: ContractorPayout): number {
  return (p.total_amount || 0) - (p.retention_amount || 0)
}

export function payoutInvoiceReference(p: ContractorPayout): string {
  const notes = (p.notes ?? '').trim()
  if (!notes) return '—'
  return notes.includes('|') ? notes.split('|')[0]!.trim() : notes
}

export function payoutJobDisplay(p: ContractorPayout): string {
  if (!p.job_title) return '—'
  return p.job_code ? `${p.job_code} · ${p.job_title}` : p.job_title
}

export function payoutIsRejected(p: ContractorPayout): boolean {
  return (p.approval_status || '').toLowerCase() === 'rejected'
}

export function payoutStatusLabel(p: ContractorPayout): string {
  const status = (p.payout_status || '').toLowerCase()
  if (status === 'paid') return 'Paid'
  if (status === 'approved') return 'Approved — Awaiting Payment'
  if (payoutIsRejected(p)) return 'Rejected'
  return 'Pending Review'
}

export type OpenVisit = {
  job_id: string | null
  sign_in_at: string | null
  job_title?: string | null
}

/** Masked current banking — contractor_portal_get_banking. */
export type ContractorBankingStatus = {
  account_holder_name: string | null
  bank_name: string | null
  masked_account: string | null
  bank_branch_code: string | null
  account_type: string | null
  swift_bic: string | null
  has_banking_details: boolean
  banking_verified: boolean
  payment_hold: boolean
  compliance_hold: boolean
  payment_terms: string | null
  preferred_payment_method: string | null
}

/** Latest banking update decision — contractor_portal_get_latest_banking_decision. */
export type ContractorBankingDecision = {
  id: string
  account_holder_name: string | null
  bank_name: string | null
  masked_account: string | null
  bank_branch_code: string | null
  account_type: string | null
  swift_bic: string | null
  status: 'pending' | 'approved' | 'rejected' | string
  submitted_at: string | null
  reviewed_at: string | null
  rejection_reason: string | null
}

export const BANK_ACCOUNT_TYPE_OPTIONS = [
  { label: 'Cheque', value: 'cheque' },
  { label: 'Savings', value: 'savings' },
  { label: 'Transmission', value: 'transmission' },
  { label: 'Credit', value: 'credit' },
] as const

export function accountTypeLabel(raw: string | null | undefined): string {
  switch ((raw ?? '').toLowerCase()) {
    case 'cheque': return 'Cheque'
    case 'savings': return 'Savings'
    case 'transmission': return 'Transmission'
    case 'credit': return 'Credit'
    default: return raw?.trim() || '—'
  }
}

/** Current compliance document (is_current=true from portal RPC). */
export type ContractorDocument = {
  id: string
  company_id: string
  contractor_id: string
  document_type: string
  document_name: string
  file_url: string
  storage_path: string | null
  approval_status: string
  rejected_reason: string | null
  is_required: boolean
  is_current: boolean
  uploaded_by_role: string
  expiry_date: string | null
  created_at: string
  updated_at: string
}

export type CompliancePackItem = {
  document_type: string
  requirement: string
  sort_order: number
}

export type PackChecklistRow = {
  document_type: string
  type_label: string
  is_required: boolean
  status: 'complete' | 'expiring' | 'expired' | 'pending' | 'rejected' | 'missing'
  expiry_display: string | null
}

export type ComplianceView = {
  has_pack: boolean
  score_percent: number
  score_progress: number
  status_label: string
  required_count: number
  complete_count: number
  missing_count: number
  expiring_count: number
  rejected_count: number
  approved_count: number
  checklist: PackChecklistRow[]
  missing_rows: PackChecklistRow[]
  expiring_docs: ContractorDocument[]
  rejected_docs: ContractorDocument[]
}

export const CONTRACTOR_DOC_TYPES: { value: string; label: string }[] = [
  { value: 'company_registration', label: 'Company Registration' },
  { value: 'tax_clearance', label: 'Tax Clearance (SARS TCS)' },
  { value: 'vat_certificate', label: 'VAT Certificate' },
  { value: 'bank_confirmation', label: 'Bank Confirmation Letter' },
  { value: 'public_liability_insurance', label: 'Public Liability Insurance' },
  { value: 'professional_indemnity', label: 'Professional Indemnity' },
  { value: 'coida', label: "COIDA / Workmen's Comp." },
  { value: 'health_safety_file', label: 'Health & Safety File' },
  { value: 'contractor_agreement', label: 'Contractor Agreement' },
  { value: 'nda', label: 'NDA' },
  { value: 'popia_agreement', label: 'POPIA Agreement' },
  { value: 'bbee_certificate', label: 'B-BBEE Certificate' },
  { value: 'proof_of_address', label: 'Proof of Address' },
  { value: 'id_document', label: 'ID / Passport' },
  { value: 'site_certification', label: 'Site Certification' },
  { value: 'psira_registration', label: 'PSIRA Registration' },
  { value: 'fidelity_guarantee', label: 'Fidelity Guarantee' },
  { value: 'liquor_license', label: 'Liquor Licence' },
  { value: 'food_safety_cert', label: 'Food Safety Certificate' },
  { value: 'other', label: 'Other' },
]

export type QuoteVatMode = 'none' | 'exclusive' | 'inclusive'

export type QuoteLineDraft = {
  description: string
  quantity: number
  unit_price: number
  discount_amount: number
}

export type QuoteTotals = {
  line_subtotal: number
  after_discount: number
  charges: number
  taxable: number
  vat_amount: number
  grand_total: number
}

export type ContractorQuoteItem = {
  id: string
  description: string
  quantity: number
  unit_price: number
  discount_amount: number
  subtotal: number
  line_total: number
  line_no: number
}

export type ContractorQuoteAttachment = {
  id: string
  file_name: string
  file_url: string
  storage_path: string | null
  is_primary: boolean
}

export type ContractorQuote = {
  id: string
  quote_number: string | null
  title: string
  description: string | null
  source_mode: string
  vat_mode: QuoteVatMode | string
  vat_rate: number
  subtotal: number
  discount_amount: number
  freight_amount: number
  duty_amount: number
  levies_amount: number
  other_charges_amount: number
  taxable_amount: number
  vat_amount: number
  total_amount: number
  quote_date: string | null
  valid_until: string | null
  status: string
  terms: string | null
  contractor_notes: string | null
  revision_comments: string | null
  rejection_reason: string | null
  submitted_at: string | null
  reviewed_at: string | null
  converted_at: string | null
  converted_to_job_id: string | null
  created_at: string | null
  items: ContractorQuoteItem[]
  attachments: ContractorQuoteAttachment[]
}

export function partnerKindLabel(raw: string): string {
  switch ((raw ?? '').toLowerCase()) {
    case 'contractor': return 'Contractor'
    case 'supplier': return 'Supplier'
    case 'subcontractor': return 'Subcontractor'
    default: return raw?.trim() || '—'
  }
}

export function paymentTermsLabel(raw: string | null): string {
  switch (raw) {
    case 'immediate': return 'Immediate'
    case '7_days': return '7 Days'
    case '14_days': return '14 Days'
    case '30_days': return '30 Days'
    case '60_days': return '60 Days'
    case '90_days': return '90 Days'
    default: return raw ?? '—'
  }
}

export function paymentMethodLabel(raw: string | null): string {
  switch (raw) {
    case 'eft': return 'EFT'
    case 'cash': return 'Cash'
    case 'cheque': return 'Cheque'
    case 'card': return 'Card'
    default: return raw ?? '—'
  }
}

export function moneyZAR(n: number): string {
  return `R${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
