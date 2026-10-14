'use client'

import type { DayScheduleInput } from '@/lib/shift-template-schedule'

function TimeField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-text-secondary font-medium">{label}</label>
      <div className="bg-surface-dark rounded-lg px-3 py-1">
        <input
          type="time"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="bg-transparent text-text-primary outline-none h-9 w-full"
        />
      </div>
      {hint ? <p className="text-[11px] text-text-disabled">{hint}</p> : null}
    </div>
  )
}

function DayCard({
  title,
  dayName,
  day,
  onChange,
}: {
  title: string
  dayName: string
  day: DayScheduleInput
  onChange: (next: DayScheduleInput) => void
}) {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="section-label">{title}</p>
        <button
          type="button"
          role="switch"
          aria-checked={day.enabled}
          aria-label={`${dayName} hours`}
          onClick={() => onChange({ ...day, enabled: !day.enabled })}
          className={`relative rounded-pill transition-colors shrink-0 ${day.enabled ? 'bg-primary' : 'bg-border'}`}
          style={{ height: '22px', width: '40px' }}
        >
          <span
            className={`absolute top-0.5 left-0.5 rounded-full bg-white shadow transition-transform ${day.enabled ? 'translate-x-[18px]' : 'translate-x-0'}`}
            style={{ width: '18px', height: '18px' }}
          />
        </button>
      </div>
      <p className="text-[12px] text-text-secondary">
        {day.enabled
          ? `${dayName} uses these hours.`
          : `${dayName} uses the Monday to Friday hours.`}
      </p>
      {day.enabled && (
        <>
          <TimeField label="Start time" value={day.start} onChange={start => onChange({ ...day, start })} />
          <TimeField
            label="Early overtime starts at"
            value={day.earlyOtStart}
            onChange={earlyOtStart => onChange({ ...day, earlyOtStart })}
            hint={`Leave blank if time before this ${dayName.toLowerCase()} start is not paid.`}
          />
          <TimeField label="End time" value={day.end} onChange={end => onChange({ ...day, end })} />
          <TimeField
            label="Overtime starts at"
            value={day.otStart}
            onChange={otStart => onChange({ ...day, otStart })}
            hint={`Leave blank to use the company overtime grace after this ${dayName.toLowerCase()} end time.`}
          />
        </>
      )}
    </div>
  )
}

export function ScheduleFields({
  startTime,
  endTime,
  otStart,
  earlyOtStart,
  saturday,
  sunday,
  onStartTime,
  onEndTime,
  onOtStart,
  onEarlyOtStart,
  onSaturday,
  onSunday,
}: {
  startTime: string
  endTime: string
  otStart: string
  earlyOtStart: string
  saturday: DayScheduleInput
  sunday: DayScheduleInput
  onStartTime: (value: string) => void
  onEndTime: (value: string) => void
  onOtStart: (value: string) => void
  onEarlyOtStart: (value: string) => void
  onSaturday: (value: DayScheduleInput) => void
  onSunday: (value: DayScheduleInput) => void
}) {
  return (
    <>
      <div className="card p-4 space-y-3">
        <p className="section-label">MONDAY TO FRIDAY</p>
        <TimeField label="Start time" value={startTime} onChange={onStartTime} />
        <TimeField
          label="Early overtime starts at"
          value={earlyOtStart}
          onChange={onEarlyOtStart}
          hint="Leave blank if time before the start is not paid. Set 06:00 on a 07:00 start to pay 06:00–07:00 as overtime."
        />
        <TimeField label="End time" value={endTime} onChange={onEndTime} />
        <TimeField
          label="Overtime starts at"
          value={otStart}
          onChange={onOtStart}
          hint="Leave blank to use the company overtime grace after the shift ends."
        />
      </div>

      <DayCard title="SATURDAY" dayName="Saturday" day={saturday} onChange={onSaturday} />
      <DayCard title="SUNDAY" dayName="Sunday" day={sunday} onChange={onSunday} />
    </>
  )
}
