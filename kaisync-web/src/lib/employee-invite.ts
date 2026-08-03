import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Send a login invite email (magic link / OTP), matching MAUI SendOtpAsync.
 * Updates invite_status when the column exists; surfaces errors to the caller.
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

  // Best-effort status update — column may be missing on older schemas.
  await supabase
    .from('employees')
    .update({
      invite_status: 'sent',
      invited_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', opts.employeeId)

  return { ok: true }
}
