import { describe, expect, it } from 'vitest'
import { isLinkedExtra, isReimbursement, mergeLinkedExtras, taxableExtraSum, type PayslipExtraLine } from './payslip-extra-lines'

const manual: PayslipExtraLine = { id: 'abc', label: 'Tool allowance', amount: 300 }

describe('claims and commission on the payslip', () => {
  it('keeps hand-typed lines and adds the linked ones', () => {
    const r = mergeLinkedExtras([manual], [
      { kind: 'claim', id: 'c1', label: 'Reimbursement · Travel 20 km 10 Nov', amount: 90, taxable: false },
      { kind: 'commission', id: 'm1', label: 'Commission · QU1', amount: 500, taxable: true },
    ])
    expect(r.changed).toBe(true)
    expect(r.lines.map(l => l.id)).toEqual(['abc', 'claim:c1', 'commission:m1'])
  })
  it('drops a linked line that is no longer on the payslip and notices nothing changed when it is the same', () => {
    const lines = [manual, { id: 'claim:c1', label: 'Reimbursement · Tolls 05 Dec', amount: 50 }]
    expect(mergeLinkedExtras(lines, []).lines).toEqual([manual])
    expect(mergeLinkedExtras(lines, [{ kind: 'claim', id: 'c1', label: 'Reimbursement · Tolls 05 Dec', amount: 50, taxable: false }]).changed).toBe(false)
  })
  it('leaves reimbursements out of taxable pay', () => {
    const lines = [manual, { id: 'claim:c1', label: 'Reimbursement · Tolls', amount: 50 }, { id: 'commission:m1', label: 'Commission · QU1', amount: 500 }]
    expect(taxableExtraSum(lines)).toBe(800)
    expect(isReimbursement({ id: 'x', label: 'Reimbursement · Parking' })).toBe(true)
    expect(isLinkedExtra(manual)).toBe(false)
  })
})
