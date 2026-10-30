import { describe, expect, it } from 'vitest'
import { linkedCompanyCode, parseLinkedCompanyCode, portalHref, type PortalMode } from './portal-mode'
import { linkedCall } from './api'

const C = '551e7107-6e3c-4a1e-a6d3-c18bd7da9df1'
const L = '0f6e1a52-9d1b-4a5e-8f4e-2a7c9b1d3e44'

describe('linked company view', () => {
  it('round-trips the link marker, even after the portal upper-cases codes', () => {
    expect(parseLinkedCompanyCode(linkedCompanyCode(C, L))).toEqual({ companyId: C, linkId: L })
    expect(parseLinkedCompanyCode(linkedCompanyCode(C, L).toUpperCase())).toEqual({ companyId: C, linkId: L })
    expect(parseLinkedCompanyCode('32')).toBeNull()
  })

  it('sends portal calls with a link marker to the linked function', () => {
    const call = linkedCall('client_portal_get_job', { p_company_code: linkedCompanyCode(C, L).toUpperCase(), p_client_code: '', p_job_id: 'j1' })
    expect(call).toEqual({ fn: 'linked_get_job', args: { p_company_id: C, p_link_id: L, p_job_id: 'j1' } })
    expect(linkedCall('client_portal_get_job', { p_company_code: '32', p_client_code: 'C1' })).toBeNull()
    expect(linkedCall('client_portal_accept_quotation', { p_company_code: linkedCompanyCode(C, L), p_client_code: '', p_deal_id: 'd1' }))
      .toEqual({ fn: 'linked_accept_quotation', args: { p_company_id: C, p_link_id: L, p_deal_id: 'd1' } })
    expect(() => linkedCall('client_portal_list_unknown', { p_company_code: linkedCompanyCode(C, L) })).toThrow(/not available/)
  })

  it('builds links inside the portal or inside Linked companies', () => {
    const linked = { kind: 'linked', linkId: L } as PortalMode
    expect(portalHref({ kind: 'portal' }, '/home?tab=jobs')).toBe('/client-portal/home?tab=jobs')
    expect(portalHref(linked, '/home?tab=jobs')).toBe(`/dashboard/linked-companies/${L}?tab=jobs`)
    expect(portalHref(linked, '/projects/p1?messages=1')).toBe(`/dashboard/linked-companies/${L}/projects/p1?messages=1`)
  })
})
