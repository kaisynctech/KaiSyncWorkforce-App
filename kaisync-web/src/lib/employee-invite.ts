import { createClient as createSupabaseJsClient, type SupabaseClient } from '@supabase/supabase-js'

/** Production app origin used for invite / magic-link redirects. */
export function appOrigin(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    'https://www.kaisyncworkforce.com'
  return raw.replace(/\/$/, '')
}

/**
 * Send a login invite email (magic link / OTP).
 *
 * IMPORTANT: Do not use the SSR browser client for this call. That client uses
 * PKCE and stores a code_verifier in the sender's browser — the invitee then
 * cannot complete the link on their own device ("expired / already used").
 *
 * We send via a disposable anon client with implicit flow so the email link
 * carries tokens the invitee can redeem anywhere.
 */
export async function sendEmployeeInvite(
  _supabase: SupabaseClient,
  opts: { employeeId: string; email: string }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const email = opts.email.trim().toLowerCase()
  if (!email) {
    return { ok: false, message: 'Email is required to send an invite.' }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return { ok: false, message: 'Supabase is not configured in this environment.' }
  }

  const mailer = createSupabaseJsClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'implicit',
    },
  })

  const { error: otpErr } = await mailer.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${appOrigin()}/auth/invite-complete`,
      data: { invited_employee_id: opts.employeeId },
    },
  })

  if (otpErr) {
    return { ok: false, message: otpErr.message }
  }

  return { ok: true }
}
