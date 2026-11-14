import { describe, expect, it } from 'vitest'
import { buildJobReportContent, buildVisits, fmtMinutes } from '@/lib/job-report'

const R = (id: string, date: string, author: string, start: string | null, end: string | null, work = 'Work') =>
  ({ id, employee_id: author, author, report_date: date, start_time: start, end_time: end, work_performed: work, materials_used: null })

describe('job report', () => {
  it('a visit report’s own times win; clock-ins fill the days without them', () => {
    const visits = buildVisits(
      [R('r1', '2026-11-18', 'Sipho N.', '2026-11-18T06:05:00Z', '2026-11-18T09:40:00Z')],
      [
        // Same person, same day: ignored (the report wins).
        { employee_id: 's', name: 'Sipho N.', type: 'in', date_time: '2026-11-18T06:00:00Z' },
        { employee_id: 's', name: 'Sipho N.', type: 'out', date_time: '2026-11-18T10:00:00Z' },
        // Another person that day, from clock-ins only.
        { employee_id: 'l', name: 'Lebo M.', type: 'in', date_time: '2026-11-18T07:00:00Z' },
        { employee_id: 'l', name: 'Lebo M.', type: 'out', date_time: '2026-11-18T08:10:00Z' },
        // A clock-in with no clock-out: shown, no time counted.
        { employee_id: 'l', name: 'Lebo M.', type: 'in', date_time: '2026-11-14T07:10:00Z' },
      ],
    )
    expect(visits.map(v => v.date)).toEqual(['2026-11-14', '2026-11-18'])
    expect(visits[0]).toEqual({ date: '2026-11-14', minutes: 0, people: [{ name: 'Lebo M.', arrived: '2026-11-14T07:10:00Z', left: null, minutes: 0 }] })
    expect(visits[1].minutes).toBe(215 + 70)
    expect(visits[1].people.map(p => [p.name, p.minutes])).toEqual([['Lebo M.', 70], ['Sipho N.', 215]])
  })

  it('puts the report together: work in order (with tidied wording), parts added up, checklist', () => {
    const c = buildJobReportContent({
      job: { code: 'JOB-0142', title: 'Geyser', client: 'Bluewater', address: 'Erf 2214', service: null },
      reports: [R('b', '2026-11-18', 'Sipho N.', null, null, 'Fitted new geyser.'), R('a', '2026-11-14', 'Lebo M.', null, null, 'found leak')],
      punches: [],
      checklist: [{ description: 'Pressure test', is_checked: true }, { description: 'CoC', is_checked: false }],
      parts: [{ name: 'Vacuum breaker', qty: 1, unit: 'each' }, { name: 'Vacuum breaker', qty: 1, unit: 'each' }, { name: 'Geyser', qty: 1, unit: null }],
      photos: ['job_photos/x/after/1.jpg'],
      stillToDo: ' CoC by Friday ',
      workEdits: { a: 'Found the leak at the element.' },
    })
    expect(c.work.map(w => w.text)).toEqual(['Found the leak at the element.', 'Fitted new geyser.'])
    expect(c.parts).toEqual([{ name: 'Vacuum breaker', qty: 2, unit: 'each' }, { name: 'Geyser', qty: 1, unit: null }])
    expect(c.checklist).toEqual([{ text: 'Pressure test', done: true }, { text: 'CoC', done: false }])
    expect(c.still_to_do).toBe('CoC by Friday')
    expect(c.visits.map(v => v.date)).toEqual(['2026-11-14', '2026-11-18'])
  })

  it('formats minutes', () => {
    expect(fmtMinutes(410)).toBe('6 h 50')
    expect(fmtMinutes(60)).toBe('1 h')
    expect(fmtMinutes(45)).toBe('45 min')
    expect(fmtMinutes(0)).toBe('—')
  })
})
