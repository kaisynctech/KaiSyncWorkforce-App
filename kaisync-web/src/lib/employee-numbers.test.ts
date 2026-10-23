import { describe, expect, it } from 'vitest'
import { formatEmployeeNumber, nextEmployeeNumberPreview, validateEmployeeNumberPrefix } from './employee-numbers'

describe('employee numbers', () => {
  it('pads to four digits', () => {
    expect(formatEmployeeNumber('IV', 1)).toBe('IV-0001')
    expect(formatEmployeeNumber('IV', 12345)).toBe('IV-12345')
  })
  it('previews only when a prefix is set', () => {
    expect(nextEmployeeNumberPreview(null)).toBeNull()
    expect(nextEmployeeNumberPreview({ prefix: null, nextNumber: 3, withoutNumber: 0, canEdit: true })).toBeNull()
    expect(nextEmployeeNumberPreview({ prefix: 'AB', nextNumber: 302, withoutNumber: 0, canEdit: true })).toBe('AB-0302')
  })
  it('validates prefixes', () => {
    expect(validateEmployeeNumberPrefix(' iv ')).toEqual({ prefix: 'IV' })
    expect(validateEmployeeNumberPrefix('')).toHaveProperty('error')
    expect(validateEmployeeNumberPrefix('TOOLONG')).toHaveProperty('error')
    expect(validateEmployeeNumberPrefix('I-V')).toHaveProperty('error')
  })
})
