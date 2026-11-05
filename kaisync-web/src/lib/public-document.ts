/** The client's online invoice / quote (opened from the link in the email, no login). */

export type PublicCompany = Record<string, unknown> & { name?: string | null; brand_logo_path?: string | null }
export type PublicClient = { name?: string | null; legal_name?: string | null; address?: string | null; billing_address?: string | null; vat_number?: string | null; email?: string | null } | null

export type PublicInvoiceView = {
  ok: true; kind: 'invoice'; company: PublicCompany; client: PublicClient
  doc: { number: string | null; status: string; issue_date: string | null; due_date: string | null; notes: string | null; subtotal: number; vat: number; total: number; paid: number; balance: number }
  lines: { description: string; quantity: number; unit_price: number; vat_amount: number; total_amount: number }[]
  proofs: { status: string; amount: number | null; created_at: string }[]
  can_pay: boolean; closed: boolean; fully_paid: boolean
}

export type PublicQuoteView = {
  ok: true; kind: 'quote'; company: PublicCompany; client: PublicClient
  doc: { number: string | null; title: string; status: string; valid_until: string | null; notes: string | null; terms: string | null; subtotal: number; vat: number; total: number; accepted_at: string | null; declined_at: string | null; expired: boolean }
  lines: { description: string; quantity: number; unit: string | null; unit_sell_price: number; subtotal_sell: number; line_total: number }[]
  can_respond: boolean
}

export type PublicView = PublicInvoiceView | PublicQuoteView
export type PublicResult = { ok: true; message: string } | { ok: false; message: string }

export async function callPublicDocument<T = PublicResult>(token: string, action: string, extra: Record<string, unknown> = {}): Promise<T | { ok: false; message: string }> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  try {
    const res = await fetch(`${base}/functions/v1/public_document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key ?? '', Authorization: `Bearer ${key ?? ''}` },
      body: JSON.stringify({ token, action, ...extra }),
    })
    const body = await res.json().catch(() => null)
    if (!body) return { ok: false, message: 'Could not reach the server. Please try again.' }
    return body as T
  } catch {
    return { ok: false, message: 'Could not reach the server. Please check your connection and try again.' }
  }
}

export function publicLogoUrl(path: string | null | undefined): string | null {
  const p = (path ?? '').trim()
  if (!p) return null
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-branding/${p.split('/').map(encodeURIComponent).join('/')}`
}

export const randZA = (n: number | null | undefined) =>
  `R ${Number(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const dayZA = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? '').split(',')[1] ?? '')
    r.onerror = () => reject(new Error('The file could not be read.'))
    r.readAsDataURL(file)
  })
}
