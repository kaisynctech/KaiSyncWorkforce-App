/**
 * MAUI StepUpVerificationService parity for KaiSync web.
 * On STEP_UP_REQUIRED: re-auth with password → hr_confirm_step_up → retry.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type StepUpResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

/** In-memory window (slightly under DB 15 minutes), same idea as MAUI. */
let stepUpValidUntilMs = 0

export function isStepUpRequiredMessage(message: string): boolean {
  const m = message.toLowerCase()
  return m.includes('step_up_required') || m.includes('step-up') || m.includes('step up')
}

export async function checkStepUpValid(
  supabase: SupabaseClient,
  companyId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('hr_check_step_up_valid', {
    p_company_id: companyId,
  })
  if (error) return false
  return Boolean(data)
}

export async function confirmStepUp(
  supabase: SupabaseClient,
  companyId: string
): Promise<StepUpResult<void>> {
  const { error } = await supabase.rpc('hr_confirm_step_up', {
    p_company_id: companyId,
  })
  if (error) return { ok: false, message: error.message }
  stepUpValidUntilMs = Date.now() + 14.5 * 60 * 1000
  return { ok: true, data: undefined }
}

export async function recordStepUpFailure(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ failedAttempts: number; lockedUntil: string | null }> {
  const { data, error } = await supabase.rpc('hr_record_step_up_failure', {
    p_company_id: companyId,
  })
  if (error) return { failedAttempts: 0, lockedUntil: null }
  const row = Array.isArray(data) ? data[0] : data
  return {
    failedAttempts: Number((row as { failed_attempts?: number } | null)?.failed_attempts ?? 0),
    lockedUntil: ((row as { locked_until?: string | null } | null)?.locked_until ?? null) as
      | string
      | null,
  }
}

function formatLockoutMessage(failedAttempts: number, lockedUntil: string | null): string {
  if (lockedUntil) {
    const until = new Date(lockedUntil).getTime()
    if (until > Date.now()) {
      const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000))
      return `Too many failed attempts. Step-up verification locked for ${mins} minute(s).`
    }
  }
  const remaining = Math.max(0, 3 - failedAttempts)
  return `Incorrect password. ${remaining} attempt(s) remaining before lockout.`
}

/**
 * Runs a sensitive action; on STEP_UP_REQUIRED prompts for password (via callback),
 * re-authenticates, confirms step-up session, and retries once.
 */
export async function executeWithStepUp<T>(
  supabase: SupabaseClient,
  companyId: string,
  action: () => Promise<StepUpResult<T>>,
  promptPassword: () => Promise<string | null>
): Promise<StepUpResult<T>> {
  const first = await action()
  if (first.ok || !isStepUpRequiredMessage(first.message)) return first

  // Fast path: recent in-memory window — refresh DB session and retry
  if (Date.now() < stepUpValidUntilMs) {
    const conf = await confirmStepUp(supabase, companyId)
    if (!conf.ok) return conf
    return action()
  }

  // DB may already have a valid session (another tab)
  if (await checkStepUpValid(supabase, companyId)) {
    const conf = await confirmStepUp(supabase, companyId)
    if (!conf.ok) return conf
    return action()
  }

  const password = await promptPassword()
  if (password == null || password.trim() === '') {
    return { ok: false, message: 'Step-up verification cancelled.' }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const email = user?.email
  if (!email) {
    return { ok: false, message: 'Cannot determine current user email for step-up verification.' }
  }

  const { error: signErr } = await supabase.auth.signInWithPassword({
    email,
    password: password.trim(),
  })
  if (signErr) {
    const fail = await recordStepUpFailure(supabase, companyId)
    return { ok: false, message: formatLockoutMessage(fail.failedAttempts, fail.lockedUntil) }
  }

  const conf = await confirmStepUp(supabase, companyId)
  if (!conf.ok) return conf
  return action()
}
