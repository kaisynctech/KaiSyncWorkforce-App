import { describe, expect, it } from 'vitest'
import { billCheck } from './bill-match'

const f = (n: number) => `R ${n.toFixed(2)}`
const line = (o: number, r: number, i: number) => ({ value_ordered: o, value_received: r, value_invoiced: i })

describe('billCheck', () => {
  it('matches when billed = delivered = ordered', () => {
    expect(billCheck([line(100, 100, 100), line(50, 50, 50)], f).state).toBe('matched')
  })
  it('flags billing more than delivered', () => {
    const c = billCheck([line(100, 60, 100)], f)
    expect(c.state).toBe('over')
    expect(c.overBy).toBe(40)
    expect(c.label).toContain('R 40.00')
  })
  it('waits when not everything is delivered yet but nothing is over-billed', () => {
    const c = billCheck([line(100, 60, 60)], f)
    expect(c.state).toBe('waiting')
    expect(c.notDelivered).toBe(40)
  })
  it('over-billing wins over not delivered', () => {
    expect(billCheck([line(100, 60, 60), line(10, 0, 10)], f).state).toBe('over')
  })
  it('no lines', () => {
    expect(billCheck([], f).state).toBe('none')
  })
})
