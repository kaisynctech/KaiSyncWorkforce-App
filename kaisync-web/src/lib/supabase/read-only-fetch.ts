/**
 * When a company is read-only (KaiSync bill more than 7 days late), the database refuses new or changed
 * business records with a row-level security error naming the billing_read_only_* policy. This turns that
 * raw message into one people understand, everywhere the browser client is used.
 */

export const READ_ONLY_MESSAGE =
  'Your account is read-only because the KaiSync bill is more than 7 days overdue. You can still see everything — pay the bill to make changes again.'

export function friendlyReadOnly(message: string): string | null {
  return /billing_read_only/.test(message) ? READ_ONLY_MESSAGE : null
}

export async function readOnlyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.ok || (res.status !== 401 && res.status !== 403)) return res
  const text = await res.clone().text().catch(() => '')
  if (!friendlyReadOnly(text)) return res
  let body = text
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    body = JSON.stringify({ ...j, message: READ_ONLY_MESSAGE, details: j.message ?? null })
  } catch { /* not JSON — leave as is */ }
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
}
