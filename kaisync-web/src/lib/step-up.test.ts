import { describe, expect, it } from 'vitest'
import { isStepUpRequiredMessage } from '@/lib/step-up'

describe('isStepUpRequiredMessage', () => {
  it('detects RPC exception text', () => {
    expect(isStepUpRequiredMessage('STEP_UP_REQUIRED: step-up verification required')).toBe(true)
    expect(isStepUpRequiredMessage('step-up session expired')).toBe(true)
  })

  it('ignores unrelated errors', () => {
    expect(isStepUpRequiredMessage('INSUFFICIENT_ROLE: payments.approve')).toBe(false)
    expect(isStepUpRequiredMessage('Payment approval not found')).toBe(false)
  })
})
