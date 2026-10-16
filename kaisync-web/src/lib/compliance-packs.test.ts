import { describe, expect, it } from 'vitest'
import { compliancePackErrorMessage } from '@/lib/compliance-packs'

describe('compliance pack errors', () => {
  it('turns a duplicate pack name into a plain message', () => {
    expect(compliancePackErrorMessage(
      'duplicate key value violates unique constraint "uq_compliance_pack_company_name"',
    )).toBe('A pack with this name already exists.')
  })

  it('turns a colliding pack code into a plain message', () => {
    expect(compliancePackErrorMessage(
      'duplicate key value violates unique constraint "uq_compliance_pack_company_code"',
    )).toBe('Another pack already uses a code close to this name. Choose a different name.')
  })

  it('leaves an unrelated database message unchanged', () => {
    expect(compliancePackErrorMessage('permission denied')).toBe('permission denied')
  })
})
