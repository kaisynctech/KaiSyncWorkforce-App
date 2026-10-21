import { describe, expect, it } from 'vitest'
import { dueDocuments } from './PortalComplianceReminder'
import type { ContractorDocument } from '@/lib/contractor-portal/types'

const base: ContractorDocument = {
  id: 'x', company_id: 'c', contractor_id: 'k', document_type: 'tax_clearance', document_name: 'TCS',
  file_url: '', storage_path: null, approval_status: 'approved', rejected_reason: null, is_required: true,
  is_current: true, uploaded_by_role: 'hr', expiry_date: null, created_at: '', updated_at: '',
}
const today = new Date(2026, 9, 21)

describe('dueDocuments', () => {
  it('keeps approved documents expiring within 30 days or expired, soonest first', () => {
    const out = dueDocuments([
      { ...base, id: 'a', expiry_date: '2026-11-30' },
      { ...base, id: 'b', expiry_date: '2026-10-28' },
      { ...base, id: 'c', expiry_date: '2026-10-20' },
      { ...base, id: 'd', expiry_date: '2026-10-21' },
    ], today)
    expect(out.map(d => [d.id, d.days])).toEqual([['c', -1], ['d', 0], ['b', 7]])
  })
  it('ignores pending, replaced, no-expiry and our-own documents', () => {
    expect(dueDocuments([
      { ...base, id: 'p', approval_status: 'pending', expiry_date: '2026-10-25' },
      { ...base, id: 'r', is_current: false, expiry_date: '2026-10-25' },
      { ...base, id: 'n' },
      { ...base, id: 'u', direction: 'to_party', expiry_date: '2026-10-25' },
    ], today)).toEqual([])
  })
})
