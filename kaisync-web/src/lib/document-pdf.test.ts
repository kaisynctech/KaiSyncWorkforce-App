import { describe, expect, it } from 'vitest'
import { buildDocumentPdf, money, pdfBase64 } from './document-pdf'
import { letterheadFromRow } from './letterhead'
import { emailedLabel } from './money/document-email'

describe('document PDF', () => {
  it('builds a credit note with title, lines and totals', () => {
    const doc = buildDocumentPdf({
      letterhead: letterheadFromRow({ name: 'Ironvale' }, 'Ironvale'),
      title: 'Credit note',
      meta: [['Credit note no.', 'CN0001']],
      toLabel: 'Credit to',
      toName: 'Bluewater',
      lines: [{ description: 'Returned contactor', qty: 2, unit_price: 100, total: 200 }],
      totals: [['Total credit', money(200), true]],
      reference: 'CN0001',
    })
    const raw = doc.output()
    expect(raw).toContain('Credit note')
    expect(raw).toContain('Returned contactor')
    expect(raw).toContain('R 200,00')
    expect(pdfBase64(doc).length).toBeGreaterThan(1000)
  })

  it('labels email history', () => {
    const base = { id: '1', recipient_email: 'a@b.co', error_message: null, created_at: '2026-11-05T10:00:00Z', kind: 'invoice' as const }
    expect(emailedLabel({ ...base, status: 'sent' })).toMatch(/^Emailed to a@b\.co · /)
    expect(emailedLabel({ ...base, status: 'failed' })).toMatch(/^Email to a@b\.co failed/)
  })
})
