/** Email a document from the company (send_document_email) and read its email history (document_emails). */

import type { SupabaseClient } from '@supabase/supabase-js'

export type DocumentEmailKind = 'invoice' | 'credit_note' | 'receipt' | 'purchase_order' | 'remittance_supplier' | 'remittance_contractor'

export type DocumentEmailResult = { ok: true; recipient: string } | { ok: false; message: string }

export type DocumentEmailLog = { id: string; recipient_email: string; status: 'sent' | 'failed'; error_message: string | null; created_at: string; kind: DocumentEmailKind }

export async function sendDocumentEmail(
  supabase: SupabaseClient,
  opts: { kind: DocumentEmailKind; docId: string; recipient: string; message?: string; pdfBase64?: string | null; filename?: string | null },
): Promise<DocumentEmailResult> {
  const { data, error } = await supabase.functions.invoke('send_document_email', {
    body: {
      kind: opts.kind, doc_id: opts.docId, recipient_email: opts.recipient, message: opts.message ?? '',
      pdf_base64: opts.pdfBase64 ?? '', filename: opts.filename ?? '',
      // Online links in the email open on this same site (test or live).
      site_url: typeof window !== 'undefined' ? window.location.origin : '',
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

export async function loadDocumentEmails(supabase: SupabaseClient, docId: string, kinds?: DocumentEmailKind[]): Promise<DocumentEmailLog[]> {
  let q = supabase.from('document_emails').select('id, recipient_email, status, error_message, created_at, kind').eq('doc_id', docId)
  if (kinds?.length) q = q.in('kind', kinds)
  const { data } = await q.order('created_at', { ascending: false }).limit(20)
  return (data ?? []) as DocumentEmailLog[]
}

export function emailedLabel(log: DocumentEmailLog): string {
  const when = new Date(log.created_at).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  return log.status === 'sent' ? `Emailed to ${log.recipient_email} · ${when}` : `Email to ${log.recipient_email} failed · ${when}`
}
