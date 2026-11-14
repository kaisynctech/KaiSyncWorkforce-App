/** The client's online invoice / quote (opened from the link in the email, no login). */

import { formatCurrency } from '@/lib/currencies'

export type PublicCompany = Record<string, unknown> & { name?: string | null; brand_logo_path?: string | null }
export type PublicClient = { name?: string | null; legal_name?: string | null; address?: string | null; billing_address?: string | null; vat_number?: string | null; email?: string | null } | null

export type PublicInvoiceView = {
  ok: true; kind: 'invoice'; company: PublicCompany; client: PublicClient
  doc: { number: string | null; status: string; issue_date: string | null; due_date: string | null; notes: string | null; subtotal: number; vat: number; total: number; paid: number; balance: number; currency?: string | null }
  lines: { description: string; quantity: number; unit_price: number; vat_amount: number; total_amount: number }[]
  proofs: { status: string; amount: number | null; created_at: string }[]
  can_pay: boolean; closed: boolean; fully_paid: boolean
}

export type PublicQuoteLine = {
  id?: string; description: string; quantity: number; unit: string | null; unit_sell_price: number; subtotal_sell: number; line_total: number
  /** Template quotations (piece 8): what the client may see of the line. */
  section?: string | null; extra?: Record<string, string>; option_of?: string | null; recurring_period?: 'week' | 'month' | 'year' | null
  is_contingency?: boolean
}

export type PublicQuoteView = {
  ok: true; kind: 'quote'; company: PublicCompany; client: PublicClient
  doc: {
    number: string | null; title: string; status: string; valid_until: string | null; notes: string | null; terms: string | null
    subtotal: number; vat: number; total: number; accepted_at: string | null; declined_at: string | null; expired: boolean; currency?: string | null
    vat_rate?: number
    header_fields?: { label: string; value: string }[]
    deposit?: { pct: number; amount: number } | null
    recurring?: { period: 'week' | 'month' | 'year'; amount: number }[]
  }
  /** The template's columns the client sees (never cost or margin). Empty: a quotation from before templates. */
  columns?: { key: string; label: string }[]
  lines: PublicQuoteLine[]
  /** Options the client can choose instead of a line (while the quotation is open). */
  options?: PublicQuoteLine[]
  messages?: { from_client: boolean; author_name: string | null; body: string; created_at: string }[]
  /** The deposit invoice issued when the quotation was accepted. */
  deposit_invoice?: { number: string | null; due_date: string | null; total: number; paid: number; balance: number; status: string; proofs: { status: string; amount: number | null; created_at: string }[] } | null
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

export const randZA = (n: number | null | undefined, currency?: string | null) =>
  formatCurrency(n ?? 0, currency)

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

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/**
 * The quotation as the client has chosen it: each chosen option replaces its line; contingency, VAT, deposit and
 * monthly amounts follow. `choices` maps a line id to the option id picked for it.
 */
export function quoteWithChoices(v: Pick<PublicQuoteView, 'doc' | 'lines' | 'options'>, choices: Record<string, string>) {
  const opts = new Map((v.options ?? []).map(o => [o.id ?? '', o]))
  const base = v.lines.filter(l => !l.is_contingency)
  const origBase = base.reduce((s, l) => s + Number(l.subtotal_sell || 0), 0)
  const lines: PublicQuoteLine[] = []
  for (const l of v.lines) {
    if (l.is_contingency) continue
    const pick = l.id ? opts.get(choices[l.id] ?? '') : undefined
    lines.push(pick && pick.option_of === l.id ? pick : l)
  }
  const newBase = lines.reduce((s, l) => s + Number(l.subtotal_sell || 0), 0)
  for (const c of v.lines.filter(l => l.is_contingency)) {
    const ratio = origBase > 0 ? Number(c.subtotal_sell || 0) / origBase : 0
    const amt = r2(newBase * ratio)
    lines.push({ ...c, unit_sell_price: amt, subtotal_sell: amt })
  }
  const subtotal = r2(lines.reduce((s, l) => s + Number(l.subtotal_sell || 0), 0))
  const rate = Number(v.doc.vat_rate ?? (Number(v.doc.subtotal) > 0 ? Number(v.doc.vat) / Number(v.doc.subtotal) : 0)) || 0
  const vat = r2(subtotal * rate)
  const total = r2(subtotal + vat)
  const pct = Number(v.doc.deposit?.pct ?? 0)
  const recurring: Partial<Record<'week' | 'month' | 'year', number>> = {}
  for (const l of lines) if (l.recurring_period) recurring[l.recurring_period] = r2((recurring[l.recurring_period] ?? 0) + Number(l.subtotal_sell || 0))
  return { lines, subtotal, vat, total, deposit: pct > 0 ? r2(total * pct / 100) : 0, recurring, changed: Object.keys(choices).length > 0 }
}
