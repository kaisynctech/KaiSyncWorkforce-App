import { describe, expect, it } from 'vitest'
import { buildChecklist, checkComplianceFile, type ComplianceDocument, type PackItem } from './api'

const item = (code: string, direction: 'from_party' | 'to_party' = 'from_party'): PackItem => ({
  document_type_code: code, direction, requirement: 'required', validity_days: null, expiry_required: false, weight: 1, notes: null,
})
const doc = (code: string, status: ComplianceDocument['status'], expiry: string | null = null, current = true): ComplianceDocument => ({
  id: code + status, document_type_code: code, direction: 'from_party', document_name: code, storage_path: 'p',
  mime_type: null, file_size_bytes: null, issue_date: null, expiry_date: expiry, status, is_current: current,
  reviewed_at: null, rejected_reason: null, uploaded_by_kind: 'hr', created_at: '2026-10-01', reviewed_by_name: null,
})

describe('buildChecklist', () => {
  it('maps each item to its current document state', () => {
    const rows = buildChecklist(
      [item('a'), item('b'), item('c'), item('d'), item('e'), item('f')],
      [doc('a', 'approved'), doc('b', 'approved', '2026-10-25'), doc('c', 'approved', '2026-09-01'),
       doc('d', 'pending'), doc('e', 'rejected'), doc('f', 'approved', null, false)],
      '2026-10-21',
    )
    expect(rows.map(r => r.state)).toEqual(['approved', 'expiring', 'expired', 'pending', 'rejected', 'missing'])
  })
  it('does not match a from-party document to a to-party item', () => {
    expect(buildChecklist([item('a', 'to_party')], [doc('a', 'approved')])[0].state).toBe('missing')
  })
})

describe('checkComplianceFile', () => {
  it('accepts pdf and rejects exe / large files', () => {
    expect(checkComplianceFile(new File(['x'], 'a.pdf'))).toBeNull()
    expect(checkComplianceFile(new File(['x'], 'a.exe'))).not.toBeNull()
    const big = { name: 'a.pdf', size: 26 * 1024 * 1024 } as File
    expect(checkComplianceFile(big)).not.toBeNull()
  })
})
