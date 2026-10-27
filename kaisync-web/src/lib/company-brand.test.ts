import { describe, expect, it } from 'vitest'
import { brandColour, brandInitials } from '@/lib/company-brand'

describe('brand badge', () => {
  it('makes two letters from the company name', () => {
    expect(brandInitials('Winterstech Air Conditioning')).toBe('WA')
    expect(brandInitials('Ironvale Construction (Playground)')).toBe('IC')
    expect(brandInitials('Ironvale')).toBe('IR')
    expect(brandInitials('')).toBe('K')
  })
  it('gives the same colour to the same name', () => {
    expect(brandColour('Winterstech')).toBe(brandColour('Winterstech'))
    expect(brandColour('Winterstech')).toMatch(/^#[0-9A-F]{6}$/i)
  })
})
