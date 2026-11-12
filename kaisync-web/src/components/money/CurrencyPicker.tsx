'use client'

/**
 * Searchable currency picker (all world currencies). Type a code, a name or a country word ("dollar", "botswana").
 * Empty = the company's own currency.
 */

import { useMemo, useRef, useState } from 'react'
import { currencyOptions, currencyName } from '@/lib/currencies'

export function CurrencyPicker({ value, onChange, homeCurrency = 'ZAR', allowDefault = true, disabled, label = 'Currency', className = '', compact = false }: {
  value: string | null | undefined
  onChange: (code: string | null) => void
  homeCurrency?: string
  /** Offer "company currency" (stores nothing). Off for documents, which always have a currency. */
  allowDefault?: boolean
  disabled?: boolean
  label?: string
  className?: string
  /** Smaller field and label, for compact forms (the quote header). */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const all = useMemo(() => currencyOptions(), [])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (s ? all.filter(c => c.code.toLowerCase().includes(s) || c.name.toLowerCase().includes(s)) : all).slice(0, 60)
  }, [all, q])

  const shown = value ? `${value} · ${currencyName(value)}` : `${homeCurrency} · ${currencyName(homeCurrency)} (company currency)`

  function pick(code: string | null) {
    onChange(code)
    setOpen(false)
    setQ('')
  }

  return (
    <div ref={box} className={`relative flex flex-col gap-1.5 ${className}`}
      onBlur={e => { if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false) }}>
      <span className={compact ? 'text-[10.5px] text-text-secondary uppercase tracking-wide -mb-0.5' : 'text-[12px] font-medium text-text-secondary'}>{label}</span>
      <button type="button" disabled={disabled} onClick={() => setOpen(o => !o)}
        className={`${compact ? 'h-8 px-2.5 text-[12.5px]' : 'h-10 px-3 text-[13.5px]'} rounded-lg border border-divider text-left bg-background text-text-primary flex items-center justify-between gap-2 disabled:opacity-60`}>
        <span className="truncate">{shown}</span>
        <span className="material-icons text-[18px] text-text-secondary">expand_more</span>
      </button>
      {open && !disabled && (
        <div className="absolute z-30 top-full mt-1 left-0 right-0 rounded-xl border border-divider bg-surface-card shadow-xl p-2 flex flex-col gap-1.5">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search: USD, euro, botswana…"
            className="h-9 rounded-lg border border-divider px-2.5 text-[13px] bg-background text-text-primary focus:outline-none focus:border-primary/60" />
          <div className="max-h-60 overflow-y-auto flex flex-col">
            {allowDefault && !q && (
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); pick(null) }}
                className={`text-left px-2.5 py-1.5 rounded-md text-[13px] hover:bg-surface-elevated ${!value ? 'font-semibold text-primary' : 'text-text-primary'}`}
              >
                Company currency ({homeCurrency})
              </button>
            )}
            {list.map(c => (
              <button
                key={c.code}
                type="button"
                onMouseDown={e => { e.preventDefault(); pick(c.code) }}
                className={`text-left px-2.5 py-1.5 rounded-md text-[13px] hover:bg-surface-elevated ${value === c.code ? 'font-semibold text-primary' : 'text-text-primary'}`}
              >
                <span className="inline-block w-12 font-mono text-text-secondary">{c.code}</span>{c.name}
              </button>
            ))}
            {!list.length && <span className="px-2.5 py-2 text-[12.5px] text-text-secondary">No currency matches “{q}”.</span>}
          </div>
        </div>
      )}
    </div>
  )
}
