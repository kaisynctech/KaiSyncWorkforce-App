/** Extra payslip income and deduction lines stored on payment_approvals.payslip_lines. */

export const WINTERSTECH_COMPANY_ID = 'a3453fd7-d217-42a9-b89a-b61fce77b2fd'

/** Employee share of the MEIBC admin levy, monthly. SEIFSA continuation, April 2026. */
export const MEIBC_ADMIN_LEVY_MONTHLY = 9.57
/** Employee share of the MEIBC dispute levy, monthly. SEIFSA continuation, April 2026. */
export const MEIBC_DISPUTE_LEVY_MONTHLY = 3.46
/** Employee share of the MEIBC sick pay fund, as a fraction of monthly salary. MIBFA. */
export const MEIBC_SICK_PAY_RATE = 0.0009

export type PayslipExtraLine = {
  id: string
  label: string
  amount: number
}

export function moneyCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.round(value * 100) / 100
}

export function sumExtra(lines: PayslipExtraLine[]): number {
  return moneyCents(lines.reduce((sum, line) => sum + moneyCents(line.amount), 0))
}

export function parseExtraLines(raw: unknown): PayslipExtraLine[] {
  if (!Array.isArray(raw)) return []
  const lines: PayslipExtraLine[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const label = String(item.label ?? '').trim()
    if (!label) continue
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : crypto.randomUUID()
    lines.push({ id, label, amount: moneyCents(Number(item.amount)) })
  }
  return lines
}

export function meibcSickPay(regular: number): number {
  return moneyCents(regular * MEIBC_SICK_PAY_RATE)
}

export function winterstechMeibcLines(regular: number): PayslipExtraLine[] {
  return [
    { id: 'meibc-admin', label: 'MEIBC Admin Levy', amount: MEIBC_ADMIN_LEVY_MONTHLY },
    { id: 'meibc-dispute', label: 'MEIBC Dispute Levy', amount: MEIBC_DISPUTE_LEVY_MONTHLY },
    { id: 'meibc-sick', label: 'MEIBC Sick Pay Fund', amount: meibcSickPay(regular) },
  ]
}

/** Keep the sick-pay line on the published 0.09% while it still matches the previous salary. */
export function syncMeibcSickPay(lines: PayslipExtraLine[], previousRegular: number, nextRegular: number): PayslipExtraLine[] {
  const previous = meibcSickPay(previousRegular)
  const next = meibcSickPay(nextRegular)
  return lines.map(line => {
    if (line.id !== 'meibc-sick') return line
    if (Math.abs(line.amount - previous) >= 0.001) return line
    return { ...line, amount: next }
  })
}
