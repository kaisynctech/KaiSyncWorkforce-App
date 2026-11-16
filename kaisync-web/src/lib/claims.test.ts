import { describe, expect, it } from 'vitest'
import { claimError, haversineKm, suggestTrips } from '@/lib/claims'

const P = (type: string, at: string, lat: number | null, lng: number | null, place: string, job: string | null = null) =>
  ({ type, at, lat, lng, place, job_id: job, job_code: job })

describe('claims', () => {
  it('measures straight-line distance', () => {
    // Johannesburg CBD to Pretoria CBD ≈ 54 km in a straight line
    expect(Math.round(haversineKm({ lat: -26.2041, lng: 28.0473 }, { lat: -25.7479, lng: 28.2293 }))).toBe(54)
  })
  it('suggests a trip when someone clocks out at one place and in at another', () => {
    const t = suggestTrips([
      P('in', '2026-11-12T05:05:00Z', -26.2041, 28.0473, 'Office'),
      P('out', '2026-11-12T06:00:00Z', -26.2041, 28.0473, 'Office'),
      P('in', '2026-11-12T07:00:00Z', -25.7479, 28.2293, 'Pretoria site', 'J0412'),
      P('out', '2026-11-12T10:00:00Z', -25.7479, 28.2293, 'Pretoria site', 'J0412'),
      P('in', '2026-11-12T10:30:00Z', -25.7480, 28.2294, 'Same site'),        // < 1 km: no trip
      P('out', '2026-11-12T12:00:00Z', null, null, 'No position'),
    ])
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ from: 'Office', to: 'Pretoria site', km: 70, job_code: 'J0412' })
  })
  it('explains refusals', () => {
    expect(claimError('KM_RATE_NOT_SET')).toMatch(/rate per km/)
    expect(claimError('ERROR: OWN_CLAIM')).toMatch(/Someone else/)
  })
})
