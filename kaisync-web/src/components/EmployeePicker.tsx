'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { listEmployeeDirectory } from '@/lib/employees'

/**
 * Searchable employee picker. Searches on the server (name, employee number, ID number,
 * department, position), so it works the same for 30 or 30,000 staff and only loads what is shown.
 * Each person shows their employee number, so two people with the same name can be told apart.
 */
export type PickedEmployee = {
  id: string
  name: string
  surname: string
  employee_number?: string | null
  position?: string | null
  department?: string | null
}

type Props = {
  companyId: string
  /** Pick several people (checkboxes) or one. */
  multiple?: boolean
  /** People who cannot be picked (e.g. already in the team). Shown as "Already added". */
  excludeIds?: ReadonlySet<string>
  /** Current selection (controlled). */
  value: PickedEmployee[]
  onChange: (next: PickedEmployee[]) => void
  label?: string
  placeholder?: string
  autoFocus?: boolean
}

const PAGE = 25

export function personLabel(p: Pick<PickedEmployee, 'name' | 'surname' | 'employee_number'>): string {
  const name = `${p.name} ${p.surname}`.trim()
  return p.employee_number ? `${name} · ${p.employee_number}` : name
}

export function EmployeePicker({
  companyId, multiple = false, excludeIds, value, onChange, label = 'Employee', placeholder = 'Search name, employee no., department…', autoFocus,
}: Props) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<PickedEmployee[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestNo = useRef(0)
  const selected = new Set(value.map(v => v.id))

  useEffect(() => {
    const n = ++requestNo.current
    const timer = setTimeout(() => {
      setLoading(true)
      listEmployeeDirectory(createClient(), companyId, { search: query, status: 'active', limit: PAGE, offset: 0 }).then(res => {
        if (n !== requestNo.current) return
        setLoading(false)
        if (!res.ok) { setError(res.message); return }
        setError(null)
        setTotal(res.data.total)
        setRows(res.data.rows.map(r => ({
          id: r.id, name: r.name, surname: r.surname, employee_number: r.employee_number,
          position: r.position, department: r.department,
        })))
      })
    }, query ? 250 : 0)
    return () => clearTimeout(timer)
  }, [companyId, query])

  function toggle(p: PickedEmployee) {
    if (excludeIds?.has(p.id)) return
    if (!multiple) { onChange(selected.has(p.id) ? [] : [p]); return }
    onChange(selected.has(p.id) ? value.filter(v => v.id !== p.id) : [...value, p])
  }

  const pickable = rows.filter(r => !excludeIds?.has(r.id))

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-search`} className="text-[12px] font-medium text-text-secondary">{label}</label>
      <input
        id={`${id}-search`}
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-controls={`${id}-list`}
        className="w-full h-10 px-3 rounded-sm bg-surface-elevated border border-border text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      {multiple && pickable.length > 0 && (
        <div className="flex gap-3 text-[12px]">
          <button type="button" className="text-primary hover:underline"
            onClick={() => onChange([...value, ...pickable.filter(r => !selected.has(r.id))])}>
            Select all shown ({pickable.length})
          </button>
          {value.length > 0 && (
            <button type="button" className="text-text-secondary hover:underline" onClick={() => onChange([])}>Clear</button>
          )}
        </div>
      )}
      <ul
        id={`${id}-list`}
        role="listbox"
        aria-multiselectable={multiple || undefined}
        aria-label={label}
        className="max-h-64 overflow-y-auto border border-divider rounded-sm divide-y divide-divider"
      >
        {rows.map(r => {
          const excluded = excludeIds?.has(r.id) ?? false
          const isSel = selected.has(r.id)
          return (
            <li key={r.id} role="option" aria-selected={isSel} aria-disabled={excluded || undefined}>
              <button
                type="button"
                disabled={excluded}
                onClick={() => toggle(r)}
                className={`w-full text-left px-3 py-2 flex items-center gap-3 ${excluded ? 'opacity-50 cursor-default' : 'hover:bg-surface-elevated'} ${isSel ? 'bg-primary/10' : ''}`}
              >
                {multiple && (
                  <span aria-hidden="true" className={`material-icons text-[18px] ${isSel ? 'text-primary' : 'text-text-disabled'}`}>
                    {isSel ? 'check_box' : 'check_box_outline_blank'}
                  </span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-text-primary truncate">{personLabel(r)}</span>
                  <span className="block text-[11px] text-text-secondary truncate">
                    {[r.position, r.department].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>
                {excluded && <span className="text-[11px] text-text-secondary shrink-0">Already added</span>}
              </button>
            </li>
          )
        })}
        {!loading && rows.length === 0 && !error && (
          <li className="px-3 py-3 text-[12px] text-text-secondary">{query ? 'Nobody matches that search.' : 'No employees yet.'}</li>
        )}
      </ul>
      <p className="text-[11px] text-text-secondary" aria-live="polite">
        {error ? <span className="text-error">{error}</span>
          : loading ? 'Searching…'
          : total > rows.length ? `Showing ${rows.length} of ${total.toLocaleString()}. Type to narrow it down.`
          : `${total.toLocaleString()} found.`}
        {multiple && value.length > 0 && ` ${value.length} selected.`}
      </p>
    </div>
  )
}
