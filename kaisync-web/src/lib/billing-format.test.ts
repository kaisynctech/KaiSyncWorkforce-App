import { describe, expect, it } from 'vitest'
import { formatZar } from './billing'

const clean = (s: string) => s.replace(/\s/g, ' ')

describe('formatZar', () => {
  it('keeps whole rands whole', () => {
    expect(clean(formatZar(2500))).toBe('R 2 500')
  })
  it('always shows two cents digits', () => {
    expect(clean(formatZar(220.5))).toBe('R 220,50')
    expect(clean(formatZar(186818.4))).toBe('R 186 818,40')
  })
  it('handles discounts (negative)', () => {
    expect(clean(formatZar(-20757.6))).toContain('20 757,60')
  })
})
