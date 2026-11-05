import { describe, expect, it } from 'vitest'
import { draftEdits, isEdited } from './email-preview'

const base = { subject: 'Invoice INV0001', body: 'Line one.\n\nLine two.', defaultSubject: 'Invoice INV0001', defaultBody: 'Line one.\n\nLine two.' }

describe('draftEdits', () => {
  it('sends nothing when the email is untouched', () => {
    expect(draftEdits(base)).toEqual({})
    expect(isEdited(base)).toBe(false)
    expect(draftEdits(null)).toEqual({})
  })
  it('ignores trailing spaces and Windows line endings', () => {
    expect(draftEdits({ ...base, body: 'Line one.  \r\n\r\nLine two.\n' })).toEqual({})
  })
  it('sends only the parts that changed', () => {
    expect(draftEdits({ ...base, subject: 'Your invoice' })).toEqual({ subject: 'Your invoice' })
    expect(draftEdits({ ...base, body: 'Thanks for the work!' })).toEqual({ body_text: 'Thanks for the work!' })
  })
  it('keeps the standard wording when a box is emptied', () => {
    expect(draftEdits({ ...base, subject: '  ', body: '' })).toEqual({})
  })
})
