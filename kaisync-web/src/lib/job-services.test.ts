import { describe, expect, it } from 'vitest'
import { areaOptions, parseAreaRows, servicesOffered, type JobService, type SiteArea } from '@/lib/job-services'

const svc = (id: string, name: string, extra: Partial<JobService> = {}): JobService => ({
  id, company_id: 'c', name, category: null, description: null, default_duration_minutes: null,
  default_price: null, checklist: [], is_active: true, sort_order: 0, ...extra,
})

describe('servicesOffered', () => {
  const all = [svc('a', 'Minor service', { default_price: 450 }), svc('b', 'Major service', { default_price: 900 }), svc('c', 'Old', { is_active: false })]

  it('a client without its own list sees all active company services at the company price', () => {
    const out = servicesOffered(all, [])
    expect(out.map(s => s.name)).toEqual(['Major service', 'Minor service'])
    expect(out.find(s => s.id === 'a')?.price).toBe(450)
  })

  it('a client with a list sees only those, at the agreed price when set', () => {
    const out = servicesOffered(all, [
      { id: 'r1', client_id: 'k', service_id: 'a', agreed_price: 400, notes: null },
      { id: 'r2', client_id: 'k', service_id: 'c', agreed_price: null, notes: null },
    ])
    expect(out.map(s => s.name)).toEqual(['Minor service'])
    expect(out[0].price).toBe(400)
    expect(out[0].forClient).toBe(true)
  })
})

describe('areaOptions', () => {
  it('lists areas in tree order with their path', () => {
    const area = (id: string, name: string, parent: string | null = null): SiteArea =>
      ({ id, site_id: 's', parent_area_id: parent, name, priority: null, notes: null, is_active: true, sort_order: 0 })
    const out = areaOptions([area('2', 'Kitchen', '1'), area('1', 'Brewhouse'), area('3', 'Utilities'), area('4', 'Service Room', '1')])
    expect(out.map(a => a.path)).toEqual(['Brewhouse', 'Brewhouse › Kitchen', 'Brewhouse › Service Room', 'Utilities'])
    expect(out[1].depth).toBe(1)
  })
})

describe('parseAreaRows', () => {
  it('reads Area / Sub-area / Priority columns', () => {
    const { rows, problems } = parseAreaRows([
      ['Area', 'Sub-area', 'Priority'],
      ['Main Lab', 'GC Lab', '1'],
      ['Main Lab', '', 'First priority'],
      ['Line 6', 'Panel room', 2],
      ['', 'Orphan', ''],
    ])
    expect(rows).toEqual([
      { area: 'Main Lab', subArea: 'GC Lab', priority: 1 },
      { area: 'Main Lab', subArea: '', priority: 1 },
      { area: 'Line 6', subArea: 'Panel room', priority: 2 },
    ])
    expect(problems).toHaveLength(1)
  })

  it('reads a grouped schedule like the SAB sheet', () => {
    const { rows } = parseAreaRows([
      ['SAB Rosslyn Air-Conditioning units'],
      ['MONTH OF SERVICE:'],
      ['AREAS', 'MODEL', 'TYPE', 'SIZE', 'QTY'],
      ['BREWHOUSE', '', '', '', ''],
      ['a) Service Room', 'Midea', 'Underceiling', '36 000 btu', 1],
      ['b) Kitchen', '', 'Cassette', '12 000 btu', 1],
      ['Open-plan', 'Samsung', 'Hideaway', '54 000 btu', 2],
      ['Open-plan', 'Difusers', '', '', 8],
      ['CLIENT SIGNATURE'],
      ['AREAS', 'MODEL', 'TYPE', 'SIZE', 'QTY'],
      ['UTILITIES'],
      ['Library', '', 'Midwall-split', '24 000 btu', 1],
    ])
    expect(rows).toEqual([
      { area: 'BREWHOUSE', subArea: '', priority: null },
      { area: 'BREWHOUSE', subArea: 'Service Room', priority: null },
      { area: 'BREWHOUSE', subArea: 'Kitchen', priority: null },
      { area: 'BREWHOUSE', subArea: 'Open-plan', priority: null },
      { area: 'UTILITIES', subArea: '', priority: null },
      { area: 'UTILITIES', subArea: 'Library', priority: null },
    ])
  })

  it('reads equipment lines from the SAB layout, skipping "-" rows', () => {
    const { units } = parseAreaRows([
      ['AREAS', 'MODEL', 'TYPE', 'INVERTER / NON-INVERTER', 'SIZE', 'QTY'],
      ['BREWHOUSE', '', '', '', '', ''],
      ['a) Service Room', 'Midea', 'Underceiling ', '', '36 000 btu', 1],
      ['UTILITIES'],
      ['Ongezwas Office', '-', '-', '', '-', '-'],
      ['Issuing Office', '', 'Midwall-split', 'Inverter', '18 000 btu', 1],
      ['Open-plan', '', 'Difusers', '', '', 8],
    ])
    expect(units).toEqual([
      { area: 'BREWHOUSE', subArea: 'Service Room', make: 'Midea', type: 'Underceiling', size: '36 000 btu', quantity: 1, notes: '' },
      { area: 'UTILITIES', subArea: 'Issuing Office', make: '', type: 'Midwall-split', size: '18 000 btu', quantity: 1, notes: 'Inverter' },
      { area: 'UTILITIES', subArea: 'Open-plan', make: '', type: 'Difusers', size: '', quantity: 8, notes: '' },
    ])
  })

  it('asks for a header row when there is none', () => {
    expect(parseAreaRows([['x', 'y']]).problems[0]).toMatch(/Area/)
  })
})
