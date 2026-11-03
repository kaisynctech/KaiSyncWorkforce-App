'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { describeRange, MAX_RANGE_DAYS, PRESETS, rangeProblem, todaySA, type DateRange, type PresetKey } from '@/lib/insights/period'

/** Preset rows first (nobody wants to fight a calendar for "last 30 days"), custom dates underneath. */
export function DateRangePicker({ preset, range, onPreset, onCustom }: {
  preset: PresetKey
  range: DateRange
  onPreset: (k: Exclude<PresetKey, 'custom'>) => void
  onCustom: (r: DateRange) => void
}) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(range.from)
  const [to, setTo] = useState(range.to)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const label = preset === 'custom' ? 'Custom dates' : PRESETS.find(p => p.key === preset)?.label ?? 'Period'
  const problem = rangeProblem({ from, to })

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => { if (!open) { setFrom(range.from); setTo(range.to) } setOpen(o => !o) }}
        className="h-9 pl-3 pr-2 rounded-xl border border-divider bg-surface flex items-center gap-2 text-[13px] hover:border-slate-300"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="material-icons text-[18px] text-slate-500">calendar_today</span>
        <span className="font-medium text-text-primary">{label}</span>
        <span className="text-text-secondary hidden sm:inline">{describeRange(range)}</span>
        <span className="material-icons text-[18px] text-slate-400">expand_more</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1.5 left-0 w-[330px] rounded-2xl border border-divider bg-white shadow-xl overflow-hidden" role="dialog" aria-label="Choose a period">
          <ul className="py-1.5">
            {PRESETS.map(p => (
              <li key={p.key}>
                <button
                  type="button"
                  onClick={() => { onPreset(p.key); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left hover:bg-slate-50"
                >
                  <span className="w-4 shrink-0">
                    {preset === p.key && <span className="material-icons text-[16px] font-bold text-text-primary">check</span>}
                  </span>
                  <span className={cn('flex-1', preset === p.key ? 'font-semibold text-text-primary' : 'text-text-primary')}>{p.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-divider p-3 bg-slate-50/60">
            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide mb-2">Custom dates</p>
            <div className="flex items-center gap-2">
              <input type="date" value={from} max={to || todaySA()} onChange={e => setFrom(e.target.value)} className="input h-9 text-[12.5px] px-2" aria-label="From" />
              <span className="text-text-secondary text-[12px]">to</span>
              <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="input h-9 text-[12.5px] px-2" aria-label="To" />
            </div>
            {problem && from && to && <p className="text-[11.5px] text-error mt-1.5">{problem}</p>}
            <div className="flex items-center justify-between mt-2.5">
              <span className="text-[11px] text-text-secondary">Up to {MAX_RANGE_DAYS} days</span>
              <button
                type="button"
                disabled={!!problem}
                onClick={() => { onCustom({ from, to }); setOpen(false) }}
                className="h-8 px-3 rounded-lg bg-[#1E3A5F] text-white text-[12.5px] font-medium disabled:opacity-40"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
