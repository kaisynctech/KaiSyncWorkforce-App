import { describe, expect, it } from 'vitest'
import { buildComplianceView } from './compliance'
import type { CompliancePackItem, ContractorDocument } from './types'

function doc(partial: Partial<ContractorDocument> & Pick<ContractorDocument, 'document_type' | 'approval_status'>): ContractorDocument {
  return {
    id: partial.id ?? crypto.randomUUID(),
    company_id: 'c1',
    contractor_id: 'ct1',
    document_name: partial.document_name ?? 'file.pdf',
    file_url: 'https://example.com/f.pdf',
    storage_path: null,
    rejected_reason: null,
    is_required: false,
    is_current: true,
    uploaded_by_role: 'hr',
    expiry_date: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

describe('buildComplianceView pack checklist', () => {
  const pack: CompliancePackItem[] = [
    { document_type: 'tax_clearance', requirement: 'required', sort_order: 1 },
    { document_type: 'coida', requirement: 'required', sort_order: 2 },
    { document_type: 'nda', requirement: 'recommended', sort_order: 3 },
  ]

  it('shows missing required types before any upload', () => {
    const view = buildComplianceView([], pack)
    expect(view.has_pack).toBe(true)
    expect(view.required_count).toBe(2)
    expect(view.complete_count).toBe(0)
    expect(view.missing_count).toBe(2)
    expect(view.score_percent).toBe(0)
    expect(view.checklist.map(r => r.status)).toEqual(['missing', 'missing', 'missing'])
  })

  it('scores approved non-expired required docs and counts expiring as complete', () => {
    const future = new Date()
    future.setDate(future.getDate() + 10)
    const expiry = future.toISOString().slice(0, 10)

    const view = buildComplianceView([
      doc({ document_type: 'tax_clearance', approval_status: 'approved' }),
      doc({ document_type: 'coida', approval_status: 'approved', expiry_date: expiry }),
    ], pack)

    expect(view.complete_count).toBe(2)
    expect(view.score_percent).toBe(100)
    expect(view.status_label).toBe('Compliant')
    expect(view.checklist.find(r => r.document_type === 'coida')?.status).toBe('expiring')
  })
})
