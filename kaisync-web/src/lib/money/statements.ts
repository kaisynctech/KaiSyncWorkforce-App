/**
 * Statements from the Money pages: client (what they owe you), supplier (what you owe them) and
 * contractor (payouts). Same PDF as the client portal's statement, on the company letterhead.
 */

import { invokePreview, type EmailPreview } from '@/lib/email-preview'
import type { SupabaseClient } from '@supabase/supabase-js'
import { companyLetterhead } from '@/lib/letterhead'
import { buildClientStatement, parseStatementEntries, type ClientStatement } from '@/lib/client-portal/statement'
import { formatRand } from '@/lib/line-items'
import { localISODate } from '@/lib/utils'

export type StatementKind = 'client' | 'supplier' | 'contractor'

const RPC: Record<StatementKind, { fn: string; arg: string }> = {
  client: { fn: 'client_statement', arg: 'p_client_id' },
  supplier: { fn: 'supplier_statement', arg: 'p_supplier_id' },
  contractor: { fn: 'contractor_statement', arg: 'p_contractor_id' },
}

const LABELS: Record<StatementKind, Record<string, string>> = {
  client: { invoice: 'Invoice', payment: 'Payment', credit_note: 'Credit note', refund: 'Refund' },
  supplier: { invoice: 'Bill', payment: 'Payment', credit_note: 'Credit', refund: 'Refund' },
  contractor: { invoice: 'Payout', payment: 'Paid', credit_note: 'Credit', refund: 'Refund' },
}

export async function loadStatement(supabase: SupabaseClient, kind: StatementKind, id: string): Promise<ClientStatement> {
  const { fn, arg } = RPC[kind]
  const { data, error } = await supabase.rpc(fn, { [arg]: id })
  if (error) throw new Error(/NOT_ALLOWED/.test(error.message) ? 'Only the owner, HR and admins can open statements.' : error.message)
  return buildClientStatement(parseStatementEntries(data))
}

const day = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })

/** Build the statement PDF. Returns the jsPDF document and the file name. */
export async function statementPdf(
  supabase: SupabaseClient,
  opts: { kind: StatementKind; id: string; name: string; companyId: string },
) {
  const [st, letterhead, { buildStatementPdf }] = await Promise.all([
    loadStatement(supabase, opts.kind, opts.id),
    companyLetterhead(supabase, opts.companyId),
    import('@/lib/statement-pdf'),
  ])
  const k = opts.kind
  const labels = LABELS[k]
  const summary: [string, string][] = k === 'client'
    ? [['Total invoiced', formatRand(st.totalInvoiced)], ['Total paid', formatRand(st.totalPaid)], ['Credit notes', formatRand(st.totalCredited)], ['Overdue', formatRand(st.overdue)]]
    : k === 'supplier'
      ? [['Total billed', formatRand(st.totalInvoiced)], ['Total paid', formatRand(st.totalPaid)], ['Overdue', formatRand(st.overdue)]]
      : [['Total payouts', formatRand(st.totalInvoiced)], ['Total paid', formatRand(st.totalPaid)]]
  const closing: [string, string] = k === 'client'
    ? [st.balance < 0 ? 'In credit' : 'Balance owing', formatRand(Math.abs(st.balance))]
    : [st.balance < 0 ? 'Paid in advance' : 'We owe you', formatRand(Math.abs(st.balance))]
  const safe = opts.name.replace(/[^\w.-]+/g, '_').slice(0, 40)
  const fileName = `Statement-${safe}-${localISODate()}.pdf`
  const doc = buildStatementPdf({
    letterhead,
    title: k === 'client' ? 'Statement of account' : k === 'supplier' ? 'Supplier statement' : 'Contractor statement',
    toName: opts.name,
    summary,
    closing,
    columns: [
      { label: 'Date', width: 22 },
      { label: 'Type', width: 22 },
      { label: 'Reference', width: 24 },
      { label: 'Description', width: 46 },
      { label: k === 'client' ? 'Debit' : 'Owed', width: 20, align: 'right' },
      { label: k === 'client' ? 'Credit' : 'Paid', width: 20, align: 'right' },
      { label: 'Balance', width: 20, align: 'right' },
    ],
    rows: st.lines.map(l => [
      day(l.entry_date), labels[l.kind] ?? l.kind, l.reference || '—', l.description,
      l.debit ? formatRand(l.debit) : '', l.credit ? formatRand(l.credit) : '', formatRand(l.balance),
    ]),
    bank: k === 'client' && st.balance > 0,
    fileName,
  })
  return { doc, fileName, statement: st }
}

export type ReminderResult = { ok: true; recipient: string } | { ok: false; message: string }

/** Email the client their statement as a payment reminder (send_statement_email). */
export async function sendStatementReminder(
  supabase: SupabaseClient,
  opts: {
    clientId: string; clientName: string; companyId: string; recipient: string; cc?: string[]; message?: string
    edits?: { subject?: string; body_text?: string }
  },
): Promise<ReminderResult> {
  const { doc, fileName, statement } = await statementPdf(supabase, { kind: 'client', id: opts.clientId, name: opts.clientName, companyId: opts.companyId })
  const pdf = doc.output('datauristring').split(',')[1] ?? ''
  const { data, error } = await supabase.functions.invoke('send_statement_email', {
    body: {
      client_id: opts.clientId, recipient_email: opts.recipient, cc: opts.cc ?? [], pdf_base64: pdf, filename: fileName,
      balance: statement.balance, overdue: statement.overdue, message: opts.message ?? '', ...(opts.edits ?? {}),
    },
  })
  const body = data as { ok?: boolean; message?: string; recipient_email?: string } | null
  if (body?.ok) return { ok: true, recipient: body.recipient_email ?? opts.recipient }
  let message = body?.message ?? 'The email could not be sent.'
  try {
    const ctx = await (error as { context?: Response } | null)?.context?.json?.()
    if (ctx?.message) message = ctx.message
  } catch { /* keep message */ }
  return { ok: false, message }
}

/** The statement email as it will arrive, without sending it (the balance comes from the statement). */
export async function previewStatementReminder(
  supabase: SupabaseClient,
  opts: { clientId: string; recipient: string; cc: string[]; edits?: { subject?: string; body_text?: string } },
): Promise<EmailPreview | { error: string }> {
  try {
    const st = await loadStatement(supabase, 'client', opts.clientId)
    return invokePreview(supabase, 'send_statement_email', {
      client_id: opts.clientId, recipient_email: opts.recipient, cc: opts.cc,
      balance: st.balance, overdue: st.overdue, ...(opts.edits ?? {}),
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not load the statement.' }
  }
}
