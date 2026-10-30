import { describe, expect, it } from 'vitest'
import { linkedJobError, preferredStartIso } from './linked-jobs'

describe('linked jobs', () => {
  it('turns the form date-time into a time the database stores', () => {
    expect(preferredStartIso('')).toBeNull()
    expect(preferredStartIso('not a date')).toBeNull()
    expect(preferredStartIso('2026-11-02T08:00')).toBe(new Date('2026-11-02T08:00').toISOString())
  })

  it('explains database refusals in plain words', () => {
    expect(linkedJobError('TITLE_REQUIRED')).toMatch(/title/)
    expect(linkedJobError('JOB_ALREADY_ASSIGNED')).toMatch(/Send a message/)
    expect(linkedJobError('JOB_NOT_YOURS')).toMatch(/your company created/)
    expect(linkedJobError(undefined)).toMatch(/Something went wrong/)
  })
})
