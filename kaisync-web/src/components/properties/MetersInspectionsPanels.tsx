'use client'

import { useState } from 'react'
import type {
  InspectionResult,
  InspectionType,
  MeterType,
  PropertyInspection,
  PropertyMeter,
  PropertyMeterReading,
  Unit,
} from '@/types/database'

const METER_TYPES: MeterType[] = ['electricity', 'water', 'gas', 'other']
const INSP_TYPES: InspectionType[] = ['move_in', 'move_out', 'routine', 'general', 'other']
const INSP_RESULTS: InspectionResult[] = ['pass', 'fail', 'needs_attention', 'pending']

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
}

export function MetersPanel({
  meters,
  readings,
  units,
  canEdit,
  busy,
  onAddMeter,
  onAddReading,
}: {
  meters: PropertyMeter[]
  readings: PropertyMeterReading[]
  units: Unit[]
  canEdit: boolean
  busy: boolean
  onAddMeter: (input: {
    label: string
    meter_type: MeterType
    unit_id: string | null
    serial_number: string | null
    unit_of_measure: string
  }) => Promise<void>
  onAddReading: (meterId: string, value: number, date: string, notes: string | null) => Promise<void>
}) {
  const [showMeter, setShowMeter] = useState(false)
  const [label, setLabel] = useState('')
  const [meterType, setMeterType] = useState<MeterType>('electricity')
  const [unitId, setUnitId] = useState('')
  const [serial, setSerial] = useState('')
  const [uom, setUom] = useState('kWh')

  const [readingMeterId, setReadingMeterId] = useState<string | null>(null)
  const [readingValue, setReadingValue] = useState('')
  const [readingDate, setReadingDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [readingNotes, setReadingNotes] = useState('')

  const unitLabel = (id: string | null) => {
    if (!id) return 'Whole property'
    return units.find(u => u.id === id)?.unit_number ?? '—'
  }

  const latestReading = (meterId: string) =>
    readings.filter(r => r.meter_id === meterId).sort((a, b) => b.reading_date.localeCompare(a.reading_date))[0]

  return (
    <div className="space-y-3">
      {canEdit && (
        <button type="button" onClick={() => setShowMeter(true)} className="btn-outlined h-9 px-3 text-[13px]">+ Meter</button>
      )}
      <p className="text-[12px] text-text-secondary">Utility meters and readings for this property.</p>
      {meters.length === 0 ? (
        <p className="text-[13px] text-text-secondary">No meters yet.</p>
      ) : (
        <table className="w-full" style={{ minWidth: 560 }}>
          <thead>
            <tr className="border-b border-divider">
              <th className="data-th text-left">Label</th>
              <th className="data-th text-left">Type</th>
              <th className="data-th text-left">Unit</th>
              <th className="data-th text-left">Latest</th>
              <th className="data-th text-left" />
            </tr>
          </thead>
          <tbody>
            {meters.map(m => {
              const latest = latestReading(m.id)
              return (
                <tr key={m.id} className="border-b border-divider">
                  <td className="data-td text-[13px] font-medium">{m.label}</td>
                  <td className="data-td text-[12px] capitalize">{m.meter_type}</td>
                  <td className="data-td text-[13px]">{unitLabel(m.unit_id)}</td>
                  <td className="data-td text-[12px]">
                    {latest
                      ? `${latest.reading_value} ${m.unit_of_measure} · ${fmtDate(latest.reading_date)}`
                      : '—'}
                  </td>
                  <td className="data-td text-right">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          setReadingMeterId(m.id)
                          setReadingValue('')
                          setReadingDate(new Date().toISOString().slice(0, 10))
                          setReadingNotes('')
                        }}
                        className="text-[12px] text-primary hover:underline"
                      >
                        Reading
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {showMeter && (
        <MiniModal title="New meter" onClose={() => setShowMeter(false)}>
          <label className="block text-[12px] text-text-secondary">Label *
            <input value={label} onChange={e => setLabel(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Type
            <select value={meterType} onChange={e => {
              const t = e.target.value as MeterType
              setMeterType(t)
              setUom(t === 'water' ? 'kL' : t === 'gas' ? 'm³' : 'kWh')
            }} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              {METER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block text-[12px] text-text-secondary">Unit (optional)
            <select value={unitId} onChange={e => setUnitId(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              <option value="">Whole property</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-text-secondary">Serial
              <input value={serial} onChange={e => setSerial(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">UoM
              <input value={uom} onChange={e => setUom(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowMeter(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
            <button
              type="button"
              disabled={busy || !label.trim()}
              onClick={() => void onAddMeter({
                label: label.trim(),
                meter_type: meterType,
                unit_id: unitId || null,
                serial_number: serial.trim() || null,
                unit_of_measure: uom.trim() || 'kWh',
              }).then(() => { setShowMeter(false); setLabel(''); setSerial('') })}
              className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </MiniModal>
      )}

      {readingMeterId && (
        <MiniModal title="Log reading" onClose={() => setReadingMeterId(null)}>
          <label className="block text-[12px] text-text-secondary">Value *
            <input type="number" step="0.0001" value={readingValue} onChange={e => setReadingValue(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Date
            <input type="date" value={readingDate} onChange={e => setReadingDate(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Notes
            <input value={readingNotes} onChange={e => setReadingNotes(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setReadingMeterId(null)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
            <button
              type="button"
              disabled={busy || !readingValue.trim()}
              onClick={() => void onAddReading(
                readingMeterId,
                parseFloat(readingValue),
                readingDate,
                readingNotes.trim() || null,
              ).then(() => setReadingMeterId(null))}
              className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </MiniModal>
      )}
    </div>
  )
}

export function InspectionsPanel({
  inspections,
  units,
  canEdit,
  busy,
  onAdd,
}: {
  inspections: PropertyInspection[]
  units: Unit[]
  canEdit: boolean
  busy: boolean
  onAdd: (input: {
    inspection_type: InspectionType
    inspection_date: string
    result: InspectionResult
    unit_id: string | null
    inspector_name: string | null
    notes: string | null
  }) => Promise<void>
}) {
  const [show, setShow] = useState(false)
  const [type, setType] = useState<InspectionType>('routine')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [result, setResult] = useState<InspectionResult>('pass')
  const [unitId, setUnitId] = useState('')
  const [inspector, setInspector] = useState('')
  const [notes, setNotes] = useState('')

  const unitLabel = (id: string | null) => {
    if (!id) return 'Whole property'
    return units.find(u => u.id === id)?.unit_number ?? '—'
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <button type="button" onClick={() => setShow(true)} className="btn-outlined h-9 px-3 text-[13px]">+ Inspection</button>
      )}
      <p className="text-[12px] text-text-secondary">
        Move-in / move-out / routine inspections. Certificates stay under Compliance.
      </p>
      {inspections.length === 0 ? (
        <p className="text-[13px] text-text-secondary">No inspections yet.</p>
      ) : (
        <table className="w-full" style={{ minWidth: 560 }}>
          <thead>
            <tr className="border-b border-divider">
              <th className="data-th text-left">Date</th>
              <th className="data-th text-left">Type</th>
              <th className="data-th text-left">Unit</th>
              <th className="data-th text-left">Result</th>
              <th className="data-th text-left">Inspector</th>
            </tr>
          </thead>
          <tbody>
            {inspections.map(i => (
              <tr key={i.id} className="border-b border-divider">
                <td className="data-td text-[12px]">{fmtDate(i.inspection_date)}</td>
                <td className="data-td text-[12px] capitalize">{i.inspection_type.replace('_', ' ')}</td>
                <td className="data-td text-[13px]">{unitLabel(i.unit_id)}</td>
                <td className="data-td text-[12px] capitalize">{i.result.replace('_', ' ')}</td>
                <td className="data-td text-[13px] text-text-secondary">{i.inspector_name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {show && (
        <MiniModal title="New inspection" onClose={() => setShow(false)}>
          <label className="block text-[12px] text-text-secondary">Type
            <select value={type} onChange={e => setType(e.target.value as InspectionType)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              {INSP_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-text-secondary">Date
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Result
              <select value={result} onChange={e => setResult(e.target.value as InspectionResult)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                {INSP_RESULTS.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-[12px] text-text-secondary">Unit
            <select value={unitId} onChange={e => setUnitId(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              <option value="">Whole property</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
            </select>
          </label>
          <label className="block text-[12px] text-text-secondary">Inspector
            <input value={inspector} onChange={e => setInspector(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Notes
            <input value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShow(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
            <button
              type="button"
              disabled={busy || !date}
              onClick={() => void onAdd({
                inspection_type: type,
                inspection_date: date,
                result,
                unit_id: unitId || null,
                inspector_name: inspector.trim() || null,
                notes: notes.trim() || null,
              }).then(() => setShow(false))}
              className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </MiniModal>
      )}
    </div>
  )
}

function MiniModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-text-primary">{title}</h2>
          <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <span className="material-icons text-[20px]">close</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
