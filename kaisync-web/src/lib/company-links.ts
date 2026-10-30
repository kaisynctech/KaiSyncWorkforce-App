/**
 * Linked companies (stage 1): a provider company's client record and a customer company's
 * contractor record joined by one link. Everything goes through the company_link_* database
 * functions, which check the caller; nothing here reads the link tables directly.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** This company's side of a link: 'provider' (the other company is my client) or 'customer' (my contractor). */
export type LinkRole = 'provider' | 'customer'
export type LinkStatus = 'pending' | 'active' | 'declined' | 'disconnected'

export type LinkCompany = {
  id: string
  name: string
  legal_name: string | null
  registration_number?: string | null
  logo_path: string | null
}

export type CompanyLink = {
  id: string
  status: LinkStatus
  my_role: LinkRole
  waiting_on_me: boolean
  other: LinkCompany
  my_record_id: string | null
  my_record_name: string | null
  created_at: string
  decided_at: string | null
  ended_at: string | null
}

export type RecordLink = {
  id: string
  status: LinkStatus
  waiting_on_me: boolean
  other: LinkCompany
  decided_at: string | null
}

export type InvitePreview = {
  state: 'open' | 'used' | 'expired' | 'cancelled' | 'own'
  inviter_role: LinkRole
  expires_at: string
  inviter: LinkCompany
}

export type Result<T> = { ok: true; data: T } | { ok: false; message: string }

const MESSAGES: [RegExp, string][] = [
  [/ONLY_OWNER_HR_ADMIN/, 'Only the owner, HR or an admin can link companies.'],
  [/NOT_ALLOWED/, 'You do not have access to linked companies.'],
  [/PLATFORM_COMPANY/, 'The KaiSync platform company cannot be linked.'],
  [/CHOOSE_ANOTHER_COMPANY/, 'Choose another company.'],
  [/COMPANY_NOT_FOUND/, 'That company was not found.'],
  [/ALREADY_LINKED_OR_WAITING/, 'These companies are already linked this way, or a request is waiting.'],
  [/RECORD_ALREADY_LINKED/, 'This record is already linked to another company.'],
  [/OTHER_COMPANY_DECIDES/, 'The other company accepts this request.'],
  [/NOT_WAITING|ALREADY_ENDED/, 'This link has already been dealt with. Refresh the page.'],
  [/LINK_NOT_FOUND/, 'That link was not found.'],
  [/INVITE_NOT_FOUND/, 'This invite link is not valid. Ask for a new one.'],
  [/INVITE_USED/, 'This invite has already been used.'],
  [/INVITE_EXPIRED/, 'This invite has expired. Ask for a new one.'],
  [/OWN_INVITE/, 'This invite was made by your own company. Send it to the other company.'],
  [/CLIENT_NOT_FOUND|CONTRACTOR_NOT_FOUND/, 'That record was not found.'],
  [/RECORD_REQUIRED/, 'Save the record first.'],
]

/** Plain-English message for a database error code. */
export function linkErrorMessage(raw: string | null | undefined): string {
  const text = raw ?? ''
  for (const [re, msg] of MESSAGES) if (re.test(text)) return msg
  return text || 'Something went wrong. Try again.'
}

async function call<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(fn, args)
  if (error) return { ok: false, message: linkErrorMessage(error.message) }
  return { ok: true, data: data as T }
}

export function searchCompanies(supabase: SupabaseClient, companyId: string, query: string) {
  return call<LinkCompany[]>(supabase, 'company_link_search', { p_company_id: companyId, p_query: query })
}

export function requestLink(supabase: SupabaseClient, companyId: string, otherCompanyId: string, myRole: LinkRole, recordId: string) {
  return call<{ link_id: string; status: LinkStatus }>(supabase, 'company_link_request', {
    p_company_id: companyId, p_other_company_id: otherCompanyId, p_my_role: myRole, p_record_id: recordId,
  })
}

/** Accept (with my matching record, or null to create one named after the other company) or decline. */
export function decideLink(supabase: SupabaseClient, companyId: string, linkId: string, accept: boolean, recordId: string | null) {
  return call<{ link_id: string; status: LinkStatus }>(supabase, 'company_link_decide', {
    p_company_id: companyId, p_link_id: linkId, p_accept: accept, p_record_id: recordId,
  })
}

export function disconnectLink(supabase: SupabaseClient, companyId: string, linkId: string) {
  return call<{ link_id: string; status: LinkStatus }>(supabase, 'company_link_disconnect', { p_company_id: companyId, p_link_id: linkId })
}

export function createInvite(supabase: SupabaseClient, companyId: string, myRole: LinkRole, recordId: string) {
  return call<{ token: string; expires_at: string }>(supabase, 'company_link_create_invite', {
    p_company_id: companyId, p_my_role: myRole, p_record_id: recordId,
  })
}

export function previewInvite(supabase: SupabaseClient, companyId: string, token: string) {
  return call<InvitePreview>(supabase, 'company_link_preview_invite', { p_company_id: companyId, p_token: token })
}

export function acceptInvite(supabase: SupabaseClient, companyId: string, token: string, recordId: string | null) {
  return call<{ link_id: string; status: LinkStatus }>(supabase, 'company_link_accept_invite', {
    p_company_id: companyId, p_token: token, p_record_id: recordId,
  })
}

/** Make an invite and email it to the other company (edge function send_link_invite). */
export async function emailInvite(supabase: SupabaseClient, params: {
  companyId: string; myRole: LinkRole; recordId: string; email: string; origin: string; note?: string
}): Promise<Result<{ token: string; expires_at: string; recipient_email: string }>> {
  const email = params.email.trim()
  if (!isEmail(email)) return { ok: false, message: 'Type a valid email address.' }
  const { data, error } = await supabase.functions.invoke('send_link_invite', {
    body: {
      company_id: params.companyId, my_role: params.myRole, record_id: params.recordId,
      recipient_email: email, origin: params.origin, note: params.note?.trim() || undefined,
    },
  })
  if (error) {
    // The function answers with { message } on a refusal; show that rather than the HTTP wording.
    let message = error.message
    try {
      const ctx = (error as { context?: Response }).context
      const body = ctx ? await ctx.json() : null
      if (body?.message) message = String(body.message)
    } catch { /* keep the first message */ }
    return { ok: false, message: linkErrorMessage(message) }
  }
  return { ok: true, data: data as { token: string; expires_at: string; recipient_email: string } }
}

export function isEmail(value: string): boolean {
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/.test(value.trim())
}

export async function listLinks(supabase: SupabaseClient, companyId: string): Promise<Result<CompanyLink[]>> {
  const res = await call<CompanyLink[] | null>(supabase, 'company_link_list', { p_company_id: companyId })
  return res.ok ? { ok: true, data: res.data ?? [] } : res
}

export async function linkForRecord(supabase: SupabaseClient, companyId: string, myRole: LinkRole, recordId: string): Promise<Result<RecordLink | null>> {
  const res = await call<{ link: RecordLink | null }>(supabase, 'company_link_for_record', {
    p_company_id: companyId, p_my_role: myRole, p_record_id: recordId,
  })
  return res.ok ? { ok: true, data: res.data?.link ?? null } : res
}

export async function myUnlinkedRecords(supabase: SupabaseClient, companyId: string, myRole: LinkRole): Promise<Result<{ id: string; name: string }[]>> {
  const res = await call<{ id: string; name: string }[] | null>(supabase, 'company_link_my_records', { p_company_id: companyId, p_my_role: myRole })
  return res.ok ? { ok: true, data: res.data ?? [] } : res
}

// ── Words (pure, tested) ──────────────────────────────────────────────────────

/** The invite address the other company opens while signed into its own company. */
export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/dashboard/linked-companies/invite/${encodeURIComponent(token)}`
}

/** How the other company relates to us, in words. */
export function relationWords(myRole: LinkRole, otherName: string): string {
  return myRole === 'provider' ? `${otherName} is your client` : `${otherName} is your contractor`
}

/** What a record of mine is called on the other side, for the accept screen. */
export function myRecordNoun(myRole: LinkRole): 'client' | 'contractor' {
  return myRole === 'provider' ? 'client' : 'contractor'
}

export function statusWords(link: Pick<CompanyLink, 'status' | 'waiting_on_me'>): string {
  switch (link.status) {
    case 'active': return 'Linked'
    case 'pending': return link.waiting_on_me ? 'Waiting for you to accept' : 'Waiting for them to accept'
    case 'declined': return 'Declined'
    default: return 'Disconnected'
  }
}

export type LinkTab = 'clients' | 'contractors'

/** Links grouped for the Clients / Contractors tabs, each split into waiting, open and ended. */
export function groupLinks(links: CompanyLink[], tab: LinkTab) {
  const mine = links.filter(l => (tab === 'clients' ? l.my_role === 'provider' : l.my_role === 'customer'))
  return {
    waiting: mine.filter(l => l.status === 'pending' && l.waiting_on_me),
    open: mine.filter(l => l.status === 'active' || (l.status === 'pending' && !l.waiting_on_me)),
    ended: mine.filter(l => l.status === 'declined' || l.status === 'disconnected'),
  }
}

/** The tab to open first: one with a request waiting for you, else one with companies, else Clients. */
export function startTab(links: CompanyLink[]): LinkTab {
  const c = groupLinks(links, 'clients')
  const k = groupLinks(links, 'contractors')
  if (c.waiting.length) return 'clients'
  if (k.waiting.length) return 'contractors'
  if (!c.open.length && k.open.length) return 'contractors'
  return 'clients'
}
