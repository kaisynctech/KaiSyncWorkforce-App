import { describe, expect, it } from 'vitest'
import { inviteUrl, linkErrorMessage, myRecordNoun, relationWords, statusWords } from './company-links'

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
