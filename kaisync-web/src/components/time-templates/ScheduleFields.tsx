'use client'

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

export function ScheduleFields({
  startTime,
  endTime,
  otStart,
  weekendEnabled,
  weekendStart,
  weekendEnd,
  weekendOtStart,
  onStartTime,
  onEndTime,
  onOtStart,
  onWeekendEnabled,
  onWeekendStart,
  onWeekendEnd,
  onWeekendOtStart,
}: {
  startTime: string
  endTime: string
  otStart: string
  weekendEnabled: boolean
  weekendStart: string
  weekendEnd: string
  weekendOtStart: string
  onStartTime: (value: string) => void
  onEndTime: (value: string) => void
  onOtStart: (value: string) => void
  onWeekendEnabled: (value: boolean) => void
  onWeekendStart: (value: string) => void
  onWeekendEnd: (value: string) => void
  onWeekendOtStart: (value: string) => void
}) {
  return (
    <>
      <div className="card p-4 space-y-3">
        <p className="section-label">MONDAY TO FRIDAY</p>
        <TimeField label="Start time" value={startTime} onChange={onStartTime} />
        <TimeField label="End time" value={endTime} onChange={onEndTime} />
        <TimeField
          label="Overtime starts at"
          value={otStart}
          onChange={onOtStart}
          hint="Leave blank to use Payroll → Settings: overtime begins a set number of minutes after the shift ends."
        />
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="section-label">SATURDAY AND SUNDAY</p>
          <button
            type="button"
            role="switch"
            aria-checked={weekendEnabled}
            onClick={() => onWeekendEnabled(!weekendEnabled)}
            className={`relative rounded-pill transition-colors shrink-0 ${weekendEnabled ? 'bg-primary' : 'bg-border'}`}
            style={{ height: '22px', width: '40px' }}
          >
            <span
              className={`absolute top-0.5 left-0.5 rounded-full bg-white shadow transition-transform ${weekendEnabled ? 'translate-x-[18px]' : 'translate-x-0'}`}
              style={{ width: '18px', height: '18px' }}
            />
          </button>
        </div>
        <p className="text-[12px] text-text-secondary">
          {weekendEnabled
            ? 'Saturday and Sunday use these hours.'
            : 'Saturday and Sunday use the Monday to Friday hours.'}
        </p>
        {weekendEnabled && (
          <>
            <TimeField label="Start time" value={weekendStart} onChange={onWeekendStart} />
            <TimeField label="End time" value={weekendEnd} onChange={onWeekendEnd} />
            <TimeField
              label="Overtime starts at"
              value={weekendOtStart}
              onChange={onWeekendOtStart}
              hint="Leave blank to use the company overtime grace after this weekend end time."
            />
          </>
        )}
      </div>
    </>
  )
}
