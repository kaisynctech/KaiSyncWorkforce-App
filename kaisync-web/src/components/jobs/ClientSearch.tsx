'use client'

import { useId, useMemo, useRef, useState } from 'react'

export type ClientOption = { id: string; name: string; client_code?: string | null; account_number?: string | null }

type Props = {
  clients: ClientOption[]
  value: string
  onChange: (clientId: string) => void
  label?: string
  disabled?: boolean
}

const MAX_SHOWN = 30

/** Every typed word must appear in the name, client code or account number ("sab ross" finds SAB Rosslyn). */
export function matchClients(clients: ClientOption[], query: string): ClientOption[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return clients
  return clients.filter(c => {
    const hay = `${c.name} ${c.client_code ?? ''} ${c.account_number ?? ''}`.toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

/**
 * Type-to-search client picker for long client lists (hundreds of clients).
 * Shows the chosen client; typing filters by name or code; arrows + Enter pick; Esc closes.
 */
export function ClientSearch({ clients, value, onChange, label = 'Client', disabled }: Props) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const selected = clients.find(c => c.id === value) ?? null
  const matches = useMemo(() => matchClients(clients, query), [clients, query])
  const shown = matches.slice(0, MAX_SHOWN)

  function pick(c: ClientOption | null) {
    onChange(c?.id ?? '')
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

  const label2 = (c: ClientOption) => `${c.name}${c.client_code ? ` (${c.client_code})` : ''}`

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-input`} className="text-[12px] font-medium text-text-secondary">{label}</label>
      <div className="relative">
        <span className="material-icons text-[18px] text-text-disabled absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true">search</span>
        <input
          id={`${id}-input`}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          disabled={disabled}
          value={open ? query : (selected ? label2(selected) : query)}
          placeholder={`Type a client name or code (${clients.length.toLocaleString()} client${clients.length === 1 ? '' : 's'})…`}
          onFocus={() => { setOpen(true); setQuery('') }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0) }}
          onKeyDown={onKeyDown}
          className="w-full h-12 pl-9 pr-9 rounded-sm bg-surface-elevated border border-border text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-60"
        />
        {selected && !disabled && (
          <button type="button" aria-label="Clear client" onMouseDown={e => e.preventDefault()} onClick={() => pick(null)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary">
            <span className="material-icons text-[18px]" aria-hidden="true">close</span>
          </button>
        )}
      </div>
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label={label}
          className="max-h-72 overflow-y-auto bg-surface border border-divider rounded-sm shadow-sm">
          {shown.map((c, i) => (
            <li key={c.id} id={`${id}-opt-${i}`} role="option" aria-selected={c.id === value}
              onMouseDown={e => e.preventDefault()} onClick={() => pick(c)} onMouseEnter={() => setActive(i)}
              className={`px-3 py-2 cursor-pointer text-[13px] flex justify-between gap-2 ${i === active ? 'bg-primary/10' : ''} ${c.id === value ? 'font-semibold' : ''}`}>
              <span className="truncate text-text-primary">{c.name}</span>
              {c.client_code && <span className="shrink-0 text-[12px] text-text-secondary">{c.client_code}</span>}
            </li>
          ))}
          {shown.length === 0 && <li className="px-3 py-3 text-[12px] text-text-secondary">No client matches “{query}”.</li>}
          {matches.length > shown.length && (
            <li className="px-3 py-2 text-[11px] text-text-secondary border-t border-divider">
              Showing {shown.length} of {matches.length}. Keep typing to narrow it down.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
