import { afterEach, describe, expect, it, vi } from 'vitest'
import { locationPermission, locationProblemText } from './geo-location'

function phone(geo: boolean, state?: string, throws = false) {
  vi.stubGlobal('navigator', {
    userAgent: 'Android',
    geolocation: geo ? {} : undefined,
    permissions: state === undefined ? undefined : { query: async () => { if (throws) throw new Error('x'); return { state } } },
  })
}

describe('location permission on opening', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the phone permission without prompting', async () => {
    phone(true, 'granted'); expect(await locationPermission()).toBe('granted')
    phone(true, 'prompt'); expect(await locationPermission()).toBe('prompt')
    phone(true, 'denied'); expect(await locationPermission()).toBe('denied')
  })
  it('falls back safely on older phones', async () => {
    phone(true); expect(await locationPermission()).toBe('unknown')
    phone(true, 'granted', true); expect(await locationPermission()).toBe('unknown')
    phone(false, 'granted'); expect(await locationPermission()).toBe('denied')
  })
  it('never calls a missing location "No signal"', () => {
    phone(true, 'granted')
    for (const r of ['denied', 'timeout', 'unavailable', 'unsupported'] as const) {
      expect(locationProblemText(r)).not.toMatch(/no signal/i)
      expect(locationProblemText(r)).toMatch(/clock in without it/)
    }
    expect(locationProblemText('denied')).toMatch(/Location is off/)
    expect(locationProblemText('timeout')).toMatch(/not found yet/)
  })
})
