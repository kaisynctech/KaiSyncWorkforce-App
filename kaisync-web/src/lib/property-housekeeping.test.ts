import { describe, expect, it } from 'vitest'
import { housekeepingRef, unitIdFromHousekeepingRef } from '@/lib/property-housekeeping'

describe('housekeeping job refs', () => {
  it('round-trips a room id', () => {
    const id = '11111111-1111-1111-1111-111111111111'
    expect(unitIdFromHousekeepingRef(housekeepingRef(id))).toBe(id)
  })

  it('ignores other job references', () => {
    expect(unitIdFromHousekeepingRef('quote-12')).toBeNull()
    expect(unitIdFromHousekeepingRef(null)).toBeNull()
    expect(unitIdFromHousekeepingRef('housekeeping:')).toBeNull()
  })
})
