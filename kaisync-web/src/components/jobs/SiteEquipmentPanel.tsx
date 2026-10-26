'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { areaOptions, type SiteArea } from '@/lib/job-services'
import {
  STATUS_LABEL,
  equipmentHistory,
  equipmentName,
  listSiteEquipment,
  removeEquipment,
  saveEquipment,
  type Equipment,
  type EquipmentHistoryRow,
} from '@/lib/job-equipment'

type Props = {
  companyId: string
  siteId: string
  areas: SiteArea[]
  canEdit: boolean
  /** Bumped by the parent after an import so the list reloads. */
  reloadKey: number
}

const input =
  'h-9 px-2.5 rounded-sm bg-surface-elevated border border-border text-[13px] text-text-primary ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30'

type Draft = { id?: string; areaId: string; type: string; make: string; size: string; qty: string; label: string; serial: string }
const EMPTY: Draft = { areaId: '', type: '', make: '', size: '', qty: '1', label: '', serial: '' }

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Units (air-cons, pumps, generators…) in each area of a site, with each unit's service history. */
export function SiteEquipmentPanel({ companyId, siteId, areas, canEdit, reloadKey }: Props) {
  const [items, setItems] = useState<Equipment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [history, setHistory] = useState<EquipmentHistoryRow[] | null>(null)

  const load = useCallback(async () => {
    const res = await listSiteEquipment(createClient(), companyId, [siteId])
    setLoading(false)
    if (!res.ok) { setError(res.message); return }
    setItems(res.data)
  }, [companyId, siteId])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void load() })
    return () => { cancelled = true }
  }, [load, reloadKey])

  const options = useMemo(() => areaOptions(areas), [areas])
  const groups = useMemo(() => {
    const byArea = new Map<string, Equipment[]>()
    for (const e of items) {
      const k = e.area_id ?? ''
      byArea.set(k, [...(byArea.get(k) ?? []), e])
    }
    const out: { key: string; path: string; units: Equipment[] }[] = []
    for (const o of options) if (byArea.has(o.id)) out.push({ key: o.id, path: o.path, units: byArea.get(o.id)! })
    const loose = [...byArea.entries()].filter(([k]) => !options.some(o => o.id === k)).flatMap(([, v]) => v)
    if (loose.length) out.push({ key: 'none', path: 'No area', units: loose })
    return out
  }, [items, options])

  async function save() {
    if (!draft) return
    setBusy(true); setError(null)
    const res = await saveEquipment(createClient(), companyId, {
      siteId, areaId: draft.areaId || null, assetType: draft.type, manufacturer: draft.make,
      capacity: draft.size, quantity: Number(draft.qty) || 1, label: draft.label, serialNumber: draft.serial,
    }, draft.id)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setDraft(null)
    await load()
  }

  async function remove(e: Equipment) {
    if (!window.confirm(`Delete ${equipmentName(e)}?\n\nIts service history on past jobs is deleted too. To keep it, edit the unit instead.`)) return
    setBusy(true)
    const res = await removeEquipment(createClient(), companyId, e.id)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    await load()
  }

  async function showHistory(id: string) {
    if (historyFor === id) { setHistoryFor(null); return }
    setHistoryFor(id); setHistory(null)
    const res = await equipmentHistory(createClient(), companyId, id)
    if (!res.ok) { setError(res.message); setHistoryFor(null); return }
    const when = (h: EquipmentHistoryRow) => h.job?.scheduled_start ?? h.done_at ?? h.created_at
    setHistory([...res.data].sort((a, b) => when(b).localeCompare(when(a))))
  }

  const total = items.reduce((n, e) => n + e.quantity, 0)

  const form = draft && (
    <form className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-sm border border-primary/40 bg-surface p-2"
      onSubmit={e => { e.preventDefault(); void save() }}>
      <select className={`${input} col-span-2 sm:col-span-3`} aria-label="Area" value={draft.areaId} onChange={e => setDraft({ ...draft, areaId: e.target.value })}>
        <option value="">No area</option>
        {options.map(a => <option key={a.id} value={a.id}>{a.path}</option>)}
      </select>
      <input className={input} aria-label="Type" placeholder="Type, e.g. Midwall-split" value={draft.type} maxLength={120} onChange={e => setDraft({ ...draft, type: e.target.value })} />
      <input className={input} aria-label="Make" placeholder="Make, e.g. Midea" value={draft.make} maxLength={120} onChange={e => setDraft({ ...draft, make: e.target.value })} />
      <input className={input} aria-label="Size" placeholder="Size, e.g. 24 000 btu" value={draft.size} maxLength={80} onChange={e => setDraft({ ...draft, size: e.target.value })} />
      <input className={input} aria-label="Quantity" type="number" min="1" step="1" placeholder="Qty" value={draft.qty}
        onWheel={e => e.currentTarget.blur()} onChange={e => setDraft({ ...draft, qty: e.target.value })} />
      <input className={input} aria-label="Tag or name" placeholder="Tag (optional), e.g. AC-07" value={draft.label} maxLength={120} onChange={e => setDraft({ ...draft, label: e.target.value })} />
      <input className={input} aria-label="Serial number" placeholder="Serial (optional)" value={draft.serial} maxLength={120} onChange={e => setDraft({ ...draft, serial: e.target.value })} />
      <div className="col-span-2 sm:col-span-3 flex gap-2">
        <button type="submit" disabled={busy || !draft.type.trim()} className="btn-primary h-8 px-3 text-[12px] disabled:opacity-50">{draft.id ? 'Save' : 'Add unit'}</button>
        <button type="button" onClick={() => setDraft(null)} className="btn-outlined h-8 px-3 text-[12px]">Cancel</button>
      </div>
    </form>
  )

  return (
    <div className="space-y-2 pt-2 border-t border-divider">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold text-text-primary">
          Equipment{items.length ? ` (${total} unit${total === 1 ? '' : 's'})` : ''}
        </p>
        {canEdit && !draft && (
          <button type="button" className="text-primary text-[12px] hover:underline" onClick={() => setDraft({ ...EMPTY })}>+ Add unit</button>
        )}
      </div>
      {form}
      {error && <p className="text-[12px] text-error" role="alert">{error}</p>}
      {loading ? (
        <p className="text-[12px] text-text-secondary">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="text-[12px] text-text-secondary">No equipment yet. Add units here, or import a sheet with Type, Make, Size and Qty columns.</p>
      ) : (
        <div className="max-h-[360px] overflow-y-auto rounded-sm border border-divider bg-surface divide-y divide-divider">
          {groups.map(g => (
            <div key={g.key}>
              <p className="px-2 pt-2 text-[11px] font-semibold text-text-secondary">{g.path}</p>
              <ul>
                {g.units.map(e => (
                  <li key={e.id} className="px-2 py-1.5 text-[13px]">
                    <div className="flex items-center gap-2">
                      <span className={`flex-1 min-w-0 truncate ${e.status === 'active' ? 'text-text-primary' : 'text-text-disabled'}`}>
                        {equipmentName(e)}{e.notes ? <span className="text-text-secondary text-[11px]"> · {e.notes}</span> : null}
                      </span>
                      <span className="flex gap-3 shrink-0 text-[11px]">
                        <button type="button" className="text-primary" onClick={() => void showHistory(e.id)}>{historyFor === e.id ? 'Close' : 'History'}</button>
                        {canEdit && (
                          <>
                            <button type="button" className="text-primary" onClick={() => setDraft({
                              id: e.id, areaId: e.area_id ?? '', type: e.asset_type, make: e.manufacturer ?? '', size: e.capacity ?? '',
                              qty: String(e.quantity), label: e.label ?? '', serial: e.serial_number ?? '',
                            })}>Edit</button>
                            <button type="button" className="text-error" disabled={busy} onClick={() => void remove(e)}>Delete</button>
                          </>
                        )}
                      </span>
                    </div>
                    {historyFor === e.id && (
                      <div className="mt-1 ml-2 rounded-sm bg-background/60 p-2">
                        {history === null ? (
                          <p className="text-[12px] text-text-secondary">Loading…</p>
                        ) : history.length === 0 ? (
                          <p className="text-[12px] text-text-secondary">Not on any job yet.</p>
                        ) : (
                          <ul className="space-y-1">
                            {history.map(h => (
                              <li key={h.id} className="text-[12px] flex flex-wrap gap-x-2">
                                <span className="text-text-secondary w-24 shrink-0" title={h.done_at ? `Marked on ${fmtDate(h.done_at)}` : undefined}>{fmtDate(h.job?.scheduled_start ?? h.done_at ?? h.created_at)}</span>
                                {h.job ? (
                                  <Link href={`/dashboard/jobs/${h.job.id}`} className="text-primary hover:underline">
                                    {h.job.job_code ? `${h.job.job_code} · ` : ''}{h.job.service?.name ?? h.job.title}
                                  </Link>
                                ) : <span>Job</span>}
                                <span className={h.status === 'done' ? 'text-success' : h.status === 'not_done' ? 'text-error' : 'text-text-secondary'}>{STATUS_LABEL[h.status]}</span>
                                {h.notes && <span className="text-text-secondary">“{h.notes}”</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
