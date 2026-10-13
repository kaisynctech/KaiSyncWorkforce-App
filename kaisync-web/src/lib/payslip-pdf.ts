import { jsPDF } from 'jspdf'

export type PayslipLine = { label: string; amount: number }

export type PayslipPdfInput = {
  id: string
  period_start: string
  period_end: string
  status: string
  gross_pay?: number | null
  deductions?: number | null
  net_pay?: number | null
  working_days?: number | null
  leave_days?: number | null
  absent_days?: number | null
  regular_hours?: number | null
  overtime_hours?: number | null
  regular_pay?: number | null
  overtime_pay?: number | null
  base_salary?: number | null
  pay_basis?: string | null
  earnings_breakdown?: unknown
  deductions_breakdown?: unknown
  ytd_json?: unknown
  paid_at?: string | null
}

function money(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  return `R ${v.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function periodLabel(start: string, end: string): string {
  const fmt = (d: string) =>
    new Date(d.includes('T') ? d : `${d}T12:00:00`).toLocaleDateString('en-ZA', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  return `${fmt(start)} – ${fmt(end)}`
}

function parseLines(raw: unknown): PayslipLine[] {
  if (!raw) return []
  let data = raw
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw) } catch { return [] }
  }
  if (!Array.isArray(data)) return []
  return data.map((row) => {
    const r = row as Record<string, unknown>
    const label = String(r.label ?? r.Label ?? r.name ?? r.Name ?? 'Item')
    const amount = Number(r.amount ?? r.Amount ?? r.value ?? r.Value ?? 0)
    return { label, amount }
  }).filter(l => l.label)
}

function parseYtd(raw: unknown): { gross?: number; paye?: number; uif?: number; net?: number } | null {
  if (!raw) return null
  let data = raw
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw) } catch { return null }
  }
  if (!data || typeof data !== 'object') return null
  const r = data as Record<string, unknown>
  return {
    gross: Number(r.gross_pay ?? r.GrossPay ?? r.gross ?? 0),
    paye: Number(r.paye ?? r.Paye ?? r.PAYE ?? 0),
    uif: Number(r.uif ?? r.Uif ?? r.UIF ?? 0),
    net: Number(r.net_pay ?? r.NetPay ?? r.net ?? 0),
  }
}

/** Parse employee_get_payslips JSON (array or stringified). */
export function parsePayslipsRpcJson(data: unknown): PayslipPdfInput[] {
  let rows: unknown = data
  if (typeof data === 'string') {
    try { rows = JSON.parse(data) } catch { return [] }
  }
  if (!Array.isArray(rows)) return []
  return rows as PayslipPdfInput[]
}

/** Client-side payslip PDF — implements layout. */
export function downloadPayslipPdf(
  payment: PayslipPdfInput,
  employeeName: string,
  companyName: string,
): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const left = 20
  let y = 20
  const line = (label: string, value: string, color: [number, number, number] = [15, 23, 42]) => {
    doc.setTextColor(100, 116, 139)
    doc.setFontSize(9)
    doc.text(label, left, y)
    doc.setTextColor(...color)
    doc.setFont('helvetica', 'bold')
    doc.text(value, 190, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    y += 6
  }
  const section = (title: string) => {
    y += 4
    doc.setTextColor(100, 116, 139)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.text(title, left, y)
    doc.setFont('helvetica', 'normal')
    y += 2
    doc.setDrawColor(226, 232, 240)
    doc.line(left, y, 190, y)
    y += 6
  }

  doc.setTextColor(30, 58, 95)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(companyName || 'Company', left, y)
  y += 8
  doc.setTextColor(59, 130, 246)
  doc.setFontSize(20)
  doc.text('PAYSLIP', left, y)
  y += 2
  doc.setDrawColor(30, 58, 95)
  doc.setLineWidth(0.6)
  doc.line(left, y + 2, 190, y + 2)
  y += 10

  doc.setTextColor(100, 116, 139)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(periodLabel(payment.period_start, payment.period_end), 190, 20, { align: 'right' })
  doc.setFont('helvetica', 'bold')
  doc.text((payment.status || '').toUpperCase(), 190, 26, { align: 'right' })

  doc.setTextColor(15, 23, 42)
  doc.setFontSize(12)
  doc.text(employeeName || 'Employee', left, y)
  y += 8

  section('ATTENDANCE')
  line('Days Worked', `${payment.working_days ?? 0} day(s)`)
  line('Approved Leave', `${Number(payment.leave_days ?? 0).toFixed(1)} day(s)`, [37, 99, 235])
  if (Number(payment.absent_days ?? 0) > 0) {
    line('Absent Days', `${payment.absent_days} day(s)`, [220, 38, 38])
  }

  section('HOURS')
  line('Regular Hours', `${Number(payment.regular_hours ?? 0).toFixed(2)} hrs`)
  if (Number(payment.overtime_hours ?? 0) > 0) {
    line('Overtime Hours', `${Number(payment.overtime_hours).toFixed(2)} hrs`, [217, 119, 6])
  }

  section('EARNINGS')
  if (Number(payment.regular_pay ?? 0) > 0) line('Regular Pay', money(payment.regular_pay))
  if (Number(payment.overtime_pay ?? 0) > 0) line('Overtime Pay', money(payment.overtime_pay), [217, 119, 6])
  if (Number(payment.base_salary ?? 0) > 0 && (payment.pay_basis ?? '') === 'monthly_salary') {
    line('Base salary', money(payment.base_salary))
  }
  const earnLines = parseLines(payment.earnings_breakdown)
  for (const e of earnLines) line(e.label, money(e.amount))
  line('Gross Pay', money(payment.gross_pay))

  const dedLines = parseLines(payment.deductions_breakdown)
  if (dedLines.length > 0) {
    section('DEDUCTIONS')
    for (const d of dedLines) line(d.label, `- ${money(d.amount)}`, [220, 38, 38])
  } else if (Number(payment.deductions ?? 0) > 0) {
    section('DEDUCTIONS')
    line('Deductions', `- ${money(payment.deductions)}`, [220, 38, 38])
  }

  y += 2
  doc.setDrawColor(30, 58, 95)
  doc.setLineWidth(0.6)
  doc.line(left, y, 190, y)
  y += 8
  doc.setFontSize(14)
  doc.setTextColor(30, 58, 95)
  doc.setFont('helvetica', 'bold')
  doc.text('NET PAY', left, y)
  doc.setTextColor(59, 130, 246)
  doc.text(money(payment.net_pay), 190, y, { align: 'right' })
  doc.setFont('helvetica', 'normal')

  const ytd = parseYtd(payment.ytd_json)
  if (ytd) {
    y += 10
    section('YEAR TO DATE (TAX YEAR)')
    line('YTD Gross', money(ytd.gross))
    line('YTD PAYE', money(ytd.paye), [220, 38, 38])
    line('YTD UIF', money(ytd.uif), [220, 38, 38])
    line('YTD Net', money(ytd.net), [37, 99, 235])
  }

  const safe = (employeeName || 'Employee').replace(/[^a-z0-9]+/gi, '_').slice(0, 40)
  const month = (payment.period_start || '').slice(0, 7) || 'period'
  doc.save(`Payslip_${safe}_${month}.pdf`)
}

export type PayslipTemplatePdfInput = {
  companyName: string
  companyAddress?: string | null
  logoDataUrl?: string | null
  employeeName: string
  address?: string | null
  employeeId?: string | null
  employeeNumber?: string | null
  employmentDate?: string | null
  periodStart: string
  periodEnd: string
  hourlyRate: number
  overtimeRate: number
  regular: number
  overtime: number
  bonus: number
  incentive: number
  refund: number
  uif: number
  paye: number
  loanDeduction: number
  loanBalance: number
  unpaidLeave: number
  bankName?: string | null
  bankBranch?: string | null
  bankAccount?: string | null
  paidTimeOff?: number | null
  sickTimeOff?: number | null
}

function dmy(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [year, month, day] = iso.slice(0, 10).split('-')
  if (!year || !month || !day) return iso
  return `${day}-${month}-${year}`
}

export async function imageUrlToDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/** Payslip PDF in the same layout as the on-screen slip, with the company logo. */
export function downloadPayslipTemplatePdf(input: PayslipTemplatePdfInput): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const left = 14
  const right = 196
  const mid = 105
  let y = 16
  const gross = input.regular + input.overtime + input.bonus + input.incentive + input.refund
  const deducted = input.uif + input.paye + input.loanDeduction + input.unpaidLeave
  const net = Math.max(0, Math.round((gross - deducted) * 100) / 100)
  const totalLeave = input.paidTimeOff != null && input.sickTimeOff != null
    ? Math.round((input.paidTimeOff + input.sickTimeOff) * 100) / 100
    : null

  if (input.logoDataUrl) {
    try {
      const kind = input.logoDataUrl.includes('image/png') ? 'PNG' : 'JPEG'
      doc.addImage(input.logoDataUrl, kind, left, y - 2, 18, 18)
    } catch {
      // A logo that cannot be drawn still leaves the company name on the slip.
    }
  }
  doc.setTextColor(15, 23, 42)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(input.companyName || 'Company', input.logoDataUrl ? left + 22 : left, y + 4)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  if (input.companyAddress) doc.text(input.companyAddress, input.logoDataUrl ? left + 22 : left, y + 10, { maxWidth: 110 })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(30, 58, 95)
  doc.text('PAYSLIP', right, y + 4, { align: 'right' })
  y += 24

  const fact = (label: string, value: string, x: number, rowY: number) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text(label, x, rowY)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(15, 23, 42)
    doc.text(value || '—', x + 36, rowY, { maxWidth: 52 })
  }
  const facts: [string, string][] = [
    ['Employee name', input.employeeName || '—'],
    ['Employee address', input.address || '—'],
    ['Employee ID', input.employeeId || '—'],
    ['Employee number', input.employeeNumber || '—'],
    ['Employment date', dmy(input.employmentDate)],
    ['Rate', money(input.hourlyRate)],
    ['Overtime rate', money(input.overtimeRate)],
    ['Pay period begin', dmy(input.periodStart)],
    ['Pay period end', dmy(input.periodEnd)],
  ]
  facts.forEach((row, index) => {
    const col = index % 2
    const rowIndex = Math.floor(index / 2)
    fact(row[0], row[1], col === 0 ? left : mid, y + rowIndex * 6)
  })
  y += Math.ceil(facts.length / 2) * 6 + 4

  doc.setFillColor(239, 246, 255)
  doc.rect(left, y, right - left, 7, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(15, 23, 42)
  doc.text('Earnings', left + 2, y + 5)
  doc.text('Deductions', mid + 2, y + 5)
  y += 12
  const moneyRows: [string, number, string, number][] = [
    ['Regular Earnings', input.regular, 'UIF', input.uif],
    ['Overtime', input.overtime, 'PAYE', input.paye],
    ['Bonus', input.bonus, 'Loan Deduction', input.loanDeduction],
    ['Incentive Pay', input.incentive, 'Loan Balance', input.loanBalance],
    ['Refund', input.refund, 'Unpaid Leave', input.unpaidLeave],
  ]
  for (const [earnLabel, earnAmount, dedLabel, dedAmount] of moneyRows) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(15, 23, 42)
    doc.text(earnLabel, left + 2, y)
    doc.text(money(earnAmount), mid - 4, y, { align: 'right' })
    doc.text(dedLabel, mid + 2, y)
    doc.text(money(dedAmount), right - 2, y, { align: 'right' })
    y += 6
  }
  doc.setDrawColor(226, 232, 240)
  doc.line(left, y - 2, right, y - 2)
  y += 2
  doc.setFont('helvetica', 'bold')
  doc.text('Gross Salary', left + 2, y)
  doc.text(money(gross), mid - 4, y, { align: 'right' })
  doc.text('Total Deduction', mid + 2, y)
  doc.text(money(deducted), right - 2, y, { align: 'right' })
  y += 7
  doc.text('Current NET Salary', left + 2, y)
  doc.text(money(net), mid - 4, y, { align: 'right' })
  y += 10

  doc.setFillColor(239, 246, 255)
  doc.rect(left, y, right - left, 7, 'F')
  doc.text('Payment Information', left + 2, y + 5)
  doc.text('Time Off Balance', mid + 2, y + 5)
  y += 12
  doc.setFont('helvetica', 'normal')
  const foot: [string, string, string, string][] = [
    ['Bank Name', input.bankName || '—', 'Paid time off', input.paidTimeOff == null ? '—' : String(input.paidTimeOff)],
    ['Branch Code', input.bankBranch || '—', 'Sick time off', input.sickTimeOff == null ? '—' : String(input.sickTimeOff)],
    ['Account Number', input.bankAccount || '—', 'Total time off', totalLeave == null ? '—' : String(totalLeave)],
  ]
  for (const [a, b, c, d] of foot) {
    doc.text(a, left + 2, y)
    doc.text(b, mid - 4, y, { align: 'right' })
    doc.text(c, mid + 2, y)
    doc.text(d, right - 2, y, { align: 'right' })
    y += 6
  }

  const safe = (input.employeeName || 'Employee').replace(/[^a-z0-9]+/gi, '_').slice(0, 40)
  const month = (input.periodStart || '').slice(0, 7) || 'period'
  doc.save(`Payslip_${safe}_${month}.pdf`)
}
