import { describe, expect, it } from 'vitest'
import { addMonths, pastVisits, serviceForVisit, visitOutcome } from '@/lib/service-plans'

describe('service plan dates', () => {
  it('adds months and keeps month ends sensible', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')
    expect(addMonths('2026-03-26', 0)).toBe('2026-03-26')
  })

  it('counts the visits before today so a new plan starts at its next visit', () => {
    expect(pastVisits('2026-03-26', 3, '2026-10-26')).toBe(3) // Mar, Jun, Sep passed -> next Dec
    expect(pastVisits('2026-03-26', 3, '2026-09-26')).toBe(2) // Sep is today, not past
    expect(pastVisits('2026-11-01', 1, '2026-10-26')).toBe(0)
  })

  it('rotates services', () => {
    const r = ['minor', 'minor', 'major']
    expect([0, 1, 2, 3, 5].map(i => serviceForVisit(r, i))).toEqual(['minor', 'minor', 'major', 'minor', 'major'])
  })
})

describe('visitOutcome', () => {
  const today = '2026-10-26'
  it('classifies visits', () => {
    expect(visitOutcome({ status: 'completed', plan_due_date: '2026-10-01', units: [{ status: 'done' }] }, today)).toBe('done')
    expect(visitOutcome({ status: 'completed', plan_due_date: '2026-10-01', units: [{ status: 'done' }, { status: 'not_done' }] }, today)).toBe('incomplete')
    expect(visitOutcome({ status: 'scheduled', plan_due_date: '2026-10-01', units: [] }, today)).toBe('overdue')
    expect(visitOutcome({ status: 'scheduled', plan_due_date: '2026-10-26', units: [] }, today)).toBe('upcoming')
    expect(visitOutcome({ status: 'cancelled', plan_due_date: '2026-10-01', units: [] }, today)).toBe('cancelled')
  })
})
