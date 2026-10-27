import type { SupabaseClient } from '@supabase/supabase-js'

export type PortalKind = 'customer' | 'hired'
export type PortalStatus = 'pending' | 'active' | 'rejected' | 'cancelled'

export type PortalLink = {
  link_id: string
  kind: PortalKind
  status: PortalStatus
  host_company_id: string
  other_company_id: string
  company_id: string
  company_name: string
  company_code: string
  record_id: string | null
  record_name: string | null
  requested_by_company_id: string
  awaiting: 'us' | 'them' | null
  needs_record: boolean
}

export type PortalList = {
  as_client: PortalLink[]
  as_contractor: PortalLink[]
  to_decide: PortalLink[]
}

export type PortalJob = {
  id: string
  job_code: string | null
  title: string | null
  status: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  created_at: string | null
}

export type PortalQuote = {
  id: string
  quote_number: string | null
  title: string | null
  status: string | null
  total_amount: number | null
  currency: string | null
  valid_until: string | null
  sent_at: string | null
}

export type PortalInvoice = {
  id: string
  invoice_number: string | null
  status: string | null
  total_amount: number | null
  balance_due: number | null
  currency: string | null
  issue_date: string | null
  due_date: string | null
}

export type PortalFeed = {
  link: PortalLink
  jobs: PortalJob[]
  quotes: PortalQuote[]
  invoices: PortalInvoice[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function str(value: unknown): string {
  return value == null ? '' : String(value)
}

function strN(value: unknown): string | null {
  if (value == null || value === '') return null
  return String(value)
}

function numN(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function parsePortalLink(value: unknown): PortalLink | null {
  const row = asRecord(value)
  if (!row) return null
  const kind = row.kind === 'hired' ? 'hired' : row.kind === 'customer' ? 'customer' : null
  const status = row.status
  if (!kind || (status !== 'pending' && status !== 'active' && status !== 'rejected' && status !== 'cancelled')) {
    return null
  }
  if (!row.link_id) return null
  return {
    link_id: str(row.link_id),
    kind,
    status,
    host_company_id: str(row.host_company_id),
    other_company_id: str(row.other_company_id),
    company_id: str(row.company_id),
    company_name: str(row.company_name),
    company_code: str(row.company_code),
    record_id: strN(row.record_id),
    record_name: strN(row.record_name),
    requested_by_company_id: str(row.requested_by_company_id),
    awaiting: row.awaiting === 'us' || row.awaiting === 'them' ? row.awaiting : null,
    needs_record: row.needs_record === true,
  }
}

function parseLinkList(value: unknown): PortalLink[] {
  if (!Array.isArray(value)) return []
  return value.map(parsePortalLink).filter((row): row is PortalLink => row != null)
}

export function parsePortalList(value: unknown): PortalList {
  const row = asRecord(value) ?? {}
  return {
    as_client: parseLinkList(row.as_client),
    as_contractor: parseLinkList(row.as_contractor),
    to_decide: parseLinkList(row.to_decide),
  }
}

function parseJobs(value: unknown): PortalJob[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const row = asRecord(item)
    if (!row?.id) return []
    return [{
      id: str(row.id),
      job_code: strN(row.job_code),
      title: strN(row.title),
      status: strN(row.status),
      scheduled_start: strN(row.scheduled_start),
      scheduled_end: strN(row.scheduled_end),
      created_at: strN(row.created_at),
    }]
  })
}

function parseQuotes(value: unknown): PortalQuote[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const row = asRecord(item)
    if (!row?.id) return []
    return [{
      id: str(row.id),
      quote_number: strN(row.quote_number),
      title: strN(row.title),
      status: strN(row.status),
      total_amount: numN(row.total_amount),
      currency: strN(row.currency),
      valid_until: strN(row.valid_until),
      sent_at: strN(row.sent_at),
    }]
  })
}

function parseInvoices(value: unknown): PortalInvoice[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const row = asRecord(item)
    if (!row?.id) return []
    return [{
      id: str(row.id),
      invoice_number: strN(row.invoice_number),
      status: strN(row.status),
      total_amount: numN(row.total_amount),
      balance_due: numN(row.balance_due),
      currency: strN(row.currency),
      issue_date: strN(row.issue_date),
      due_date: strN(row.due_date),
    }]
  })
}

export function parsePortalFeed(value: unknown): PortalFeed | null {
  const row = asRecord(value)
  const link = parsePortalLink(row?.link)
  if (!row || !link) return null
  return {
    link,
    jobs: parseJobs(row.jobs),
    quotes: parseQuotes(row.quotes),
    invoices: parseInvoices(row.invoices),
  }
}

async function rpc<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>, map: (data: unknown) => T): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return map(data)
}

export function listCompanyPortals(supabase: SupabaseClient, companyId: string): Promise<PortalList> {
  return rpc(supabase, 'company_portal_list', { p_company_id: companyId }, parsePortalList)
}

export function requestCompanyPortalLink(
  supabase: SupabaseClient,
  companyId: string,
  otherCompanyCode: string,
  kind: PortalKind,
  recordId?: string | null,
): Promise<void> {
  return rpc(supabase, 'company_portal_request_link', {
    p_company_id: companyId,
    p_other_company_code: otherCompanyCode,
    p_kind: kind,
    p_record_id: recordId ?? null,
  }, () => undefined)
}

export function decideCompanyPortalLink(
  supabase: SupabaseClient,
  companyId: string,
  linkId: string,
  accept: boolean,
  recordId?: string | null,
): Promise<void> {
  return rpc(supabase, 'company_portal_decide_link', {
    p_company_id: companyId,
    p_link_id: linkId,
    p_accept: accept,
    p_record_id: recordId ?? null,
  }, () => undefined)
}

export function cancelCompanyPortalLink(supabase: SupabaseClient, companyId: string, linkId: string): Promise<void> {
  return rpc(supabase, 'company_portal_cancel_link', {
    p_company_id: companyId,
    p_link_id: linkId,
  }, () => undefined)
}

export function fetchCompanyPortalRecordLink(
  supabase: SupabaseClient,
  companyId: string,
  kind: PortalKind,
  recordId: string,
): Promise<PortalLink | null> {
  return rpc(supabase, 'company_portal_record_link', {
    p_company_id: companyId,
    p_kind: kind,
    p_record_id: recordId,
  }, value => parsePortalLink(value))
}

export function openCompanyPortal(supabase: SupabaseClient, companyId: string, linkId: string): Promise<PortalFeed> {
  return rpc(supabase, 'company_portal_open', {
    p_company_id: companyId,
    p_link_id: linkId,
  }, value => {
    const feed = parsePortalFeed(value)
    if (!feed) throw new Error('Connection not found')
    return feed
  })
}

export function formatPortalMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return '—'
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: currency || 'ZAR',
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return amount.toFixed(2)
  }
}
