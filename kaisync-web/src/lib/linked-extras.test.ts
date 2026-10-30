import { describe, expect, it } from 'vitest'
import type { CompanyLink } from './company-links'
import { extrasError, filterLinks, linkedAlertHref, historyWords, proofFileProblem, sortWork, workHref, type WorkItem } from './linked-extras'

function link(id: string, name: string, status: CompanyLink['status'], record: string | null = null): CompanyLink {
  return {
    id, status, my_role: 'customer', waiting_on_me: false, my_record_id: null, my_record_name: record,
    other: { id: `c-${id}`, name, legal_name: `${name} (Pty) Ltd`, logo_path: null },
    created_at: '2026-10-01', decided_at: null, ended_at: null,
  }
}

const LINKS = [link('1', 'Ironvale Construction', 'active', 'Ironvale'), link('2', 'Blue Pipe Plumbing', 'pending'), link('3', 'Old Co', 'disconnected')]

describe('linked extras', () => {
  it('searches company name, legal name and my record, ignoring case', () => {
    expect(filterLinks(LINKS, 'iron', 'all').map(l => l.id)).toEqual(['1'])
    expect(filterLinks(LINKS, 'PTY', 'all')).toHaveLength(3)
    expect(filterLinks(LINKS, '  ', 'all')).toHaveLength(3)
    expect(filterLinks(LINKS, 'nothing like this', 'all')).toHaveLength(0)
  })

  it('filters by status', () => {
    expect(filterLinks(LINKS, '', 'linked').map(l => l.id)).toEqual(['1'])
    expect(filterLinks(LINKS, '', 'waiting').map(l => l.id)).toEqual(['2'])
    expect(filterLinks(LINKS, 'iron', 'waiting')).toHaveLength(0)
  })

  it('puts quotes first, then invoices, then jobs, soonest first', () => {
    const w = (kind: WorkItem['kind'], date: string | null): WorkItem =>
      ({ kind, date, link_id: 'L', provider: 'P', id: `${kind}${date}`, ref: null, title: null, status: null, amount: null })
    const sorted = sortWork([w('job', '2026-11-02'), w('invoice', '2026-11-30'), w('job', null), w('quote', '2026-10-01'), w('job', '2026-10-30')])
    expect(sorted.map(i => `${i.kind}:${i.date}`)).toEqual(['quote:2026-10-01', 'invoice:2026-11-30', 'job:2026-10-30', 'job:2026-11-02', 'job:null'])
  })

  it('opens each kind of work in the right place', () => {
    const base = { link_id: 'L', provider: 'P', id: 'X', ref: null, title: null, status: null, date: null, amount: null }
    expect(workHref({ ...base, kind: 'job' })).toBe('/dashboard/linked-companies/L/jobs/X')
    expect(workHref({ ...base, kind: 'quote' })).toBe('/dashboard/linked-companies/L/projects/X')
    expect(workHref({ ...base, kind: 'invoice' })).toBe('/dashboard/linked-companies/L?tab=invoices')
  })

  it('checks the proof of payment file', () => {
    expect(proofFileProblem(null)).toMatch(/Choose/)
    expect(proofFileProblem({ name: 'pop.pdf', size: 1000 })).toBeNull()
    expect(proofFileProblem({ name: 'pop.JPG', size: 1000 })).toBeNull()
    expect(proofFileProblem({ name: 'pop.exe', size: 1000 })).toMatch(/PDF/)
    expect(proofFileProblem({ name: 'noextension', size: 1000 })).toMatch(/PDF/)
    expect(proofFileProblem({ name: 'big.pdf', size: 11 * 1024 * 1024 })).toMatch(/10 MB/)
  })

  it('names history actions in plain words', () => {
    expect(historyWords('company_link_accepted')).toBe('Link accepted')
    expect(historyWords('linked_from_provider_invoice')).toBe('Invoice sent')
    expect(historyWords('linked_something_new')).toBe('Something new')
  })

  it('explains database refusals', () => {
    expect(extrasError('INVOICE_CLOSED')).toMatch(/paid or closed/)
    expect(extrasError('LINK_NOT_FOUND')).toMatch(/not found/)
  })

  it('opens linked alerts in the right place', () => {
    const d = { link_id: 'L' }
    expect(linkedAlertHref({ type: 'linked_from_provider_job_assigned', ref_type: 'job', ref_id: 'J', data: d })).toBe('/dashboard/linked-companies/L/jobs/J')
    expect(linkedAlertHref({ type: 'linked_from_provider_quote', ref_type: 'project', ref_id: 'P', data: d })).toBe('/dashboard/linked-companies/L/projects/P')
    expect(linkedAlertHref({ type: 'linked_from_provider_message', ref_type: 'project', ref_id: 'P', data: d })).toBe('/dashboard/linked-companies/L/projects/P?messages=1')
    expect(linkedAlertHref({ type: 'linked_from_provider_invoice', ref_type: 'invoice', ref_id: 'I', data: d })).toBe('/dashboard/linked-companies/L?tab=invoices')
    expect(linkedAlertHref({ type: 'linked_payment_proof', ref_type: 'invoice', ref_id: 'I' })).toBe('/dashboard/money/invoices/I')
    expect(linkedAlertHref({ type: 'leave_request', ref_id: 'x' })).toBeNull()
  })
})
