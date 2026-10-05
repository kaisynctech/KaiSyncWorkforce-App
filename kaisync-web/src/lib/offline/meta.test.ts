import { describe, expect, it } from 'vitest'
import { formatLastSynced, networkLooksDown } from '@/lib/offline/meta'

describe('offline meta helpers', () => {
  it('detects network-style failures', () => {
    const online = Object.getOwnPropertyDescriptor(globalThis.navigator, 'onLine')
    Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, get: () => true })
    expect(networkLooksDown('Failed to fetch')).toBe(true)
    expect(networkLooksDown('Network request failed')).toBe(true)
    expect(networkLooksDown('Employee not found')).toBe(false)
    if (online) Object.defineProperty(globalThis.navigator, 'onLine', online)
  })

  it('formats last synced labels', () => {
    expect(formatLastSynced(null)).toBe('Never')
    expect(formatLastSynced('not-a-date')).toBe('Never')
    expect(formatLastSynced('2026-10-01T08:00:00.000Z')).not.toBe('Never')
  })
})
