/**
 * Money quote send via Edge Function `send_quote_email` (Resend).
 * Falls back to caller when not configured — never invents secrets.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type QuoteEmailSendResult =
  | { ok: true; via: 'resend'; recipient_email?: string }
  | { ok: false; reason: 'not_configured' | 'send_failed' | 'invoke_error'; message?: string }

export async function checkQuoteEmailConfigured(
  supabase: SupabaseClient,
): Promise<{ configured: boolean; from?: string | null }> {
  const { data, error } = await supabase.functions.invoke('send_quote_email', {
    body: { check: true },
  })
  if (error) return { configured: false }
  const body = data as { configured?: boolean; from?: string | null } | null
  return {
    configured: !!body?.configured,
    from: body?.from ?? null,
  }
}

export async function sendQuoteEmailViaResend(
  supabase: SupabaseClient,
  args: {
    quoteId: string
    pdfBase64: string
    recipientEmail?: string | null
    filename?: string
    subject?: string
  },
): Promise<QuoteEmailSendResult> {
  const { data, error } = await supabase.functions.invoke('send_quote_email', {
    body: {
      quote_id: args.quoteId,
      pdf_base64: args.pdfBase64,
      recipient_email: args.recipientEmail?.trim() || undefined,
      filename: args.filename,
      subject: args.subject,
    },
  })

  const body = data as {
    ok?: boolean
    error?: string
    message?: string
    recipient_email?: string
  } | null

  if (body?.error === 'email_not_configured' || error?.message?.includes('email_not_configured')) {
    return { ok: false, reason: 'not_configured', message: body?.message }
  }

  // functions.invoke may put non-2xx JSON in data while also setting error
  if (body?.error === 'email_not_configured') {
    return { ok: false, reason: 'not_configured', message: body.message }
  }

  if (body?.ok) {
    return { ok: true, via: 'resend', recipient_email: body.recipient_email }
  }

  if (body?.error === 'send_failed' || body?.error) {
    return { ok: false, reason: 'send_failed', message: body.message ?? body.error }
  }

  if (error) {
    // 503 not_configured often surfaces as FunctionsHttpError without parsed body
    const ctx = (error as { context?: Response }).context
    if (ctx) {
      try {
        const parsed = await ctx.json() as { error?: string; message?: string }
        if (parsed.error === 'email_not_configured') {
          return { ok: false, reason: 'not_configured', message: parsed.message }
        }
        return { ok: false, reason: 'send_failed', message: parsed.message ?? parsed.error }
      } catch {
        /* fall through */
      }
    }
    return { ok: false, reason: 'invoke_error', message: error.message }
  }

  return { ok: false, reason: 'invoke_error', message: 'Unknown send response' }
}
