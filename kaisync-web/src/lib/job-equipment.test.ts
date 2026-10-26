import { describe, expect, it } from 'vitest'
import { areaAndInner, equipmentName } from '@/lib/job-equipment'
import { areaOptions, type SiteArea } from '@/lib/job-services'

const area = (id: string, name: string, parent: string | null = null): SiteArea =>
  ({ id, site_id: 's', parent_area_id: parent, name, priority: null, notes: null, is_active: true, sort_order: 0 })

describe('equipment helpers', () => {
  it('names a unit with make, type, size and quantity', () => {
    expect(equipmentName({ asset_type: 'Hideaway', label: null, manufacturer: 'Samsung', model_number: null, capacity: '54 000 btu', quantity: 2 }))
      .toBe('Samsung Hideaway · 54 000 btu × 2')
    expect(equipmentName({ asset_type: 'Cassette', label: 'AC-07', manufacturer: null, model_number: null, capacity: null, quantity: 1 }))
      .toBe('AC-07 Cassette')
  })

  it('finds an area and every area inside it', () => {
    const opts = areaOptions([area('1', 'Brewhouse'), area('2', 'Kitchen', '1'), area('3', 'Pantry', '2'), area('4', 'Utilities')])
    expect([...areaAndInner('1', opts)].sort()).toEqual(['1', '2', '3'])
    expect([...areaAndInner('4', opts)]).toEqual(['4'])
  })
})
