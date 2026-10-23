import { describe, expect, it } from 'vitest'
import { locationDisplay } from '@/lib/punch-session'

describe('locationDisplay', () => {
  it('shows a street name when one is stored', () => {
    expect(locationDisplay('12 Main Road, Polokwane', -23.9, 29.45)).toBe('12 Main Road, Polokwane')
  })

  it('shows coordinates and No signal when the map point has no street name', () => {
    expect(locationDisplay(null, -23.9, 29.45821)).toBe('-23.90000, 29.45821 — No signal')
  })

  it('shows No signal when the phone has no map point', () => {
    expect(locationDisplay(null, null, null)).toBe('No signal')
  })

  it('shows Manual entry for a manual timesheet with no place', () => {
    expect(locationDisplay(null, null, null, 'Manual timesheet · late paperwork')).toBe('Manual entry')
    expect(locationDisplay('Site office', null, null, 'Manual timesheet')).toBe('Site office')
  })
})
