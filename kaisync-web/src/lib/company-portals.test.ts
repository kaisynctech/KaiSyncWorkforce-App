import { describe, expect, it } from 'vitest'
import { formatPortalMoney, parsePortalFeed, parsePortalList } from './company-portals'

describe('company portals', () => {
  it('splits an empty payload into the two tabs', () => {
    expect(parsePortalList(null)).toEqual({ as_client: [], as_contractor: [], to_decide: [] })
    expect(parsePortalList({ as_client: null })).toEqual({ as_client: [], as_contractor: [], to_decide: [] })
  })

  it('keeps a client connection and drops a row with no kind', () => {
    const list = parsePortalList({
      as_client: [{
        link_id: 'l1',
        kind: 'customer',
        status: 'active',
        host_company_id: 'h',
        other_company_id: 'o',
        company_id: 'h',
        company_name: 'Winterstech',
        company_code: '30',
        record_id: 'c1',
        record_name: 'SAB',
        requested_by_company_id: 'h',
        awaiting: null,
        needs_record: false,
      }, { link_id: 'bad' }],
      to_decide: [{
        link_id: 'l2',
        kind: 'customer',
        status: 'pending',
        host_company_id: 'h',
        other_company_id: 'o',
        company_name: 'Winterstech',
        company_code: '30',
        requested_by_company_id: 'o',
        needs_record: true,
      }],
    })
    expect(list.as_client).toHaveLength(1)
    expect(list.as_client[0].company_name).toBe('Winterstech')
    expect(list.to_decide[0].needs_record).toBe(true)
    expect(list.as_contractor).toEqual([])
  })

  it('reads jobs, quotes and invoices from one feed', () => {
    const feed = parsePortalFeed({
      link: {
        link_id: 'l1',
        kind: 'customer',
        status: 'active',
        company_name: 'Winterstech',
        company_code: '30',
      },
      jobs: [{ id: 'j1', title: 'Service', job_code: 'J1', status: 'open' }],
      quotes: [{ id: 'q1', title: 'Quote', total_amount: '1500.50', currency: 'ZAR', status: 'sent' }],
      invoices: [{ id: 'i1', invoice_number: 'INV1', total_amount: 1500.5, balance_due: 0, status: 'paid' }],
    })
    expect(feed?.jobs[0].title).toBe('Service')
    expect(feed?.quotes[0].total_amount).toBe(1500.5)
    expect(feed?.invoices[0].invoice_number).toBe('INV1')
    expect(formatPortalMoney(feed?.quotes[0].total_amount ?? null, 'ZAR')).toContain('1')
  })
})
