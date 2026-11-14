import { describe, expect, it } from 'vitest'
import { buildJobReportPdf } from '@/lib/job-report-pdf'
import { letterheadFromRow } from '@/lib/letterhead'
import { buildJobReportContent } from '@/lib/job-report'

describe('job report PDF', () => {
  it('has the job, the work, the time, the client comment and never a price', () => {
    const content = buildJobReportContent({
      job: { code: 'JOB-0142', title: 'Geyser replacement', client: 'Bluewater', address: 'Erf 2214', service: null },
      reports: [{ id: 'a', employee_id: 's', author: 'Sipho N.', report_date: '2026-11-18', start_time: '2026-11-18T06:00:00Z', end_time: '2026-11-18T09:30:00Z', work_performed: 'Fitted new geyser.', materials_used: null }],
      punches: [], checklist: [{ description: 'CoC', is_checked: false }], parts: [{ name: 'Vacuum breaker', qty: 2, unit: 'each' }],
      photos: [], stillToDo: 'CoC by Friday',
    })
    const doc = buildJobReportPdf({
      letterhead: letterheadFromRow({ name: 'Ironvale' }), content, status: 'not_happy',
      client: { name: 'Mrs Dlamini', signature: null, at: '2026-11-18T10:00:00Z', comment: 'Water still dripping' },
    })
    const text = doc.output().replace(/\\([()])/g, '$1')
    for (const s of ['JOB REPORT', 'JOB-0142', 'Fitted new geyser.', '3 h 30', 'Vacuum breaker', 'CoC by Friday', 'Water still dripping', 'Client not happy']) expect(text).toContain(s)
    expect(text).not.toMatch(/\bR \d/)
  })

  it('stays small with two phone signatures (pictures are compressed)', () => {
    const content = buildJobReportContent({
      job: { code: 'JOB-1', title: 'T', client: null, address: null, service: null },
      reports: [], punches: [], checklist: [], parts: [], photos: [], stillToDo: '',
    })
    const doc = buildJobReportPdf({
      letterhead: letterheadFromRow({ name: 'Ironvale' }), content, status: 'signed',
      technician: { name: 'Tech', signature: SIG, at: '2026-11-18T10:00:00Z' },
      client: { name: 'Client', signature: SIG, at: '2026-11-18T10:00:00Z', comment: null },
    })
    // Uncompressed, two 680×320 signatures alone are about 1.7 MB.
    expect(doc.output().length).toBeLessThan(150_000)
  })
})

/** A 680×320 transparent PNG with one stroke, like the signature pad makes. */
const SIG = 'data:image/png;base64,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'
