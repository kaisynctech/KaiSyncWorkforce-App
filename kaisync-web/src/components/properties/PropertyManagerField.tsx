'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createEmployee } from '@/lib/employees'

export type ManagerOption = { id: string; name: string; surname: string }

type Props = {
  companyId: string | null
  value: string
  onChange: (employeeId: string) => void
  employees: ManagerOption[]
  onEmployeeCreated: (employee: ManagerOption) => void
  disabled?: boolean
  label?: string
}

/**
 * Managed-by picker: select an existing employee or quick-add a person
 * (creates an employee row with access_level employee via createEmployee).
 */
export function PropertyManagerField({
  companyId,
  value,
  onChange,
  employees,
  onEmployeeCreated,
  disabled,
  label = 'Managed by',
}: Props) {
  const [showAdd, setShowAdd] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function addPerson() {
    if (!companyId || !firstName.trim() || !lastName.trim()) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const created = await createEmployee(supabase, {
      companyId,
      name: firstName.trim(),
      surname: lastName.trim(),
      employmentType: 'permanent',
      workerType: 'employee',
      accessLevel: 'employee',
      position: 'Property manager',
    })
    setBusy(false)
    if (!created.ok) {
      setError(created.message)
      return
    }
    const option: ManagerOption = {
      id: created.data.id,
      name: created.data.name,
      surname: created.data.surname,
    }
    onEmployeeCreated(option)
    onChange(option.id)
    setFirstName('')
    setLastName('')
    setShowAdd(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <label className="block flex-1 text-[12px] text-text-secondary">
          {label}
          <select
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
            className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60"
          >
            <option value="">— Unassigned —</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>
                {e.name} {e.surname}
              </option>
            ))}
          </select>
        </label>
        {!disabled && (
          <button
            type="button"
            onClick={() => { setShowAdd(v => !v); setError(null) }}
            className="btn-outlined h-10 px-3 text-[12px] shrink-0"
          >
            {showAdd ? 'Cancel' : '+ Add person'}
          </button>
        )}
      </div>
      {showAdd && !disabled && (
        <div className="rounded-lg border border-divider bg-surface-elevated p-3 space-y-2">
          <p className="text-[11px] text-text-secondary">
            Add someone who manages this property. They are created as a staff record (employee access).
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[12px] text-text-secondary">
              First name *
              <input
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                className="mt-1 w-full h-9 px-3 border border-border rounded-md text-[13px] bg-background"
                autoComplete="given-name"
              />
            </label>
            <label className="block text-[12px] text-text-secondary">
              Last name *
              <input
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                className="mt-1 w-full h-9 px-3 border border-border rounded-md text-[13px] bg-background"
                autoComplete="family-name"
              />
            </label>
          </div>
          {error && <p className="text-[12px] text-error">{error}</p>}
          <button
            type="button"
            disabled={busy || !firstName.trim() || !lastName.trim() || !companyId}
            onClick={() => void addPerson()}
            className="btn-primary h-9 px-3 text-[12px] disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add and select'}
          </button>
        </div>
      )}
    </div>
  )
}
