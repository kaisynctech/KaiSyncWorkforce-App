'use client'

import { useId, useMemo, useState } from 'react'

export type PickerOption = {
  id: string
  /** Main text, e.g. the client or person's name. */
  label: string
  /** Small text on the right, e.g. client code or employee number. */
  detail?: string | null
  /** Extra words that should also match (account number, department…). */
  keywords?: string | null
}

type Props = {
  options: PickerOption[]
  value: string
  onChange: (id: string) => void
  label: string
  /** e.g. "client" / "employee" — used in the placeholder and messages. */
  noun: string
  placeholder?: string
  disabled?: boolean
  /** How many matches to show at once (keep typing to narrow). */
  maxShown?: number
}

/** Every typed word must appear somewhere in the label, detail or keywords, in any order and any case. */
export function matchOptions<T extends PickerOption>(options: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return options
  return options.filter(o => {
    const hay = `${o.label} ${o.detail ?? ''} ${o.keywords ?? ''}`.toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

/**
 * Type-to-search single picker for long lists (hundreds of clients or staff).
 * Shows the chosen item; typing filters; arrows + Enter pick; Esc closes; × clears.
 * The list opens inline (not floating) so cards with overflow-hidden do not cut it off.
 */
export function SearchPicker({ options, value, onChange, label, noun, placeholder, disabled, maxShown = 30 }: Props) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const selected = options.find(o => o.id === value) ?? null
  const matches = useMemo(() => matchOptions(options, query), [options, query])
  const shown = matches.slice(0, maxShown)
  const plural = `${noun}${options.length === 1 ? '' : 's'}`

  function pick(o: PickerOption | null) {
    onChange(o?.id ?? '')
    setQuery('')
    setOpen(false)
    setActive(0)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { if (open && shown[active]) { e.preventDefault(); pick(shown[active]) } }
    else if (e.key === 'Escape') { setOpen(false); setQuery('') }
  }

  const display = (o: PickerOption) => (o.detail ? `${o.label} (${o.detail})` : o.label)

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-input`} className="text-[12px] font-medium text-text-secondary">{label}</label>
      <div className="relative">
        <span className="material-icons text-[18px] text-text-disabled absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true">search</span>
        <input
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          disabled={disabled}
          value={open ? query : (selected ? display(selected) : '')}
          placeholder={placeholder ?? `Type a ${noun} name (${options.length.toLocaleString()} ${plural})…`}
          onFocus={() => { setOpen(true); setQuery('') }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0) }}
          onKeyDown={onKeyDown}
          className="w-full h-12 pl-9 pr-9 rounded-sm bg-surface-elevated border border-border text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-60"
        />
        {selected && !disabled && (
          <button type="button" aria-label={`Clear ${noun}`} onMouseDown={e => e.preventDefault()} onClick={() => pick(null)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary">
            <span className="material-icons text-[18px]" aria-hidden="true">close</span>
          </button>
        )}
      </div>
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label={label}
          className="max-h-72 overflow-y-auto bg-surface border border-divider rounded-sm shadow-sm">
          {shown.map((o, i) => (
            <li key={o.id} id={`${id}-opt-${i}`} role="option" aria-selected={o.id === value}
              onMouseDown={e => e.preventDefault()} onClick={() => pick(o)} onMouseEnter={() => setActive(i)}
              className={`px-3 py-2 cursor-pointer text-[13px] flex justify-between gap-2 ${i === active ? 'bg-primary/10' : ''} ${o.id === value ? 'font-semibold' : ''}`}>
              <span className="truncate text-text-primary">{o.label}</span>
              {o.detail && <span className="shrink-0 text-[12px] text-text-secondary">{o.detail}</span>}
            </li>
          ))}
          {shown.length === 0 && (
            <li className="px-3 py-3 text-[12px] text-text-secondary">
              {options.length === 0 ? `No ${plural} yet.` : `No ${noun} matches “${query}”.`}
            </li>
          )}
          {matches.length > shown.length && (
            <li className="px-3 py-2 text-[11px] text-text-secondary border-t border-divider">
              Showing {shown.length} of {matches.length.toLocaleString()}. Keep typing to narrow it down.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
