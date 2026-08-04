import { describe, expect, it } from 'vitest'
import {
  collectContractorPayoutRisks,
  formatBatchContractorPayoutRiskConfirm,
  formatContractorPayoutRiskConfirm,
} from './contractor-payout-gate'

describe('contractor payout soft gate', () => {
  it('returns no risks when clear and verified', () => {
    expect(collectContractorPayoutRisks({
      banking_verified: true,
      payment_hold: false,
      compliance_hold: false,
    })).toEqual([])
    expect(formatContractorPayoutRiskConfirm({
      name: 'Acme',
      banking_verified: true,
      payment_hold: false,
      compliance_hold: false,
    }, 'Create payout')).toBeNull()
  })

  it('lists holds and unverified banking', () => {
    const risks = collectContractorPayoutRisks({
      banking_verified: false,
      payment_hold: true,
      compliance_hold: true,
    })
    expect(risks).toEqual([
      'payment hold is on',
      'compliance hold is on',
      'banking is not verified',
    ])
    const msg = formatContractorPayoutRiskConfirm({
      name: 'Acme Civils',
      banking_verified: false,
      payment_hold: true,
      compliance_hold: false,
    }, 'Mark paid')
    expect(msg).toContain('Acme Civils')
    expect(msg).toContain('warning only')
    expect(msg).toContain('Mark paid anyway')
  })

  it('formats batch warnings', () => {
    const msg = formatBatchContractorPayoutRiskConfirm([
      { name: 'A', banking_verified: false, payment_hold: false, compliance_hold: false },
      { name: 'B', banking_verified: true, payment_hold: true, compliance_hold: false },
    ], 'Mark paid')
    expect(msg).toContain('2 contractor')
    expect(msg).toContain('A:')
    expect(msg).toContain('B:')
  })
})
