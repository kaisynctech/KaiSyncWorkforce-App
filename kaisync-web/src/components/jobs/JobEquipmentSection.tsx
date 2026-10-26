'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { areaOptions, listSiteAreas, type SiteArea } from '@/lib/job-services'
import {
  STATUS_LABEL,
  addJobEquipment,
  areaAndInner,
  equipmentName,
  listJobEquipment,
  listSiteEquipment,
  removeJobEquipment,
  setJobEquipment,
  type Equipment,
  type JobEquipment,
  type JobEquipmentStatus,
} from '@/lib/job-equipment'

type Props = {
  companyId: string
  jobId: string
  siteId: string | null
  areaId: string | null
  canEdit: boolean
}

const input =
  'h-9 px-2.5 rounded-sm bg-surface-elevated border border-border text-[13px] text-text-primary ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30'

/** The units serviced on this job, each Done / Not done with a note. Units come from the job's site. */
export function JobEquipmentSection({ companyId, jobId, siteId, areaId, canEdit }: Props) {
  const [rows, setRows] = useState<JobEquipment[]>([])
  const [siteUnits, setSiteUnits] = useState<Equipment[]>([])
  const [areas, setAreas] = useState<SiteArea[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const supabase = createClient()
    const [j, u, a] = await Promise.all([
      listJobEquipment(supabase, companyId, jobId),
      siteId ? listSiteEquipment(supabase, companyId, [siteId]) : Promise.resolve({ ok: true as const, data: [] as Equipment[] }),
      siteId ? listSiteAreas(supabase, companyId, [siteId], { includeInactive: true }) : Promise.resolve({ ok: true as const, data: [] as SiteArea[] }),
    ])
    setLoading(false)
    if (!j.ok) { setError(j.message); return }
    if (!u.ok) { setError(u.message); return }
    if (!a.ok) { setError(a.message); return }
    setRows(j.data)
    setSiteUnits(u.data)
    setAreas(a.data)
    setNotes(Object.fromEntries(j.data.map(r => [r.id, r.notes ?? ''])))
  }, [companyId, jobId, siteId])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void load() })
    return () => { cancelled = true }
  }, [load])

  const options = useMemo(() => areaOptions(areas), [areas])
  const pathOf = useMemo(() => new Map(options.map(o => [o.id, o.path])), [options])
  const onJob = useMemo(() => new Set(rows.map(r => r.asset_id)), [rows])
  const inJobArea = useMemo(() => (areaId ? areaAndInner(areaId, options) : null), [areaId, options])
  const addable = useMemo(() => {
    const list = siteUnits.filter(u => !onJob.has(u.id) && u.status === 'active')
    const order = new Map(options.map((o, i) => [o.id, i]))
    return list.sort((x, y) => (order.get(x.area_id ?? '') ?? 1e9) - (order.get(y.area_id ?? '') ?? 1e9))
  }, [siteUnits, onJob, options])
  const areaUnits = useMemo(() => addable.filter(u => inJobArea && u.area_id && inJobArea.has(u.area_id)), [addable, inJobArea])

  async function add(ids: string[]) {
    if (ids.length === 0) return
    setBusy(true); setError(null)
    const res = await addJobEquipment(createClient(), companyId, jobId, ids)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setPicking(false); setPicked(new Set())
    await load()
  }

  async function mark(r: JobEquipment, status: JobEquipmentStatus) {
    setBusy(true); setError(null)
    const res = await setJobEquipment(createClient(), companyId, r.id, { status, notes: notes[r.id] ?? '' })
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    await load()
  }

  async function saveNote(r: JobEquipment) {
    const n = notes[r.id] ?? ''
    if (n === (r.notes ?? '')) return
    const res = await setJobEquipment(createClient(), companyId, r.id, { notes: n })
    if (!res.ok) setError(res.message)
    else setRows(prev => prev.map(x => x.id === r.id ? { ...x, notes: n || null } : x))
  }

  async function remove(r: JobEquipment) {
    setBusy(true)
    const res = await removeJobEquipment(createClient(), companyId, r.id)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    await load()
  }

  if (loading) return null
  if (!siteId && rows.length === 0) return null

  const done = rows.filter(r => r.status === 'done').length
  const areaOrder = new Map(options.map((o, i) => [o.id, i]))
  const sortedRows = [...rows].sort((a, b) =>
    (areaOrder.get(a.asset?.area_id ?? '') ?? 1e9) - (areaOrder.get(b.asset?.area_id ?? '') ?? 1e9))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="section-label">EQUIPMENT</p>
        {rows.length > 0 && <span className="text-[12px] text-text-secondary">{done} of {rows.length} done</span>}
      </div>
      <div className="card p-3 space-y-2">
        {rows.length === 0 && (
          <p className="text-[12px] text-text-secondary">
            {siteUnits.length === 0
              ? 'No equipment recorded at this site yet. Add units on the client page under the site’s Areas.'
              : 'No units on this job yet. Add the ones the technician must service.'}
          </p>
        )}
        {rows.length > 0 && (
          <ul className="divide-y divide-divider rounded-sm border border-divider">
            {sortedRows.map(r => (
              <li key={r.id} className="px-2 py-2 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="flex-1 min-w-[160px] text-[13px] text-text-primary">
                    {r.asset ? equipmentName(r.asset) : 'Unit (removed)'}
                    {r.asset?.area_id && <span className="block text-[11px] text-text-secondary">{pathOf.get(r.asset.area_id) ?? ''}</span>}
                  </span>
                  {canEdit ? (
                    <select className={input} aria-label="Status" value={r.status} disabled={busy} onChange={e => void mark(r, e.target.value as JobEquipmentStatus)}>
                      {(['pending', 'done', 'not_done'] as JobEquipmentStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  ) : (
                    <span className="text-[12px]">{STATUS_LABEL[r.status]}</span>
                  )}
                  {canEdit && <button type="button" className="text-error text-[11px]" disabled={busy} onClick={() => void remove(r)}>Remove</button>}
                </div>
                {canEdit ? (
                  <input className={`${input} w-full`} placeholder="Note (optional)" aria-label="Note" maxLength={2000}
                    value={notes[r.id] ?? ''} onChange={e => setNotes(prev => ({ ...prev, [r.id]: e.target.value }))}
                    onBlur={() => void saveNote(r)} />
                ) : r.notes ? <p className="text-[12px] text-text-secondary">{r.notes}</p> : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit && addable.length > 0 && !picking && (
          <div className="flex flex-wrap gap-2">
            {areaUnits.length > 0 && (
              <button type="button" disabled={busy} onClick={() => void add(areaUnits.map(u => u.id))} className="btn-primary h-8 px-3 text-[12px] disabled:opacity-50">
                Add all {areaUnits.length} in {areaId ? pathOf.get(areaId) : 'this area'}
              </button>
            )}
            <button type="button" onClick={() => setPicking(true)} className="btn-outlined h-8 px-3 text-[12px]">Choose units…</button>
          </div>
        )}

        {picking && (
          <div className="rounded-sm border border-primary/40 p-2 space-y-2">
            <ul className="max-h-[260px] overflow-y-auto space-y-0.5">
              {addable.map(u => (
                <li key={u.id}>
                  <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                    <input type="checkbox" className="accent-primary" checked={picked.has(u.id)}
                      onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(u.id); else n.delete(u.id); return n })} />
                    <span className="flex-1">{equipmentName(u)}</span>
                    <span className="text-[11px] text-text-secondary">{u.area_id ? pathOf.get(u.area_id) : ''}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button type="button" disabled={busy || picked.size === 0} onClick={() => void add([...picked])} className="btn-primary h-8 px-3 text-[12px] disabled:opacity-50">
                Add {picked.size || ''}
              </button>
              <button type="button" onClick={() => { setPicking(false); setPicked(new Set()) }} className="btn-outlined h-8 px-3 text-[12px]">Cancel</button>
            </div>
          </div>
        )}
        {error && <p className="text-[12px] text-error" role="alert">{error}</p>}
      </div>
    </div>
  )
}
