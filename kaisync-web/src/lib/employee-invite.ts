import type { SupabaseClient } from '@supabase/supabase-js'

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
 * Live employees table has no invite_status / invited_at columns.
 *
 * Always sets emailRedirectTo so links do not fall back to a stale
 * Supabase Auth Site URL (e.g. a deleted Vercel preview domain).
 */
export async function sendEmployeeInvite(
  supabase: SupabaseClient,
  opts: { employeeId: string; email: string }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const email = opts.email.trim().toLowerCase()
  if (!email) {
    return { ok: false, message: 'Email is required to send an invite.' }
  }

  const { error: otpErr } = await supabase.auth.signInWithOtp({
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
