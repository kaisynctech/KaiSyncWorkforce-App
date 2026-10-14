/**
 * Shared Clients API for the HR web app.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildClientCreatePayload,
  nextClientCode,
  type ClientCreateInput,
} from '@/lib/client-create-payload'
import { logClientEvent } from '@/lib/client-events'

export type ClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export type CreateClientOptions = ClientCreateInput & {
  existingCodes?: (string | null | undefined)[]
  companyCode?: string | null
  /** When true, allocate a permanent C#### code if none provided. */
  assignCode?: boolean
}

async function resolveClientCode(
  supabase: SupabaseClient,
  companyId: string,
  opts?: {
    existingCodes?: (string | null | undefined)[]
    companyCode?: string | null
    explicit?: string | null
  },
): Promise<string | null> {
  if (opts?.explicit?.trim()) return opts.explicit.trim().toUpperCase()

  let codes = opts?.existingCodes
  let companyCode = opts?.companyCode ?? ''

  if (!codes) {
    const [{ data: company }, { data: existing }] = await Promise.all([
      supabase.from('companies').select('code').eq('id', companyId).maybeSingle(),
      supabase.from('clients').select('client_code').eq('company_id', companyId),
    ])
    companyCode = (company as { code?: string | null } | null)?.code ?? ''
    codes = (existing ?? []).map(r => (r as { client_code: string | null }).client_code)
  } else if (opts?.companyCode == null) {
    const { data: company } = await supabase
      .from('companies')
      .select('code')
      .eq('id', companyId)
      .maybeSingle()
    companyCode = (company as { code?: string | null } | null)?.code ?? ''
  }

  const code = nextClientCode(companyCode, codes)
  if (opts?.existingCodes) opts.existingCodes.push(code)
  return code
}

export async function createClientRecord(
  supabase: SupabaseClient,
  input: CreateClientOptions,
): Promise<ClientResult<{ id: string }>> {
  try {
    const clientCode =
      input.clientCode?.trim()
        ? input.clientCode.trim().toUpperCase()
        : input.assignCode
          ? await resolveClientCode(supabase, input.companyId, {
              existingCodes: input.existingCodes,
              companyCode: input.companyCode,
            })
          : null

    const payload = buildClientCreatePayload({
      ...input,
      clientCode,
    })

    const { data, error } = await supabase
      .from('clients')
      .insert(payload)
      .select('id')
      .single()

    if (error) return { ok: false, message: error.message }
    const id = (data as { id: string }).id
    await logClientEvent(supabase, {
      companyId: input.companyId,
      screen: 'HrClientDetails',
      action: 'client_created',
      meta: { client_id: id, name: input.name.trim() },
    })
    return { ok: true, data: { id } }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export type ClientContactDraft = {
  id?: string | null
  name: string
  email?: string | null
  includeInEmails?: boolean
}

/** Replaces the extra people on a client. The primary contact stays on the client row. */
export async function replaceClientContacts(
  supabase: SupabaseClient,
  input: {
    companyId: string
    clientId: string
    contacts: ClientContactDraft[]
  },
): Promise<ClientResult<{ count: number }>> {
  const prepared = input.contacts
    .map(contact => ({
      id: contact.id?.trim() || null,
      name: contact.name.trim(),
      email: contact.email?.trim() || null,
      includeInEmails: Boolean(contact.includeInEmails),
    }))
    .filter(contact => contact.name || contact.email || contact.includeInEmails)

  if (prepared.some(contact => !contact.name)) {
    return { ok: false, message: 'Each extra person needs a name.' }
  }

  const keepIds = prepared.flatMap(contact => contact.id ? [contact.id] : [])
  const { data: existing, error: listError } = await supabase
    .from('client_contacts')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('client_id', input.clientId)
  if (listError) return { ok: false, message: listError.message }

  const removeIds = (existing ?? [])
    .map(row => (row as { id: string }).id)
    .filter(id => !keepIds.includes(id))
  if (prepared.length === 0 && removeIds.length === 0) {
    return { ok: true, data: { count: 0 } }
  }
  if (removeIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('client_contacts')
      .delete()
      .eq('company_id', input.companyId)
      .in('id', removeIds)
    if (deleteError) return { ok: false, message: deleteError.message }
  }

  for (let index = 0; index < prepared.length; index++) {
    const contact = prepared[index]
    const payload = {
      name: contact.name,
      email: contact.email,
      include_in_emails: contact.includeInEmails,
      sort_order: index,
    }
    if (contact.id) {
      const { error } = await supabase
        .from('client_contacts')
        .update(payload)
        .eq('id', contact.id)
        .eq('client_id', input.clientId)
        .eq('company_id', input.companyId)
      if (error) return { ok: false, message: error.message }
    } else {
      const { error } = await supabase.from('client_contacts').insert({
        ...payload,
        company_id: input.companyId,
        client_id: input.clientId,
      })
      if (error) return { ok: false, message: error.message }
    }
  }

  await logClientEvent(supabase, {
    companyId: input.companyId,
    screen: 'HrClientDetails',
    action: 'client_contacts_saved',
    meta: { client_id: input.clientId, count: prepared.length },
  })
  return { ok: true, data: { count: prepared.length } }
}

export type ClientBankDraft = {
  accountHolder?: string | null
  bankName?: string | null
  accountNumber?: string | null
  branchCode?: string | null
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function accountLast4(value: string | null): string | null {
  const compact = (value ?? '').replace(/\s+/g, '')
  if (compact.length < 4) return null
  return compact.slice(-4)
}

/** Saves the refund bank account. The activity log stores only the last four digits. */
export async function saveClientBankDetails(
  supabase: SupabaseClient,
  input: {
    companyId: string
    clientId: string
    bank: ClientBankDraft
  },
): Promise<ClientResult<{ saved: boolean }>> {
  const accountHolder = blankToNull(input.bank.accountHolder)
  const bankName = blankToNull(input.bank.bankName)
  const accountNumber = blankToNull(input.bank.accountNumber)
  const branchCode = blankToNull(input.bank.branchCode)
  const hasDetail = Boolean(accountHolder || bankName || accountNumber || branchCode)

  if (!hasDetail) {
    const { error } = await supabase
      .from('client_bank_details')
      .delete()
      .eq('company_id', input.companyId)
      .eq('client_id', input.clientId)
    if (error) return { ok: false, message: error.message }
  } else {
    const { error } = await supabase.from('client_bank_details').upsert({
      company_id: input.companyId,
      client_id: input.clientId,
      account_holder: accountHolder,
      bank_name: bankName,
      account_number: accountNumber,
      branch_code: branchCode,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id' })
    if (error) return { ok: false, message: error.message }
  }

  await logClientEvent(supabase, {
    companyId: input.companyId,
    screen: 'HrClientDetails',
    action: 'client_banking_saved',
    meta: {
      client_id: input.clientId,
      saved: hasDetail,
      account_last4: accountLast4(accountNumber),
    },
  })
  return { ok: true, data: { saved: hasDetail } }
}
