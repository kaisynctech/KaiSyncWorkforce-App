'use client'

import { useState } from 'react'
import { localDateTimeInputOf, localDateTimeToIso } from '@/lib/schedule-times'
import { fmtReportDate, fmtReportTime, reportDuration, todaySast, type JobReport, type ReportInput } from '@/lib/job-reports'

/** One report as read by the office, the technician or the client. */
export type ReportLike = Pick<JobReport, 'author' | 'report_date' | 'start_time' | 'end_time' | 'work_performed' | 'materials_used' | 'marks_job_complete'>
  & { visible_to_client?: boolean }

export function ReportView({ report, actions }: { report: ReportLike; actions?: React.ReactNode }) {
  const took = reportDuration(report.start_time, report.end_time)
  return (
    <article className="space-y-2 py-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[14px] font-semibold text-text-primary">{fmtReportDate(report.report_date)}</p>
        <p className="text-[12px] text-text-secondary">{report.author ?? 'Office'}</p>
        {(report.start_time || report.end_time) && (
          <p className="text-[12px] text-text-secondary">
            {fmtReportTime(report.start_time)} – {fmtReportTime(report.end_time)}{took ? ` (${took})` : ''}
          </p>
        )}
        {report.marks_job_complete && <span className="text-[11px] font-semibold text-success">Job finished</span>}
        {report.visible_to_client === false && <span className="text-[11px] text-text-secondary">Hidden from client</span>}
        {actions && <span className="ml-auto flex gap-3 text-[12px]">{actions}</span>}
      </header>
      <div>
        <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Work performed</p>
        <p className="text-[13px] text-text-primary mt-0.5 whitespace-pre-wrap">{report.work_performed}</p>
      </div>
      {report.materials_used && (
        <div>
          <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Materials used</p>
          <p className="text-[13px] text-text-primary mt-0.5 whitespace-pre-wrap">{report.materials_used}</p>
        </div>
      )}
    </article>
  )
}

const input =
  'w-full h-10 px-3 rounded-sm bg-surface-elevated border border-border text-[14px] text-text-primary ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30'

function nowTime(): string {
  return localDateTimeInputOf(new Date().toISOString()).slice(11, 16)
}

export function inputFromReport(r: JobReport): ReportInput {
  return {
    reportDate: r.report_date.slice(0, 10),
    startTime: r.start_time,
    endTime: r.end_time,
    workPerformed: r.work_performed,
    materialsUsed: r.materials_used ?? '',
    marksJobComplete: r.marks_job_complete,
  }
}

/**
 * Write or edit a report: the day, start and end time (with "Now" buttons), what was done,
 * materials, and whether this visit finishes the job. `extra` adds fields (e.g. the office picks the technician).
 */
export function ReportForm({
  initial, busy, onSave, onCancel, extra, saveLabel = 'Submit report',
}: {
  initial?: ReportInput
  busy: boolean
  onSave: (value: ReportInput) => void
  onCancel?: () => void
  extra?: React.ReactNode
  saveLabel?: string
}) {
  const [date, setDate] = useState(initial?.reportDate ?? todaySast())
  const [start, setStart] = useState(initial?.startTime ? localDateTimeInputOf(initial.startTime).slice(11, 16) : '')
  const [end, setEnd] = useState(initial?.endTime ? localDateTimeInputOf(initial.endTime).slice(11, 16) : '')
  const [work, setWork] = useState(initial?.workPerformed ?? '')
  const [materials, setMaterials] = useState(initial?.materialsUsed ?? '')
  const [finishes, setFinishes] = useState(initial?.marksJobComplete ?? false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onSave({
      reportDate: date,
      startTime: start ? localDateTimeToIso(date, start) : null,
      endTime: end ? localDateTimeToIso(date, end) : null,
      workPerformed: work,
      materialsUsed: materials,
      marksJobComplete: finishes,
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {extra}
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
          Day
          <input type="date" className={input} value={date} required onChange={e => setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
          <span className="flex justify-between">Start <button type="button" className="text-primary normal-case" onClick={() => setStart(nowTime())}>Now</button></span>
          <input type="time" className={input} value={start} onChange={e => setStart(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
          <span className="flex justify-between">End <button type="button" className="text-primary normal-case" onClick={() => setEnd(nowTime())}>Now</button></span>
          <input type="time" className={input} value={end} onChange={e => setEnd(e.target.value)} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
        Work performed *
        <textarea className={`${input} h-auto py-2 normal-case font-normal`} rows={5} maxLength={20000} required value={work}
          placeholder="What was done, what was found, anything still outstanding…" onChange={e => setWork(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
        Materials used
        <textarea className={`${input} h-auto py-2 normal-case font-normal`} rows={2} maxLength={5000} value={materials}
          onChange={e => setMaterials(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer">
        <input type="checkbox" className="w-5 h-5 accent-primary" checked={finishes} onChange={e => setFinishes(e.target.checked)} />
        This finishes the job (marks it completed)
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !work.trim()} className="btn-primary h-10 px-4 text-[14px] disabled:opacity-50">
          {busy ? 'Saving…' : saveLabel}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="btn-outlined h-10 px-4 text-[14px]">Cancel</button>}
      </div>
    </form>
  )
}
