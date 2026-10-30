import { describe, expect, it } from 'vitest'
import { groupLinks, startTab, inviteUrl, linkErrorMessage, myRecordNoun, relationWords, statusWords, type CompanyLink } from './company-links'

describe('company links words', () => {
  it('builds the invite address from the site and token', () => {
    expect(inviteUrl('https://kaisyncworkforce.com/', 'ab_c-1')).toBe('https://kaisyncworkforce.com/dashboard/linked-companies/invite/ab_c-1')
  })

  it('says how the other company relates to us', () => {
    expect(relationWords('provider', 'test company')).toBe('test company is your client')
    expect(relationWords('customer', 'Ironvale')).toBe('Ironvale is your contractor')
    expect(myRecordNoun('provider')).toBe('client')
    expect(myRecordNoun('customer')).toBe('contractor')
  })

  it('describes each status from my side', () => {
    expect(statusWords({ status: 'active', waiting_on_me: false })).toBe('Linked')
    expect(statusWords({ status: 'pending', waiting_on_me: true })).toBe('Waiting for you to accept')
    expect(statusWords({ status: 'pending', waiting_on_me: false })).toBe('Waiting for them to accept')
    expect(statusWords({ status: 'disconnected', waiting_on_me: false })).toBe('Disconnected')
  })

  it('turns database codes into plain messages', () => {
    expect(linkErrorMessage('ONLY_OWNER_HR_ADMIN')).toMatch(/owner, HR or an admin/)
    expect(linkErrorMessage('INVITE_EXPIRED')).toMatch(/expired/)
    expect(linkErrorMessage('ALREADY_LINKED_OR_WAITING')).toMatch(/already linked/)
    expect(linkErrorMessage('')).toMatch(/Something went wrong/)
  })
})

describe('Clients and Contractors tabs', () => {
  const base = { other: { id: 'o', name: 'X', legal_name: null, logo_path: null }, my_record_id: null, my_record_name: null, created_at: '', decided_at: null, ended_at: null }
  const links = [
    { ...base, id: '1', status: 'active', my_role: 'provider', waiting_on_me: false },
    { ...base, id: '2', status: 'pending', my_role: 'provider', waiting_on_me: true },
    { ...base, id: '3', status: 'active', my_role: 'customer', waiting_on_me: false },
    { ...base, id: '4', status: 'disconnected', my_role: 'customer', waiting_on_me: false },
    { ...base, id: '5', status: 'pending', my_role: 'customer', waiting_on_me: false },
  ] as CompanyLink[]

  it('puts companies that are my clients under Clients', () => {
    const g = groupLinks(links, 'clients')
    expect(g.waiting.map(l => l.id)).toEqual(['2'])
    expect(g.open.map(l => l.id)).toEqual(['1'])
    expect(g.ended).toEqual([])
  })

  it('puts companies that are my contractors under Contractors', () => {
    const g = groupLinks(links, 'contractors')
    expect(g.waiting).toEqual([])
    expect(g.open.map(l => l.id)).toEqual(['3', '5'])
    expect(g.ended.map(l => l.id)).toEqual(['4'])
  })

  it('opens the tab that needs attention first', () => {
    expect(startTab(links)).toBe('clients')
    expect(startTab(links.filter(l => l.my_role === 'customer'))).toBe('contractors')
    expect(startTab([])).toBe('clients')
  })
})
