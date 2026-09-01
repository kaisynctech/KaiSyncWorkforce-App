'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { recordLivestockEvent } from '@/lib/farms'
import { KpiTile } from '@/components/ui/KpiTile'
import {
  EVENT_TYPE_LABELS,
  type Farm,
  type FarmAnimal,
  type FarmLandUnit,
  type FarmLivestockEvent,
  type FarmLivestockGroup,
  type LivestockEventType,
} from '@/types/farms'

export default function LivestockGroupDetailPage() {
  const { id: farmId, groupId } = useParams<{ id: string; groupId: string }>()
  const router = useRouter()

  const [farm, setFarm] = useState<Farm | null>(null)
  const [group, setGroup] = useState<FarmLivestockGroup | null>(null)
  const [landUnits, setLandUnits] = useState<FarmLandUnit[]>([])
  const [animals, setAnimals] = useState<FarmAnimal[]>([])
  const [events, setEvents] = useState<FarmLivestockEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [showEvent, setShowEvent] = useState(false)
  const [eType, setEType] = useState<LivestockEventType>('death')
  const [eQty, setEQty] = useState('1')
  const [eDate, setEDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [eNotes, setENotes] = useState('')
  const [eToLand, setEToLand] = useState('')
  const [eAnimal, setEAnimal] = useState('')

  const [showAnimal, setShowAnimal] = useState(false)
  const [aTag, setATag] = useState('')
  const [aName, setAName] = useState('')
  const [aSex, setASex] = useState('')

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

    const [fRes, gRes, lRes, aRes, eRes] = await Promise.all([
      supabase.from('farms').select('*').eq('id', farmId).eq('company_id', member.companyId).maybeSingle(),
      supabase
        .from('farm_livestock_groups')
        .select('*, farm_land_units(name)')
        .eq('id', groupId)
        .eq('farm_id', farmId)
        .eq('company_id', member.companyId)
        .maybeSingle(),
      supabase.from('farm_land_units').select('*').eq('farm_id', farmId).eq('company_id', member.companyId).order('name'),
      supabase
        .from('farm_animals')
        .select('*')
        .eq('farm_id', farmId)
        .eq('group_id', groupId)
        .eq('company_id', member.companyId)
        .order('tag_number'),
      supabase
        .from('farm_livestock_events')
        .select('*, farm_animals(tag_number, name)')
        .eq('farm_id', farmId)
        .eq('group_id', groupId)
        .eq('company_id', member.companyId)
        .order('event_date', { ascending: false })
        .limit(200),
    ])

    if (!fRes.data || !gRes.data) {
      router.replace(`/dashboard/farms/${farmId}?tab=livestock`)
      return
    }

    setFarm(fRes.data as Farm)
    setGroup(gRes.data as FarmLivestockGroup)
    setLandUnits((lRes.data ?? []) as FarmLandUnit[])
    setAnimals((aRes.data ?? []) as FarmAnimal[])
    setEvents((eRes.data ?? []) as FarmLivestockEvent[])
    setLoading(false)
  }, [farmId, groupId, router])

  useEffect(() => { void load() }, [load])

  const kpis = useMemo(() => {
    const monthStart = new Date()
    monthStart.setDate(1)
    const monthIso = monthStart.toISOString().slice(0, 10)
    const deaths = events
      .filter(e => (e.event_type === 'death' || e.event_type === 'cull') && e.event_date >= monthIso)
      .reduce((s, e) => s + e.quantity, 0)
    const intake = events
      .filter(e => e.event_type === 'intake')
      .reduce((s, e) => s + e.quantity, 0)
    return {
      headcount: Number(group?.headcount ?? 0),
      deaths,
      intake,
      animals: animals.filter(a => a.status === 'active').length,
    }
  }, [group, events, animals])

  async function submitEvent() {
    if (!companyId || !canEdit || !group) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const result = await recordLivestockEvent(supabase, {
      companyId,
      farmId,
      groupId: group.id,
      employeeId,
      eventType: eType,
      quantity: Number(eQty) || 1,
      eventDate: eDate,
      notes: eNotes,
      toLandUnitId: eType === 'move' ? (eToLand || null) : null,
      animalId: eAnimal || null,
    })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    setShowEvent(false)
    setENotes('')
    setEQty('1')
    setEAnimal('')
    await load()
  }

  async function addAnimal() {
    if (!companyId || !canEdit || !group) return
    setBusy(true)
    const supabase = createClient()
    const { error: e } = await supabase.from('farm_animals').insert({
      company_id: companyId,
      farm_id: farmId,
      group_id: group.id,
      land_unit_id: group.land_unit_id,
      tag_number: aTag.trim() || null,
      name: aName.trim() || null,
      species: group.species,
      sex: aSex || null,
      status: 'active',
    })
    setBusy(false)
    if (e) { setError(e.message); return }
    setShowAnimal(false)
    setATag('')
    setAName('')
    setASex('')
    await load()
  }

  if (loading) {
    return <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
  }
  if (!farm || !group) return null

  const animalLabel = (ev: FarmLivestockEvent) => {
    const a = ev.farm_animals
    if (!a) return '—'
    if (a.tag_number && a.name) return `${a.tag_number} · ${a.name}`
    return a.tag_number ?? a.name ?? '—'
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 space-y-4 pb-12">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => router.push(`/dashboard/farms/${farmId}?tab=livestock`)}
              className="flex items-center gap-1 text-[13px] text-primary hover:underline"
            >
              <span className="material-icons text-[16px]">arrow_back</span>{farm.name}
            </button>
            <Link href="/dashboard/farms/livestock" className="text-[12px] text-primary hover:underline">
              All livestock →
            </Link>
          </div>
        </div>

        <div className="bg-surface border border-divider rounded-xl p-4 space-y-1">
          <h1 className="text-[20px] font-semibold text-text-primary">{group.name}</h1>
          <p className="text-[13px] text-text-secondary capitalize">
            {group.species}
            {group.breed ? ` · ${group.breed}` : ''}
            {group.farm_land_units?.name ? ` · ${group.farm_land_units.name}` : ''}
            {' · '}
            <span className="capitalize">{group.status}</span>
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiTile value={kpis.headcount} label="Current headcount" bg="#1E293B" valueFg="#FCD34D" labelFg="#64748B" />
          <KpiTile value={kpis.animals} label="Tagged animals" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
          <KpiTile value={kpis.intake} label="Total intake (all time)" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
          <KpiTile value={kpis.deaths} label="Deaths / culls (mo)" bg="#3F1D1D" valueFg="#F87171" labelFg="#FCA5A5" />
        </div>

        {error && <p className="text-[13px] text-error">{error}</p>}

        <div className="flex gap-2 flex-wrap">
          {canEdit && (
            <>
              <button type="button" onClick={() => setShowEvent(true)} className="btn-primary h-9 px-3 text-[13px]">
                Record event
              </button>
              <button type="button" onClick={() => setShowAnimal(true)} className="btn-outlined h-9 px-3 text-[13px]">
                + Tagged animal
              </button>
            </>
          )}
        </div>

        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold text-text-primary uppercase tracking-wide">Activity / events</h2>
          {events.length === 0 ? (
            <p className="text-[13px] text-text-secondary">No events for this group yet.</p>
          ) : (
            <div className="overflow-x-auto border border-divider rounded-xl">
              <table className="w-full" style={{ minWidth: 640 }}>
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider">
                    <th className="data-th text-left">Date</th>
                    <th className="data-th text-left">Type</th>
                    <th className="data-th text-left">Animal</th>
                    <th className="data-th text-right">Qty</th>
                    <th className="data-th text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <tr key={ev.id} className="border-b border-divider last:border-0">
                      <td className="data-td text-[13px]">{ev.event_date}</td>
                      <td className="data-td text-[13px]">{EVENT_TYPE_LABELS[ev.event_type]}</td>
                      <td className="data-td text-[13px] text-text-secondary">{animalLabel(ev)}</td>
                      <td className="data-td text-[13px] text-right font-medium">{ev.quantity}</td>
                      <td className="data-td text-[13px] text-text-secondary">{ev.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold text-text-primary uppercase tracking-wide">Tagged animals</h2>
          {animals.length === 0 ? (
            <p className="text-[13px] text-text-secondary">No tagged individuals in this group (normal for flocks).</p>
          ) : (
            <div className="overflow-x-auto border border-divider rounded-xl">
              <table className="w-full" style={{ minWidth: 480 }}>
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider">
                    <th className="data-th text-left">Tag</th>
                    <th className="data-th text-left">Name</th>
                    <th className="data-th text-left">Sex</th>
                    <th className="data-th text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {animals.map(a => (
                    <tr key={a.id} className="border-b border-divider last:border-0">
                      <td className="data-td text-[13px] text-primary">{a.tag_number ?? '—'}</td>
                      <td className="data-td text-[13px]">{a.name ?? '—'}</td>
                      <td className="data-td text-[13px] capitalize">{a.sex ?? '—'}</td>
                      <td className="data-td text-[12px] capitalize">{a.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {showEvent && (
        <Modal title={`Record event · ${group.name}`} onClose={() => setShowEvent(false)}>
          <label className="block text-[12px] text-text-secondary">Event
            <select value={eType} onChange={e => setEType(e.target.value as LivestockEventType)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              {(Object.keys(EVENT_TYPE_LABELS) as LivestockEventType[]).map(k => (
                <option key={k} value={k}>{EVENT_TYPE_LABELS[k]}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-text-secondary">Quantity / new count
              <input type="number" min={1} value={eQty} onChange={e => setEQty(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Date
              <input type="date" value={eDate} onChange={e => setEDate(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
          </div>
          {eType === 'count_adjust' && (
            <p className="text-[11px] text-text-secondary">Enter the new absolute headcount.</p>
          )}
          {eType === 'move' && (
            <label className="block text-[12px] text-text-secondary">Move to land unit
              <select value={eToLand} onChange={e => setEToLand(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                <option value="">Select…</option>
                {landUnits.filter(u => u.is_active).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          )}
          {animals.length > 0 && (
            <label className="block text-[12px] text-text-secondary">Animal (optional)
              <select value={eAnimal} onChange={e => setEAnimal(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                <option value="">— Whole group —</option>
                {animals.filter(a => a.status === 'active').map(a => (
                  <option key={a.id} value={a.id}>{a.tag_number ?? a.name ?? a.id.slice(0, 8)}</option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-[12px] text-text-secondary">Notes
            <input value={eNotes} onChange={e => setENotes(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowEvent(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void submitEvent()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Save event</button>
          </div>
        </Modal>
      )}

      {showAnimal && (
        <Modal title="Add tagged animal" onClose={() => setShowAnimal(false)}>
          <label className="block text-[12px] text-text-secondary">Tag number
            <input value={aTag} onChange={e => setATag(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Name (optional)
            <input value={aName} onChange={e => setAName(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Sex
            <select value={aSex} onChange={e => setASex(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              <option value="">Unknown</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAnimal(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void addAnimal()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Add</button>
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
