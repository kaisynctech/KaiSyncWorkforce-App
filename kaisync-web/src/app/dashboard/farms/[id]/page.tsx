'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { recordLivestockEvent } from '@/lib/farms'
import { KpiTile } from '@/components/ui/KpiTile'
import {
  EVENT_TYPE_LABELS,
  LAND_UNIT_TYPES,
  SPECIES_OPTIONS,
  type Farm,
  type FarmAnimal,
  type FarmLandUnit,
  type FarmLandUnitType,
  type FarmLivestockEvent,
  type FarmLivestockGroup,
  type LivestockEventType,
  type LivestockSpecies,
} from '@/types/farms'

type Tab = 'overview' | 'land' | 'livestock' | 'animals' | 'events'

export default function FarmDetailPage() {
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <FarmDetailInner />
    </Suspense>
  )
}

function FarmDetailInner() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get('tab') as Tab | null)
  const [tab, setTab] = useState<Tab>(
    initialTab && ['overview', 'land', 'livestock', 'animals', 'events'].includes(initialTab)
      ? initialTab
      : 'overview',
  )
  const [farm, setFarm] = useState<Farm | null>(null)
  const [landUnits, setLandUnits] = useState<FarmLandUnit[]>([])
  const [groups, setGroups] = useState<FarmLivestockGroup[]>([])
  const [animals, setAnimals] = useState<FarmAnimal[]>([])
  const [events, setEvents] = useState<FarmLivestockEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Edit farm
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [isActive, setIsActive] = useState(true)

  // Land unit form
  const [showLand, setShowLand] = useState(false)
  const [landName, setLandName] = useState('')
  const [landType, setLandType] = useState<FarmLandUnitType>('camp')
  const [landArea, setLandArea] = useState('')

  // Group form
  const [showGroup, setShowGroup] = useState(false)
  const [gName, setGName] = useState('')
  const [gSpecies, setGSpecies] = useState<LivestockSpecies>('chicken')
  const [gBreed, setGBreed] = useState('')
  const [gCount, setGCount] = useState('0')
  const [gLand, setGLand] = useState('')

  // Event form
  const [showEvent, setShowEvent] = useState(false)
  const [eGroup, setEGroup] = useState('')
  const [eType, setEType] = useState<LivestockEventType>('death')
  const [eQty, setEQty] = useState('1')
  const [eDate, setEDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [eNotes, setENotes] = useState('')
  const [eToLand, setEToLand] = useState('')

  // Animal form
  const [showAnimal, setShowAnimal] = useState(false)
  const [aTag, setATag] = useState('')
  const [aName, setAName] = useState('')
  const [aSpecies, setASpecies] = useState<LivestockSpecies>('cattle')
  const [aGroup, setAGroup] = useState('')
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

    const [fRes, lRes, gRes, aRes, eRes] = await Promise.all([
      supabase.from('farms').select('*').eq('id', id).eq('company_id', member.companyId).maybeSingle(),
      supabase.from('farm_land_units').select('*').eq('farm_id', id).eq('company_id', member.companyId).order('name'),
      supabase.from('farm_livestock_groups').select('*, farm_land_units(name)').eq('farm_id', id).eq('company_id', member.companyId).order('name'),
      supabase.from('farm_animals').select('*').eq('farm_id', id).eq('company_id', member.companyId).order('tag_number'),
      supabase.from('farm_livestock_events').select('*').eq('farm_id', id).eq('company_id', member.companyId).order('event_date', { ascending: false }).limit(100),
    ])

    if (!fRes.data) {
      router.replace('/dashboard/farms')
      return
    }
    const f = fRes.data as Farm
    setFarm(f)
    setName(f.name)
    setCode(f.farm_code ?? '')
    setAddress(f.address ?? '')
    setNotes(f.notes ?? '')
    setIsActive(f.is_active)
    setLandUnits((lRes.data ?? []) as FarmLandUnit[])
    setGroups((gRes.data ?? []) as FarmLivestockGroup[])
    setAnimals((aRes.data ?? []) as FarmAnimal[])
    setEvents((eRes.data ?? []) as FarmLivestockEvent[])
    setLoading(false)
  }, [id, router])

  useEffect(() => { void load() }, [load])

  const kpis = useMemo(() => {
    const activeGroups = groups.filter(g => g.status === 'active')
    const headcount = activeGroups.reduce((s, g) => s + Number(g.headcount ?? 0), 0)
    const monthStart = new Date()
    monthStart.setDate(1)
    const monthIso = monthStart.toISOString().slice(0, 10)
    const deaths = events
      .filter(e => (e.event_type === 'death' || e.event_type === 'cull') && e.event_date >= monthIso)
      .reduce((s, e) => s + e.quantity, 0)
    return {
      headcount,
      camps: landUnits.filter(u => u.is_active).length,
      groups: activeGroups.length,
      deaths,
    }
  }, [groups, landUnits, events])

  async function saveFarm() {
    if (!companyId || !canEdit || !name.trim()) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: e } = await supabase.from('farms').update({
      name: name.trim(),
      farm_code: code.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('company_id', companyId)
    setBusy(false)
    if (e) { setError(e.message); return }
    await load()
  }

  async function addLandUnit() {
    if (!companyId || !canEdit || !landName.trim()) return
    setBusy(true)
    const supabase = createClient()
    const { error: e } = await supabase.from('farm_land_units').insert({
      company_id: companyId,
      farm_id: id,
      name: landName.trim(),
      unit_type: landType,
      area_ha: landArea ? Number(landArea) : null,
      is_active: true,
    })
    setBusy(false)
    if (e) { setError(e.message); return }
    setShowLand(false)
    setLandName('')
    setLandArea('')
    await load()
  }

  async function addGroup() {
    if (!companyId || !canEdit || !gName.trim()) return
    setBusy(true)
    const supabase = createClient()
    const headcount = Math.max(0, Math.floor(Number(gCount) || 0))
    const { data: created, error: e } = await supabase.from('farm_livestock_groups').insert({
      company_id: companyId,
      farm_id: id,
      name: gName.trim(),
      species: gSpecies,
      breed: gBreed.trim() || null,
      headcount,
      land_unit_id: gLand || null,
      status: 'active',
      created_by: employeeId,
      acquired_at: new Date().toISOString().slice(0, 10),
    }).select('id').single()
    if (e || !created) {
      setBusy(false)
      setError(e?.message ?? 'Failed to create group')
      return
    }
    if (headcount > 0) {
      await supabase.from('farm_livestock_events').insert({
        company_id: companyId,
        farm_id: id,
        group_id: created.id,
        event_type: 'intake',
        event_date: new Date().toISOString().slice(0, 10),
        quantity: headcount,
        notes: 'Initial intake',
        recorded_by: employeeId,
      })
    }
    setBusy(false)
    setShowGroup(false)
    setGName('')
    setGBreed('')
    setGCount('0')
    setGLand('')
    await load()
  }

  async function addAnimal() {
    if (!companyId || !canEdit) return
    setBusy(true)
    const supabase = createClient()
    const { error: e } = await supabase.from('farm_animals').insert({
      company_id: companyId,
      farm_id: id,
      tag_number: aTag.trim() || null,
      name: aName.trim() || null,
      species: aSpecies,
      group_id: aGroup || null,
      sex: aSex || null,
      status: 'active',
    })
    setBusy(false)
    if (e) { setError(e.message); return }
    setShowAnimal(false)
    setATag('')
    setAName('')
    setAGroup('')
    setASex('')
    await load()
  }

  async function submitEvent() {
    if (!companyId || !canEdit || !eGroup) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const result = await recordLivestockEvent(supabase, {
      companyId,
      farmId: id,
      groupId: eGroup,
      employeeId,
      eventType: eType,
      quantity: Number(eQty) || 1,
      eventDate: eDate,
      notes: eNotes,
      toLandUnitId: eType === 'move' ? (eToLand || null) : null,
    })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    setShowEvent(false)
    setENotes('')
    setEQty('1')
    await load()
  }

  if (loading) {
    return <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
  }
  if (!farm) return null

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'land', label: 'Land units' },
    { id: 'livestock', label: 'Livestock' },
    { id: 'animals', label: 'Animals' },
    { id: 'events', label: 'Events' },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 space-y-4 pb-12">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button type="button" onClick={() => router.push('/dashboard/farms')} className="flex items-center gap-1 text-[13px] text-primary hover:underline">
            <span className="material-icons text-[16px]">arrow_back</span>Farms
          </button>
          <Link href="/dashboard/farms/livestock" className="text-[12px] text-primary hover:underline">All livestock →</Link>
        </div>

        <div className="bg-surface border border-divider rounded-xl p-4">
          <h1 className="text-[20px] font-semibold text-text-primary">{farm.name}</h1>
          <p className="text-[13px] text-text-secondary">
            {farm.farm_code ? `${farm.farm_code} · ` : ''}{farm.is_active ? 'Active' : 'Inactive'}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiTile value={kpis.headcount} label="Headcount" bg="#1E293B" valueFg="#FCD34D" labelFg="#64748B" />
          <KpiTile value={kpis.groups} label="Active groups" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
          <KpiTile value={kpis.camps} label="Land units" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
          <KpiTile value={kpis.deaths} label="Deaths / culls (mo)" bg="#3F1D1D" valueFg="#F87171" labelFg="#FCA5A5" />
        </div>

        {error && <p className="text-[13px] text-error">{error}</p>}

        <div className="flex gap-1 border-b border-divider overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-[13px] font-medium border-b-2 -mb-px whitespace-nowrap ${
                tab === t.id ? 'border-primary text-primary' : 'border-transparent text-text-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="bg-surface border border-divider rounded-xl p-4 space-y-3">
            <label className="block text-[12px] text-text-secondary">Name
              <input value={name} onChange={e => setName(e.target.value)} disabled={!canEdit} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[12px] text-text-secondary">Code
                <input value={code} onChange={e => setCode(e.target.value)} disabled={!canEdit} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60" />
              </label>
              <label className="block text-[12px] text-text-secondary">Status
                <select value={isActive ? '1' : '0'} onChange={e => setIsActive(e.target.value === '1')} disabled={!canEdit} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60">
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </label>
            </div>
            <label className="block text-[12px] text-text-secondary">Address
              <input value={address} onChange={e => setAddress(e.target.value)} disabled={!canEdit} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60" />
            </label>
            <label className="block text-[12px] text-text-secondary">Notes
              <textarea value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit} rows={3} className="mt-1 w-full px-3 py-2 border border-border rounded-md text-[13px] bg-background disabled:opacity-60" />
            </label>
            {canEdit && (
              <button type="button" disabled={busy} onClick={() => void saveFarm()} className="btn-primary h-10 px-4 text-[13px] disabled:opacity-50">
                {busy ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        )}

        {tab === 'land' && (
          <div className="space-y-3">
            {canEdit && (
              <button type="button" onClick={() => setShowLand(true)} className="btn-outlined h-9 px-3 text-[13px]">+ Land unit</button>
            )}
            {landUnits.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No camps or paddocks yet.</p>
            ) : (
              <table className="w-full" style={{ minWidth: 480 }}>
                <thead>
                  <tr className="border-b border-divider">
                    <th className="data-th text-left">Name</th>
                    <th className="data-th text-left">Type</th>
                    <th className="data-th text-right">Area (ha)</th>
                    <th className="data-th text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {landUnits.map(u => (
                    <tr key={u.id} className="border-b border-divider">
                      <td className="data-td text-[13px]">{u.name}</td>
                      <td className="data-td text-[13px] capitalize">{u.unit_type}</td>
                      <td className="data-td text-[13px] text-right">{u.area_ha ?? '—'}</td>
                      <td className="data-td text-[12px]">{u.is_active ? 'Active' : 'Inactive'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'livestock' && (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              {canEdit && (
                <>
                  <button type="button" onClick={() => setShowGroup(true)} className="btn-outlined h-9 px-3 text-[13px]">+ Group / flock</button>
                  <button type="button" onClick={() => setShowEvent(true)} className="btn-primary h-9 px-3 text-[13px]">Record event</button>
                </>
              )}
            </div>
            {groups.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No livestock groups yet.</p>
            ) : (
              <table className="w-full" style={{ minWidth: 560 }}>
                <thead>
                  <tr className="border-b border-divider">
                    <th className="data-th text-left">Name</th>
                    <th className="data-th text-left">Species</th>
                    <th className="data-th text-left">Land</th>
                    <th className="data-th text-right">Headcount</th>
                    <th className="data-th text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(g => (
                    <tr key={g.id} className="border-b border-divider">
                      <td className="data-td text-[13px] font-medium">{g.name}</td>
                      <td className="data-td text-[13px] capitalize">{g.species}{g.breed ? ` · ${g.breed}` : ''}</td>
                      <td className="data-td text-[13px] text-text-secondary">{g.farm_land_units?.name ?? '—'}</td>
                      <td className="data-td text-[13px] text-right font-medium">{g.headcount}</td>
                      <td className="data-td text-[12px] capitalize">{g.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'animals' && (
          <div className="space-y-3">
            {canEdit && (
              <button type="button" onClick={() => setShowAnimal(true)} className="btn-outlined h-9 px-3 text-[13px]">+ Animal (tagged)</button>
            )}
            <p className="text-[12px] text-text-secondary">Optional individual register (cattle tags, etc.). Flocks can stay as groups only.</p>
            {animals.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No tagged animals.</p>
            ) : (
              <table className="w-full" style={{ minWidth: 520 }}>
                <thead>
                  <tr className="border-b border-divider">
                    <th className="data-th text-left">Tag</th>
                    <th className="data-th text-left">Name</th>
                    <th className="data-th text-left">Species</th>
                    <th className="data-th text-left">Sex</th>
                    <th className="data-th text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {animals.map(a => (
                    <tr key={a.id} className="border-b border-divider">
                      <td className="data-td text-[13px] text-primary">{a.tag_number ?? '—'}</td>
                      <td className="data-td text-[13px]">{a.name ?? '—'}</td>
                      <td className="data-td text-[13px] capitalize">{a.species}</td>
                      <td className="data-td text-[13px] capitalize">{a.sex ?? '—'}</td>
                      <td className="data-td text-[12px] capitalize">{a.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'events' && (
          <div className="space-y-3">
            {canEdit && (
              <button type="button" onClick={() => setShowEvent(true)} className="btn-primary h-9 px-3 text-[13px]">Record event</button>
            )}
            {events.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No events recorded.</p>
            ) : (
              <table className="w-full" style={{ minWidth: 560 }}>
                <thead>
                  <tr className="border-b border-divider">
                    <th className="data-th text-left">Date</th>
                    <th className="data-th text-left">Type</th>
                    <th className="data-th text-right">Qty</th>
                    <th className="data-th text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <tr key={ev.id} className="border-b border-divider">
                      <td className="data-td text-[13px]">{ev.event_date}</td>
                      <td className="data-td text-[13px]">{EVENT_TYPE_LABELS[ev.event_type]}</td>
                      <td className="data-td text-[13px] text-right">{ev.quantity}</td>
                      <td className="data-td text-[13px] text-text-secondary">{ev.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {showLand && (
        <Modal title="New land unit" onClose={() => setShowLand(false)}>
          <label className="block text-[12px] text-text-secondary">Name
            <input value={landName} onChange={e => setLandName(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Type
            <select value={landType} onChange={e => setLandType(e.target.value as FarmLandUnitType)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              {LAND_UNIT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="block text-[12px] text-text-secondary">Area (ha)
            <input type="number" step="0.01" value={landArea} onChange={e => setLandArea(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowLand(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
            <button type="button" disabled={busy || !landName.trim()} onClick={() => void addLandUnit()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Add</button>
          </div>
        </Modal>
      )}

      {showGroup && (
        <Modal title="New livestock group" onClose={() => setShowGroup(false)}>
          <label className="block text-[12px] text-text-secondary">Name
            <input value={gName} onChange={e => setGName(e.target.value)} placeholder="e.g. Broiler house A" className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Species
            <select value={gSpecies} onChange={e => setGSpecies(e.target.value as LivestockSpecies)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              {SPECIES_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="block text-[12px] text-text-secondary">Breed (optional)
            <input value={gBreed} onChange={e => setGBreed(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Starting headcount
            <input type="number" min={0} value={gCount} onChange={e => setGCount(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Land unit
            <select value={gLand} onChange={e => setGLand(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              <option value="">— None —</option>
              {landUnits.filter(u => u.is_active).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowGroup(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
            <button type="button" disabled={busy || !gName.trim()} onClick={() => void addGroup()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Create</button>
          </div>
        </Modal>
      )}

      {showEvent && (
        <Modal title="Record livestock event" onClose={() => setShowEvent(false)}>
          <label className="block text-[12px] text-text-secondary">Group
            <select value={eGroup} onChange={e => setEGroup(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              <option value="">Select…</option>
              {groups.filter(g => g.status === 'active').map(g => (
                <option key={g.id} value={g.id}>{g.name} ({g.headcount})</option>
              ))}
            </select>
          </label>
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
            <p className="text-[11px] text-text-secondary">For count adjust, enter the new absolute headcount.</p>
          )}
          {eType === 'move' && (
            <label className="block text-[12px] text-text-secondary">Move to land unit
              <select value={eToLand} onChange={e => setEToLand(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                <option value="">Select…</option>
                {landUnits.filter(u => u.is_active).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          )}
          <label className="block text-[12px] text-text-secondary">Notes
            <input value={eNotes} onChange={e => setENotes(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowEvent(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
            <button type="button" disabled={busy || !eGroup} onClick={() => void submitEvent()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Save event</button>
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
          <label className="block text-[12px] text-text-secondary">Species
            <select value={aSpecies} onChange={e => setASpecies(e.target.value as LivestockSpecies)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              {SPECIES_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="block text-[12px] text-text-secondary">Group (optional)
            <select value={aGroup} onChange={e => setAGroup(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              <option value="">— None —</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
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
