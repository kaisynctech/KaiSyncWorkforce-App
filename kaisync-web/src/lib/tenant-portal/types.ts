export type TenantPortalLogin = {
  resident_id: string
  company_id: string
  company_code: string
  resident_code: string
  resident_name: string
  email: string | null
  phone: string | null
}

export type TenantLeaseSummary = {
  id: string
  status: string
  start_date: string
  end_date: string | null
  rent_amount: number | null
  deposit_amount: number | null
  currency: string
  payment_frequency: string
  notes: string | null
  site_id: string
  site_name: string
  site_address: string | null
  unit_id: string | null
  unit_number: string | null
  unit_type: string | null
}

export type TenantLeasePayload = {
  resident: {
    id: string
    name: string
    surname: string
    phone: string | null
    email: string | null
    move_in_date: string | null
    move_out_date: string | null
  }
  leases: TenantLeaseSummary[]
}

export type TenantInvoice = {
  id: string
  invoice_number: string | null
  status: string
  issue_date: string
  due_date: string | null
  total_amount: number
  amount_paid: number
  balance_due: number
  currency: string
  invoice_type: string | null
  lease_id: string | null
  site_id: string | null
}

export type TenantIssue = {
  id: string
  job_code: string | null
  title: string
  description: string | null
  status: string
  opened_at: string
  site_id: string | null
  unit_id: string | null
  photo_urls_before: string[] | null
}

export function isInvoiceOutstanding(status: string): boolean {
  return !['paid', 'voided', 'cancelled'].includes(status)
}
