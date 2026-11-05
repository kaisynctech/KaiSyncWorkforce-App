/**
 * Email preview + editing. The email functions answer { preview: true } with the finished email without
 * sending it; an edited subject/message is sent back as { subject, body_text } (see
 * supabase/functions/_shared/compose.ts). Only what the user changed is sent, so untouched emails keep
 * the standard wording (and its bold amounts).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type EmailPreview = {
  from: string
  replyTo: string | null
  to: string
  cc: string[]
  subject: string
  defaultSubject: string
  /** The standard message as plain text, for the editable box. */
  bodyText: string
  html: string
}

/** What the user is writing: the subject and message, plus the standard ones to compare against. */
export type EmailDraft = { subject: string; body: string; defaultSubject: string; defaultBody: string }

/** Only the parts the user changed (empty object when nothing was edited). */
export function draftEdits(d: EmailDraft | null): { subject?: string; body_text?: string } {
  if (!d) return {}
  const out: { subject?: string; body_text?: string } = {}
  if (d.subject.trim() && d.subject.trim() !== d.defaultSubject.trim()) out.subject = d.subject.trim()
  if (d.body.trim() && norm(d.body) !== norm(d.defaultBody)) out.body_text = d.body.trim()
  return out
}
const norm = (s: string) => s.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim()

export function isEdited(d: EmailDraft | null): boolean {
  const e = draftEdits(d)
  return Boolean(e.subject || e.body_text)
}

/** Calls an email function in preview mode and reads its answer (or its error message). */
export async function invokePreview(
  supabase: SupabaseClient, fn: string, body: Record<string, unknown>,
): Promise<EmailPreview | { error: string }> {
  const { data, error } = await supabase.functions.invoke(fn, {
    body: { ...body, preview: true, site_url: typeof window !== 'undefined' ? window.location.origin : '' },
  })
  const r = data as {
    ok?: boolean; from?: string; reply_to?: string | null; to?: string; cc?: string[]; subject?: string
    default_subject?: string; body_text?: string; html?: string; message?: string
  } | null
  if (r?.ok && r.html) {
    return {
      from: r.from ?? '', replyTo: r.reply_to ?? null, to: r.to ?? '', cc: r.cc ?? [], subject: r.subject ?? '',
      defaultSubject: r.default_subject ?? r.subject ?? '', bodyText: r.body_text ?? '', html: r.html,
    }
  }
  let message = r?.message ?? 'Could not load the preview.'
  try {
    const ctx = await (error as { context?: Response } | null)?.context?.json?.()
    if (ctx?.message) message = ctx.message
  } catch { /* keep message */ }
  return { error: message }
}
