import { describe, expect, it } from 'vitest'
import { meibcSickPay, parseExtraLines, sumExtra, syncMeibcSickPay, winterstechMeibcLines } from '@/lib/payslip-extra-lines'

describe('payslip extra lines', () => {
  it('builds the Winterstech MEIBC employee deductions from the monthly salary', () => {
    const lines = winterstechMeibcLines(10000)
    expect(lines.map(line => line.label)).toEqual([
      'MEIBC Admin Levy',
      'MEIBC Dispute Levy',
      'MEIBC Sick Pay Fund',
    ])
    expect(lines.map(line => line.amount)).toEqual([9.57, 3.46, 9])
    expect(meibcSickPay(18500)).toBe(16.65)
  })

  it('drops a blank extra line and keeps a renamed amount', () => {
    expect(parseExtraLines([
      { id: 'a', label: '  Tool allowance ', amount: 150 },
      { id: 'b', label: '   ', amount: 20 },
    ])).toEqual([{ id: 'a', label: 'Tool allowance', amount: 150 }])
    expect(sumExtra([{ id: 'a', label: 'Tool allowance', amount: 150 }])).toBe(150)
  })

  it('updates sick pay when the salary changes and leaves a hand-edited amount', () => {
    const seeded = winterstechMeibcLines(10000)
    const followed = syncMeibcSickPay(seeded, 10000, 12000)
    expect(followed.find(line => line.id === 'meibc-sick')?.amount).toBe(10.8)
    const edited = seeded.map(line => line.id === 'meibc-sick' ? { ...line, amount: 25 } : line)
    expect(syncMeibcSickPay(edited, 10000, 12000).find(line => line.id === 'meibc-sick')?.amount).toBe(25)
  })
})
