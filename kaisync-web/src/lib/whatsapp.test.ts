import { describe, expect, it } from 'vitest'
import { waNumber, whatsAppUrl } from '@/lib/whatsapp'

describe('whatsapp', () => {
  it('South African numbers get the country code', () => {
    expect(waNumber('082 123 4567')).toBe('27821234567')
    expect(waNumber('+27 82 123 4567')).toBe('27821234567')
    expect(waNumber('0027821234567')).toBe('27821234567')
    expect(waNumber('')).toBeNull()
    expect(waNumber('123')).toBeNull()
  })
  it('builds the link with the message', () => {
    expect(whatsAppUrl('0821234567', 'Hi & bye')).toBe('https://wa.me/27821234567?text=Hi%20%26%20bye')
    expect(whatsAppUrl(null, 'x')).toBe('https://wa.me/?text=x')
  })
})
