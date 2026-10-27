/**
 * Company letterhead for generated documents (quotes, invoices, statements, payslips).
 * One place decides what the top and bottom of every PDF look like:
 *  - top: logo, company name, registered name, registration and VAT numbers, address and contacts,
 *    with the document title and its key facts on the right;
 *  - bottom: banking details (only where the company switched them on), the footer note and page numbers.
 */

import type { jsPDF } from 'jspdf'
import type { SupabaseClient } from '@supabase/supabase-js'
import { brandByCode, brandLogoUrl } from '@/lib/company-brand'

export type LetterheadBank = {
  holder: string | null
  bankName: string | null
  accountNumber: string | null
  branchCode: string | null
  accountType: string | null
  swift: string | null
}

export type Letterhead = {
  name: string
  legalName: string | null
  registrationNumber: string | null
  vatNumber: string | null
  address: string | null
  postalAddress: string | null
  phone: string | null
  email: string | null
  website: string | null
  logoPath: string | null
  /** Filled by loadLetterheadLogo; the PDF needs the picture itself, not a link. */
  logo: { dataUrl: string; width: number; height: number } | null
  bank: LetterheadBank | null
  showBankOnInvoices: boolean
  showBankOnQuotes: boolean
  footer: string | null
}

const COMPANY_COLUMNS =
  'name, legal_name, registration_number, is_vat_registered, vat_number, address, postal_address, contact_phone, contact_email, website, brand_logo_path, bank_account_holder, bank_name, bank_account_number, bank_branch_code, bank_account_type, bank_swift_code, show_bank_on_invoices, show_bank_on_quotes, document_footer'

const s = (v: unknown): string | null => {
  if (v == null) return null
  const t = String(v).trim()
  return t ? t : null
}

/** Builds a letterhead from a companies row or from a portal letterhead RPC result. */
export function letterheadFromRow(row: Record<string, unknown> | null | undefined, fallbackName = ''): Letterhead {
  const r = row ?? {}
  const bankRaw = (r.bank && typeof r.bank === 'object' ? r.bank : r) as Record<string, unknown>
  const bank: LetterheadBank = {
    holder: s(bankRaw.bank_account_holder ?? bankRaw.holder),
    bankName: s(bankRaw.bank_name),
    accountNumber: s(bankRaw.bank_account_number ?? bankRaw.account_number),
    branchCode: s(bankRaw.bank_branch_code ?? bankRaw.branch_code),
    accountType: s(bankRaw.bank_account_type ?? bankRaw.account_type),
    swift: s(bankRaw.bank_swift_code ?? bankRaw.swift_code),
  }
  const vatOn = r.is_vat_registered === undefined ? true : r.is_vat_registered === true
  return {
    name: s(r.name) ?? (fallbackName.trim() || 'Company'),
    legalName: s(r.legal_name),
    registrationNumber: s(r.registration_number),
    vatNumber: vatOn ? s(r.vat_number) : null,
    address: s(r.address),
    postalAddress: s(r.postal_address),
    phone: s(r.contact_phone ?? r.phone),
    email: s(r.contact_email ?? r.email),
    website: s(r.website),
    logoPath: s(r.brand_logo_path ?? r.logo_path),
    logo: null,
    bank: bank.bankName || bank.accountNumber ? bank : null,
    showBankOnInvoices: r.show_bank_on_invoices === undefined ? true : r.show_bank_on_invoices === true,
    showBankOnQuotes: r.show_bank_on_quotes === true,
    footer: s(r.document_footer),
  }
}

/** Fetches the logo picture so jsPDF can draw it. A missing or broken logo just leaves it out. */
export async function loadLetterheadLogo(supabase: SupabaseClient, lh: Letterhead): Promise<Letterhead> {
  const url = brandLogoUrl(supabase, lh.logoPath)
  if (!url) return lh
  try {
    const res = await fetch(url)
    if (!res.ok) return lh
    const blob = await res.blob()
    const dataUrl = await new Promise<string | null>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
    if (!dataUrl) return lh
    const size = await new Promise<{ width: number; height: number } | null>(resolve => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => resolve(null)
      img.src = dataUrl
    })
    if (!size || !size.width || !size.height) return lh
    return { ...lh, logo: { dataUrl, ...size } }
  } catch {
    return lh
  }
}

/** Office and employee screens: the signed-in user's company, with its logo ready for a PDF. */
export async function companyLetterhead(
  supabase: SupabaseClient,
  companyId: string,
  fallbackName = '',
  companyCode?: string | null,
): Promise<Letterhead> {
  const { data } = await supabase.from('companies').select(COMPANY_COLUMNS).eq('id', companyId).maybeSingle()
  let row = data as Record<string, unknown> | null
  // Code sign-in (technicians without an email login) cannot read the company row: use the public brand.
  if (!row && companyCode) {
    const b = await brandByCode(supabase, companyCode)
    if (b) row = { name: b.name, brand_logo_path: b.logo_path }
  }
  return loadLetterheadLogo(supabase, letterheadFromRow(row, fallbackName))
}

// ── Text blocks (pure, tested) ─────────────────────────────────────────────────

/** Lines under the company name: registered name, numbers, address, contacts. */
export function letterheadDetailLines(lh: Letterhead): string[] {
  const out: string[] = []
  if (lh.legalName && lh.legalName.toLowerCase() !== lh.name.toLowerCase()) out.push(lh.legalName)
  const ids = [
    lh.registrationNumber ? `Reg. no. ${lh.registrationNumber}` : null,
    lh.vatNumber ? `VAT no. ${lh.vatNumber}` : null,
  ].filter(Boolean)
  if (ids.length) out.push(ids.join('  ·  '))
  if (lh.address) out.push(lh.address.replace(/\s*\n\s*/g, ', '))
  if (lh.postalAddress && lh.postalAddress !== lh.address) out.push(`Postal: ${lh.postalAddress.replace(/\s*\n\s*/g, ', ')}`)
  const contacts = [lh.phone, lh.email, lh.website].filter(Boolean)
  if (contacts.length) out.push(contacts.join('  ·  '))
  return out
}

/** Banking block lines, or [] when there is nothing to show. */
export function bankLines(bank: LetterheadBank | null): [string, string][] {
  if (!bank) return []
  const rows: [string, string | null][] = [
    ['Account name', bank.holder],
    ['Bank', bank.bankName],
    ['Account number', bank.accountNumber],
    ['Branch code', bank.branchCode],
    ['Account type', bank.accountType],
    ['SWIFT', bank.swift],
  ]
  return rows.filter((r): r is [string, string] => !!r[1])
}

/** Whether this kind of document shows the banking details. */
export function showsBank(lh: Letterhead, kind: 'invoice' | 'quote' | 'statement' | 'none'): boolean {
  if (!lh.bank) return false
  if (kind === 'invoice' || kind === 'statement') return lh.showBankOnInvoices
  if (kind === 'quote') return lh.showBankOnQuotes
  return false
}

// ── Drawing ────────────────────────────────────────────────────────────────────

export const PAGE = { left: 18, right: 192, bottom: 270 } as const

/**
 * Draws the letterhead at the top of the current page. Returns the y (mm) where the body starts.
 * `meta` rows (e.g. Number, Date, Valid until) sit on the right under the document title.
 */
export function drawLetterhead(
  doc: jsPDF,
  lh: Letterhead,
  opts: { title: string; meta?: [string, string][] },
): number {
  const { left, right } = PAGE
  let y = 14
  let textTop = y

  if (lh.logo) {
    // Fit inside 55 × 22 mm, keeping the shape.
    const maxW = 55, maxH = 22
    const scale = Math.min(maxW / lh.logo.width, maxH / lh.logo.height)
    const w = lh.logo.width * scale, h = lh.logo.height * scale
    try {
      const kind = lh.logo.dataUrl.includes('image/jpeg') || lh.logo.dataUrl.includes('image/jpg') ? 'JPEG' : 'PNG'
      doc.addImage(lh.logo.dataUrl, kind, left, y, w, h)
      textTop = y + h + 5
    } catch {
      textTop = y
    }
  }

  // Right column: document title and its facts.
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(30, 58, 95)
  doc.text(opts.title.toUpperCase(), right, y + 6, { align: 'right' })
  let ry = y + 13
  doc.setFontSize(9)
  for (const [label, value] of opts.meta ?? []) {
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 116, 139)
    doc.text(label, right - 42, ry, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(15, 23, 42)
    doc.text(value || '—', right, ry, { align: 'right' })
    ry += 5
  }

  // Left column: company name and details (under the logo when there is one).
  let ly = Math.max(textTop, lh.logo ? textTop : y + 5)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(lh.logo ? 11 : 15)
  doc.setTextColor(15, 23, 42)
  doc.text(lh.name, left, ly, { maxWidth: 105 })
  ly += lh.logo ? 4.5 : 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  for (const line of letterheadDetailLines(lh)) {
    const wrapped = doc.splitTextToSize(line, 105) as string[]
    doc.text(wrapped, left, ly)
    ly += 3.8 * wrapped.length
  }

  y = Math.max(ly, ry) + 3
  doc.setDrawColor(30, 58, 95)
  doc.setLineWidth(0.5)
  doc.line(left, y, right, y)
  doc.setLineWidth(0.2)
  return y + 8
}

/**
 * Banking details box (when shown) after the body, then the footer note and page numbers on
 * every page. Call last, after all content is drawn.
 */
export function finishDocument(
  doc: jsPDF,
  lh: Letterhead,
  opts: { y: number; bank: boolean; bankHeading?: string; reference?: string | null },
): void {
  const { left, right, bottom } = PAGE
  let y = opts.y
  const rows = opts.bank ? bankLines(lh.bank) : []
  if (rows.length) {
    const h = 9 + rows.length * 4.6 + (opts.reference ? 4.6 : 0)
    if (y + h > bottom) { doc.addPage(); y = 20 }
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(left, y, 100, h, 2, 2, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text(opts.bankHeading ?? 'BANKING DETAILS', left + 4, y + 5.5)
    let by = y + 10.5
    doc.setFontSize(8.5)
    for (const [label, value] of rows) {
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(100, 116, 139)
      doc.text(label, left + 4, by)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(15, 23, 42)
      doc.text(value, left + 34, by)
      by += 4.6
    }
    if (opts.reference) {
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(100, 116, 139)
      doc.text('Reference', left + 4, by)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(15, 23, 42)
      doc.text(opts.reference, left + 34, by)
    }
  }

  const pages = doc.getNumberOfPages()
  const footer = lh.footer ? (doc.splitTextToSize(lh.footer.replace(/\s*\n\s*/g, ' '), right - left - 30) as string[]).slice(0, 2) : []
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setDrawColor(226, 232, 240)
    doc.line(left, 282, right, 282)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(100, 116, 139)
    if (footer.length) doc.text(footer, left, 286)
    else doc.text(lh.legalName || lh.name, left, 286)
    doc.text(`Page ${p} of ${pages}`, right, 286, { align: 'right' })
  }
}
