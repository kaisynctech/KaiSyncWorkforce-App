/**
 * Friendly messages for two database refusals, everywhere the browser client is used:
 * - read-only (KaiSync bill more than 7 days late): an RLS error naming the billing_read_only_* policy;
 * - the Starter limit: adding or reactivating employee 16 on Starter raises PLAN_EMPLOYEE_LIMIT:15
 *   (enforce_plan_employee_limit), whichever way the employee is added (form, import, approval, invite).
 */

export const READ_ONLY_MESSAGE =
  'Your account is read-only because the KaiSync bill is more than 7 days overdue. You can still see everything — pay the bill to make changes again.'

export function friendlyReadOnly(message: string): string | null {
  return /billing_read_only/.test(message) ? READ_ONLY_MESSAGE : null
}

/** The Starter limit, in words (the app shows a "Move to Business" button next to it, see isPlanLimit). */
export function planLimitMessage(limit: number | string): string {
  return `You've reached ${limit} employees, the Starter limit. Move to Business for R2,500/month, including 25 employees and 15 + 15 portal seats.`
}

export function friendlyPlanLimit(message: string): string | null {
  const m = /PLAN_EMPLOYEE_LIMIT:(\d+)/.exec(message)
  return m ? planLimitMessage(m[1]) : null
}

/** True when a message (already made friendly) is the Starter limit. */
export function isPlanLimit(message: string | null | undefined): boolean {
  return Boolean(message && (/the Starter limit/.test(message) || /PLAN_EMPLOYEE_LIMIT/.test(message)))
}

export async function readOnlyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.ok || res.status < 400 || res.status >= 500) return res
  const text = await res.clone().text().catch(() => '')
  const friendly = (res.status === 401 || res.status === 403 ? friendlyReadOnly(text) : null) ?? friendlyPlanLimit(text)
  if (!friendly) return res
  let body = text
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    body = JSON.stringify({ ...j, message: friendly, details: j.message ?? null })
  } catch { /* not JSON — leave as is */ }
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
}
