import { describe, expect, it } from 'vitest'
import { guessMapping, planImport, readKind, readMoney } from './catalogue-import'

describe('guessMapping', () => {
  it('recognises common price-list headers', () => {
    const m = guessMapping(['Part Number', 'Description', 'Brand', 'Cost Price', 'Selling Price', 'Qty on hand', 'Item Name'])
    expect(m.sku).toBe('Part Number')
    expect(m.brand).toBe('Brand')
    expect(m.cost).toBe('Cost Price')
    expect(m.price).toBe('Selling Price')
    expect(m.qty).toBe('Qty on hand')
    expect(m.name).toBe('Item Name')
  })
  it('uses each column only once', () => {
    const m = guessMapping(['Price'])
    expect(Object.values(m).filter(v => v === 'Price')).toHaveLength(1)
  })
})

describe('readMoney', () => {
  it('reads South African and international formats', () => {
    expect(readMoney('R 1 234,50')).toBe(1234.5)
    expect(readMoney('1,234.50')).toBe(1234.5)
    expect(readMoney('1.234,50')).toBe(1234.5)
    expect(readMoney(99)).toBe(99)
    expect(readMoney('')).toBeNull()
    expect(readMoney('abc')).toBeNaN()
  })
})

describe('readKind', () => {
  it('maps words to kinds and flags unknowns', () => {
    expect(readKind('Spares', 'service')).toBe('part')
    expect(readKind('Labor', 'part')).toBe('labour')
    expect(readKind('', 'material')).toBe('material')
    expect(readKind('vehicle', 'part')).toBeNull()
  })
})

describe('planImport', () => {
  const map = { name: 'Name', sku: 'Code', price: 'Price', kind: 'Kind' }
  it('updates by part no., then by name, adds the rest, skips bad rows', () => {
    const plan = planImport([
      { Name: 'Alternator', Code: 'ALT-1', Price: '2500', Kind: 'part' },
      { Name: 'Fitting labour', Code: '', Price: '450', Kind: 'labour' },
      { Name: 'Brake pads', Code: 'BP-9', Price: 'x', Kind: 'part' },
      { Name: '', Code: 'Z', Price: '1', Kind: 'part' },
      { Name: 'New thing', Code: 'NEW', Price: '10', Kind: '' },
    ], map, [
      { id: 'a', name: 'Old name', sku: 'alt-1' },
      { id: 'b', name: 'fitting labour', sku: null },
    ], 'part')
    expect(plan.map(p => p.action)).toEqual(['update', 'update', 'skip', 'skip', 'new'])
    expect(plan[0].existingId).toBe('a')
    expect(plan[1].existingId).toBe('b')
    expect(plan[2].problems[0]).toContain('number')
    expect(plan[4].kind).toBe('part')
    expect(plan[0].line).toBe(2)
  })
  it('flags a line that appears twice', () => {
    const plan = planImport([{ Name: 'A', Code: 'X', Price: '1', Kind: '' }, { Name: 'B', Code: 'x', Price: '1', Kind: '' }], map, [], 'part')
    expect(plan[1].action).toBe('skip')
  })
})
