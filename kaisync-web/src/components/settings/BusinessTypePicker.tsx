'use client'

import { BUSINESS_TYPES } from '@/lib/business-types'

export const MAX_BUSINESS_TYPES = 6

/** "What does your business do?" — tap to pick (up to 6). The first one picked is the main business. */
export function BusinessTypePicker({ value, onChange, disabled }: {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  function toggle(key: string) {
    if (value.includes(key)) onChange(value.filter(k => k !== key))
    else if (value.length < MAX_BUSINESS_TYPES) onChange([...value, key])
  }
  function makeMain(key: string) {
    onChange([key, ...value.filter(k => k !== key)])
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {BUSINESS_TYPES.map(t => {
          const on = value.includes(t.key)
          const main = value[0] === t.key
          const full = !on && value.length >= MAX_BUSINESS_TYPES
          return (
            <li key={t.key}>
              <div
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 min-h-[56px] transition-colors ${
                  on ? 'border-primary bg-primary/5' : 'border-divider bg-surface-card'
                } ${full ? 'opacity-50' : ''}`}
              >
                <button
                  type="button"
                  disabled={disabled || full}
                  onClick={() => toggle(t.key)}
                  aria-pressed={on}
                  className="flex flex-1 min-w-0 items-center gap-3 text-left disabled:cursor-not-allowed"
                >
                  <span className={`material-icons text-[22px] shrink-0 ${on ? 'text-primary' : 'text-text-disabled'}`}>
                    {on ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium text-text-primary">{t.label}</span>
                    <span className="block text-[12px] text-text-secondary">{t.hint}</span>
                  </span>
                </button>
                {on && (main
                  ? <span className="shrink-0 rounded-full bg-primary text-white text-[11px] font-semibold px-2 py-0.5">Main</span>
                  : value.length > 1 && (
                    <button type="button" disabled={disabled} onClick={() => makeMain(t.key)}
                      className="shrink-0 h-8 px-2 text-[12px] font-medium text-primary rounded-lg hover:bg-primary/10">
                      Make main
                    </button>
                  ))}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="text-[12px] text-text-secondary">
        Pick everything you do (up to {MAX_BUSINESS_TYPES}). The main one sets your first quotation template; you can change this any time in Settings › Money.
      </p>
    </div>
  )
}
