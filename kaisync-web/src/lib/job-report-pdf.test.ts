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
})
