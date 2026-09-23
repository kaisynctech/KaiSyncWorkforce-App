'use client'

import { useMemo, useState } from 'react'
import {
  expandBulkUnitRows,
  GUEST_HOUSE_UNIT_TYPES,
  insertUnitsBulk,
  previewBulkUnitNames,
  STUDENT_UNIT_TYPES,
  UNIT_TYPES,
  type BulkUnitSpec,
  type UnitNamingScheme,
} from '@/lib/properties'
import { createClient } from '@/lib/supabase/client'
import type { PropertyKind, UnitType } from '@/types/database'

type Props = {
  companyId: string
  siteId: string
  propertyKind: PropertyKind
  onDone: () => void
  onClose: () => void
}

const NAMING_OPTIONS: { value: UnitNamingScheme; label: string }[] = [
  { value: 'prefix_number', label: 'Name + number (Room 1…)' },
  { value: 'door', label: 'Door numbers' },
  { value: 'zero_pad', label: 'Padded (Room 001…)' },
  { value: 'number_only', label: 'Numbers only' },
]

export function GenerateRoomsModal({ companyId, siteId, propertyKind, onDone, onClose }: Props) {
  const isGuest = propertyKind === 'guest_house'
  const allowed = propertyKind === 'student_accommodation'
    ? STUDENT_UNIT_TYPES
    : isGuest
      ? GUEST_HOUSE_UNIT_TYPES
      : UNIT_TYPES.map(t => t.value)
  const typeOptions = UNIT_TYPES.filter(t => allowed.includes(t.value))

  const [count, setCount] = useState(isGuest ? '10' : '50')
  const [prefix, setPrefix] = useState('Room')
  const [unitType, setUnitType] = useState<UnitType>(isGuest ? 'double' : 'room')
  const [naming, setNaming] = useState<UnitNamingScheme>('prefix_number')
  const [startAt, setStartAt] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const spec: BulkUnitSpec = useMemo(() => ({
    count: parseInt(count, 10) || 0,
    unitType,
    namePrefix: naming === 'door' ? '' : prefix,
    naming,
    startAt: parseInt(startAt, 10) || 1,
  }), [count, unitType, prefix, naming, startAt])

  const preview = previewBulkUnitNames(spec)
  const total = expandBulkUnitRows(companyId, siteId, [spec]).rows.length

  async function generate() {
    if (total <= 0) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    // Avoid colliding with existing unit numbers on this site
    const { data: existing } = await supabase
      .from('units')
      .select('unit_number')
      .eq('site_id', siteId)
      .eq('company_id', companyId)
    const taken = new Set((existing ?? []).map(u => (u.unit_number as string).trim().toLowerCase()))
    const { rows } = expandBulkUnitRows(companyId, siteId, [spec])
    const fresh = rows.filter(r => !taken.has(r.unit_number.trim().toLowerCase()))
    if (fresh.length === 0) {
      setBusy(false)
      setError('Those names already exist on this property. Change the prefix or start number.')
      return
    }
    const result = await insertUnitsBulk(supabase, fresh)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onDone()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
        <h2 className="text-[16px] font-semibold text-text-primary">Generate rooms</h2>
        <p className="text-[12px] text-text-secondary">
          Add many units at once. Rename individual doors later from the units list.
        </p>
        <label className="block text-[12px] text-text-secondary">How many
          <input type="number" min={1} max={2000} value={count} onChange={e => setCount(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
        </label>
        <label className="block text-[12px] text-text-secondary">Naming
          <select value={naming} onChange={e => setNaming(e.target.value as UnitNamingScheme)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
            {NAMING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[12px] text-text-secondary">Prefix
            <input value={prefix} onChange={e => setPrefix(e.target.value)} disabled={naming === 'door' || naming === 'number_only'} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-50" />
          </label>
          <label className="block text-[12px] text-text-secondary">Start at
            <input type="number" min={0} value={startAt} onChange={e => setStartAt(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
        </div>
        <label className="block text-[12px] text-text-secondary">Type
          <select value={unitType} onChange={e => setUnitType(e.target.value as UnitType)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
            {typeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <div className="rounded-lg bg-surface-elevated border border-divider px-3 py-2">
          <p className="text-[11px] text-text-secondary">Preview · {total} units</p>
          <p className="text-[12px] text-text-primary mt-0.5">{preview}</p>
        </div>
        {error && <p className="text-[12px] text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
          <button type="button" disabled={busy || total <= 0} onClick={() => void generate()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">
            {busy ? 'Generating…' : `Generate ${total}`}
          </button>
        </div>
      </div>
    </div>
  )
}
