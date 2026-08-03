import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Send a login invite email (magic link / OTP).
 * Live employees table has no invite_status / invited_at columns.
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
      data: { invited_employee_id: opts.employeeId },
    },
  })

  if (otpErr) {
    return { ok: false, message: otpErr.message }
  }

  return { ok: true }
}
