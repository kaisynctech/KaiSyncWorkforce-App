'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { recordPlantingEvent } from '@/lib/farms'
import { KpiTile } from '@/components/ui/KpiTile'
import {
  FARM_QTY_UNITS,
  PLANTING_EVENT_LABELS,
  type Farm,
  type FarmPlanting,
  type FarmPlantingEvent,
  type FarmQtyUnit,
  type PlantingEventType,
  type PlantingStatus,
} from '@/types/farms'

export default function PlantingDetailPage() {
  const { id: farmId, plantingId } = useParams<{ id: string; plantingId: string }>()
  const router = useRouter()

  const [farm, setFarm] = useState<Farm | null>(null)
  const [planting, setPlanting] = useState<FarmPlanting | null>(null)
  const [events, setEvents] = useState<FarmPlantingEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [showEvent, setShowEvent] = useState(false)
  const [eType, setEType] = useState<PlantingEventType>('harvest')
  const [eQty, setEQty] = useState('1')
  const [eUnit, setEUnit] = useState<FarmQtyUnit>('kg')
  const [eDate, setEDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [eNotes, setENotes] = useState('')

  const canEdit = can(perms, PERM.farmsEdit)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)
    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

    const [fRes, pRes, eRes] = await Promise.all([
      supabase.from('farms').select('*').eq('id', farmId).eq('company_id', member.companyId).maybeSingle(),
      supabase
        .from('farm_plantings')
        .select('*, farm_land_units(name)')
        .eq('id', plantingId)
        .eq('farm_id', farmId)
        .eq('company_id', member.companyId)
        .maybeSingle(),
      supabase
        .from('farm_planting_events')
        .select('*')
        .eq('planting_id', plantingId)
        .eq('company_id', member.companyId)
        .order('event_date', { ascending: false })
        .limit(200),
    ])

    if (!fRes.data || !pRes.data) {
      router.replace(`/dashboard/farms/${farmId}?tab=plantings`)
      return
    }

    const p = pRes.data as FarmPlanting
    setFarm(fRes.data as Farm)
    setPlanting(p)
    setEUnit(p.harvest_unit)
    setEvents((eRes.data ?? []) as FarmPlantingEvent[])
    setLoading(false)
  }, [farmId, plantingId, router])

  useEffect(() => { void load() }, [load])

  async function submitEvent() {
    if (!companyId || !canEdit || !planting) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const result = await recordPlantingEvent(supabase, {
      companyId,
      farmId,
      plantingId: planting.id,
      employeeId,
      eventType: eType,
      quantity: Number(eQty) || 1,
      unit: eUnit,
      eventDate: eDate,
      notes: eNotes,
    })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    setShowEvent(false)
    setENotes('')
    setEQty('1')
    await load()
  }

  async function setStatus(status: PlantingStatus) {
    if (!companyId || !canEdit || !planting) return
    setBusy(true)
    const supabase = createClient()
    const { error: e } = await supabase
      .from('farm_plantings')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', planting.id)
      .eq('company_id', companyId)
    setBusy(false)
    if (e) { setError(e.message); return }
    await load()
  }

  if (loading) {
    return <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
  }
  if (!farm || !planting) return null

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 space-y-4 pb-12">
        <button
          type="button"
          onClick={() => router.push(`/dashboard/farms/${farmId}?tab=plantings`)}
          className="flex items-center gap-1 text-[13px] text-primary hover:underline"
        >
          <span className="material-icons text-[16px]">arrow_back</span>{farm.name}
        </button>

        <div className="bg-surface border border-divider rounded-xl p-4 space-y-1">
          <h1 className="text-[20px] font-semibold text-text-primary">{planting.name}</h1>
          <p className="text-[13px] text-text-secondary capitalize">
            {planting.crop_type}
            {planting.variety ? ` · ${planting.variety}` : ''}
            {planting.farm_land_units?.name ? ` · ${planting.farm_land_units.name}` : ''}
            {' · '}
            <span className="capitalize">{planting.status}</span>
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiTile
            value={Number(planting.total_harvested)}
            label={`Harvested (${planting.harvest_unit})`}
            bg="#0F2918"
            valueFg="#22C55E"
            labelFg="#4ADE80"
          />
          <KpiTile
            value={Number(planting.area_ha ?? 0)}
            label="Area (ha)"
            bg="#1E293B"
            valueFg="#94A3B8"
            labelFg="#64748B"
          />
          <KpiTile
            value={Number(planting.plant_count ?? 0)}
            label="Plant count"
            bg="#1E293B"
            valueFg="#FCD34D"
            labelFg="#64748B"
          />
          <KpiTile
            value={events.length}
            label="Events"
            bg="#1E293B"
            valueFg="#94A3B8"
            labelFg="#64748B"
          />
        </div>

        {error && <p className="text-[13px] text-error">{error}</p>}

        <div className="flex gap-2 flex-wrap">
          {canEdit && (
            <>
              <button type="button" onClick={() => setShowEvent(true)} className="btn-primary h-9 px-3 text-[13px]">
                Record event
              </button>
              {planting.status !== 'harvested' && (
                <button type="button" disabled={busy} onClick={() => void setStatus('harvested')} className="btn-outlined h-9 px-3 text-[13px] disabled:opacity-50">
                  Mark harvested
                </button>
              )}
              {planting.status !== 'abandoned' && planting.status !== 'harvested' && (
                <button type="button" disabled={busy} onClick={() => void setStatus('abandoned')} className="btn-outlined h-9 px-3 text-[13px] disabled:opacity-50">
                  Abandon
                </button>
              )}
            </>
          )}
        </div>

        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold text-text-primary uppercase tracking-wide">Activity</h2>
          {events.length === 0 ? (
            <p className="text-[13px] text-text-secondary">No planting events yet.</p>
          ) : (
            <div className="overflow-x-auto border border-divider rounded-xl">
              <table className="w-full" style={{ minWidth: 560 }}>
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider">
                    <th className="data-th text-left">Date</th>
                    <th className="data-th text-left">Type</th>
                    <th className="data-th text-right">Qty</th>
                    <th className="data-th text-left">Unit</th>
                    <th className="data-th text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <tr key={ev.id} className="border-b border-divider last:border-0">
                      <td className="data-td text-[13px]">{ev.event_date}</td>
                      <td className="data-td text-[13px]">{PLANTING_EVENT_LABELS[ev.event_type]}</td>
                      <td className="data-td text-[13px] text-right font-medium">{ev.quantity}</td>
                      <td className="data-td text-[13px]">{ev.unit}</td>
                      <td className="data-td text-[13px] text-text-secondary">{ev.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {showEvent && (
        <Modal title={`Record event · ${planting.name}`} onClose={() => setShowEvent(false)}>
          <label className="block text-[12px] text-text-secondary">Event
            <select value={eType} onChange={e => setEType(e.target.value as PlantingEventType)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              {(Object.keys(PLANTING_EVENT_LABELS) as PlantingEventType[]).map(k => (
                <option key={k} value={k}>{PLANTING_EVENT_LABELS[k]}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-text-secondary">Quantity
              <input type="number" min={0.001} step="any" value={eQty} onChange={e => setEQty(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Unit
              <select value={eUnit} onChange={e => setEUnit(e.target.value as FarmQtyUnit)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                {FARM_QTY_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-[12px] text-text-secondary">Date
            <input type="date" value={eDate} onChange={e => setEDate(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Notes
            <input value={eNotes} onChange={e => setENotes(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowEvent(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void submitEvent()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Save</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
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
