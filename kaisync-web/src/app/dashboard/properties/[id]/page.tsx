'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { syncUnitOccupancy } from '@/lib/properties'
import { KpiTile } from '@/components/ui/KpiTile'
import type { Resident, Site, SiteComplianceEntry, Unit } from '@/types/database'

type Tab = 'overview' | 'units' | 'residents' | 'compliance'
type ClientOption = { id: string; name: string }

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
}

function complianceStatus(expiry: string | null | undefined): string {
  if (!expiry) return 'open'
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return 'expired'
  if (days <= 30) return 'expiring'
  return 'valid'
}

export default function PropertyDetailPage() {
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <PropertyDetailInner />
    </Suspense>
  )
}

function PropertyDetailInner() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get('tab') as Tab | null)
  const [tab, setTab] = useState<Tab>(
    initialTab && ['overview', 'units', 'residents', 'compliance'].includes(initialTab)
      ? initialTab
      : 'overview',
  )

  const [site, setSite] = useState<Site | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [residents, setResidents] = useState<Resident[]>([])
  const [compliance, setCompliance] = useState<SiteComplianceEntry[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [radius, setRadius] = useState('200')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [clientId, setClientId] = useState('')
  const [isActive, setIsActive] = useState(true)

  const [showUnit, setShowUnit] = useState(false)
  const [editUnit, setEditUnit] = useState<Unit | null>(null)
  const [uNumber, setUNumber] = useState('')
  const [uType, setUType] = useState('')
  const [uFloor, setUFloor] = useState('')
  const [uNotes, setUNotes] = useState('')

  const [showResident, setShowResident] = useState(false)
  const [editResident, setEditResident] = useState<Resident | null>(null)
  const [rName, setRName] = useState('')
  const [rSurname, setRSurname] = useState('')
  const [rPhone, setRPhone] = useState('')
  const [rEmail, setREmail] = useState('')
  const [rUnit, setRUnit] = useState('')
  const [rMoveIn, setRMoveIn] = useState('')
  const [rMoveOut, setRMoveOut] = useState('')
  const [rNotes, setRNotes] = useState('')

  const [showCompliance, setShowCompliance] = useState(false)
  const [cType, setCType] = useState('')
  const [cNumber, setCNumber] = useState('')
  const [cIssued, setCIssued] = useState('')
  const [cExpiry, setCExpiry] = useState('')
  const [cBy, setCBy] = useState('')
  const [cNotes, setCNotes] = useState('')

  const canEdit = can(perms, PERM.propertiesEdit)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)
    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

    const [sRes, uRes, rRes, cRes, clRes] = await Promise.all([
      supabase.from('sites').select('*, clients(id, name)').eq('id', id).eq('company_id', member.companyId).maybeSingle(),
      supabase.from('units').select('*').eq('site_id', id).eq('company_id', member.companyId).order('unit_number'),
      supabase.from('residents').select('*').eq('site_id', id).eq('company_id', member.companyId).order('name'),
      supabase.from('compliance_entries').select('*').eq('site_id', id).eq('company_id', member.companyId).order('expiry_date', { ascending: true, nullsFirst: false }),
      supabase.from('clients').select('id, name').eq('company_id', member.companyId).order('name').limit(500),
    ])

    if (!sRes.data) {
      router.replace('/dashboard/properties')
      return
    }
    const s = sRes.data as Site
    setSite(s)
    setName(s.name)
    setAddress(s.address ?? '')
    setNotes(s.notes ?? '')
    setRadius(String(s.radius_meters ?? 200))
    setLatitude(s.latitude != null ? String(s.latitude) : '')
    setLongitude(s.longitude != null ? String(s.longitude) : '')
    setClientId(s.client_id ?? '')
    setIsActive(s.is_active !== false)
    setUnits((uRes.data ?? []) as Unit[])
    setResidents((rRes.data ?? []) as Resident[])
    setCompliance((cRes.data ?? []) as SiteComplianceEntry[])
    setClients((clRes.data ?? []) as ClientOption[])
    setLoading(false)
  }, [id, router])

  useEffect(() => { void load() }, [load])

  const kpis = useMemo(() => {
    const occupied = units.filter(u => u.is_occupied).length
    const currentResidents = residents.filter(r => !r.move_out_date).length
    const expiring = compliance.filter(c => {
      const st = complianceStatus(c.expiry_date)
      return st === 'expired' || st === 'expiring'
    }).length
    return {
      units: units.length,
      vacant: units.length - occupied,
      residents: currentResidents,
      complianceAlerts: expiring,
    }
  }, [units, residents, compliance])

  const unitLabel = (unitId: string | null | undefined) => {
    if (!unitId) return '—'
    return units.find(u => u.id === unitId)?.unit_number ?? '—'
  }

  async function saveSite() {
    if (!companyId || !canEdit || !name.trim()) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const lat = latitude ? parseFloat(latitude) : null
    const lng = longitude ? parseFloat(longitude) : null
    const { error: e } = await supabase.from('sites').update({
      name: name.trim(),
      address: address.trim() || null,
      notes: notes.trim() || null,
      radius_meters: parseFloat(radius) || 200,
      latitude: Number.isFinite(lat as number) ? lat : null,
      longitude: Number.isFinite(lng as number) ? lng : null,
      client_id: clientId || null,
      is_active: isActive,
    }).eq('id', id).eq('company_id', companyId)
    setBusy(false)
    if (e) { setError(e.message); return }
    await load()
  }

  function openCreateUnit() {
    setEditUnit(null)
    setUNumber(''); setUType(''); setUFloor(''); setUNotes('')
    setShowUnit(true)
  }

  function openEditUnit(u: Unit) {
    setEditUnit(u)
    setUNumber(u.unit_number)
    setUType(u.unit_type ?? '')
    setUFloor(u.floor ?? '')
    setUNotes(u.notes ?? '')
    setShowUnit(true)
  }

  async function saveUnit() {
    if (!companyId || !canEdit || !uNumber.trim()) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const payload = {
      unit_number: uNumber.trim(),
      unit_type: uType.trim() || null,
      floor: uFloor.trim() || null,
      notes: uNotes.trim() || null,
    }
    if (editUnit) {
      const { error: e } = await supabase.from('units').update(payload).eq('id', editUnit.id).eq('company_id', companyId)
      setBusy(false)
      if (e) { setError(e.message); return }
    } else {
      const { error: e } = await supabase.from('units').insert({
        company_id: companyId,
        site_id: id,
        is_occupied: false,
        ...payload,
      })
      setBusy(false)
      if (e) { setError(e.message); return }
    }
    setShowUnit(false)
    await load()
  }

  function openCreateResident() {
    setEditResident(null)
    setRName(''); setRSurname(''); setRPhone(''); setREmail('')
    setRUnit(''); setRMoveIn(new Date().toISOString().slice(0, 10)); setRMoveOut(''); setRNotes('')
    setShowResident(true)
  }

  function openEditResident(r: Resident) {
    setEditResident(r)
    setRName(r.name); setRSurname(r.surname)
    setRPhone(r.phone ?? ''); setREmail(r.email ?? '')
    setRUnit(r.unit_id ?? '')
    setRMoveIn(r.move_in_date ?? ''); setRMoveOut(r.move_out_date ?? '')
    setRNotes(r.notes ?? '')
    setShowResident(true)
  }

  async function saveResident() {
    if (!companyId || !canEdit || !rName.trim() || !rSurname.trim()) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const prevUnitId = editResident?.unit_id ?? null
    const nextUnitId = rUnit || null
    const payload = {
      name: rName.trim(),
      surname: rSurname.trim(),
      phone: rPhone.trim() || null,
      email: rEmail.trim() || null,
      unit_id: nextUnitId,
      move_in_date: rMoveIn || null,
      move_out_date: rMoveOut || null,
      notes: rNotes.trim() || null,
    }

    if (editResident) {
      const { error: e } = await supabase.from('residents').update(payload).eq('id', editResident.id).eq('company_id', companyId)
      if (e) { setBusy(false); setError(e.message); return }
    } else {
      const { error: e } = await supabase.from('residents').insert({
        company_id: companyId,
        site_id: id,
        ...payload,
      })
      if (e) { setBusy(false); setError(e.message); return }
    }

    await syncUnitOccupancy(supabase, companyId, prevUnitId)
    if (nextUnitId !== prevUnitId) await syncUnitOccupancy(supabase, companyId, nextUnitId)
    // Also re-sync if move-out toggled on same unit
    if (nextUnitId) await syncUnitOccupancy(supabase, companyId, nextUnitId)

    setBusy(false)
    setShowResident(false)
    await load()
  }

  async function saveCompliance() {
    if (!companyId || !canEdit || !cType.trim()) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: e } = await supabase.from('compliance_entries').insert({
      company_id: companyId,
      site_id: id,
      compliance_type: cType.trim(),
      certificate_number: cNumber.trim() || null,
      issued_date: cIssued || null,
      expiry_date: cExpiry || null,
      issued_by: cBy.trim() || null,
      notes: cNotes.trim() || null,
    })
    setBusy(false)
    if (e) { setError(e.message); return }
    setShowCompliance(false)
    setCType(''); setCNumber(''); setCIssued(''); setCExpiry(''); setCBy(''); setCNotes('')
    await load()
  }

  if (loading) {
    return <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
  }
  if (!site) return null

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'units', label: 'Units' },
    { id: 'residents', label: 'Residents' },
    { id: 'compliance', label: 'Compliance' },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 space-y-4 pb-12">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button type="button" onClick={() => router.push('/dashboard/properties')} className="flex items-center gap-1 text-[13px] text-primary hover:underline">
            <span className="material-icons text-[16px]">arrow_back</span>Properties
          </button>
          <Link href={`/dashboard/residents?siteId=${id}`} className="text-[12px] text-primary hover:underline">
            All residents view →
          </Link>
        </div>

        <div className="bg-surface border border-divider rounded-xl p-4">
          <h1 className="text-[20px] font-semibold text-text-primary">{site.name}</h1>
          <p className="text-[13px] text-text-secondary">
            {site.address ? `${site.address} · ` : ''}
            {site.is_active === false ? 'Inactive' : 'Active'}
            {site.clients?.name ? ` · Client: ${site.clients.name}` : ''}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiTile value={kpis.units} label="Units" bg="#1E293B" valueFg="#FCD34D" labelFg="#64748B" />
          <KpiTile value={kpis.vacant} label="Vacant" bg="#3F1D1D" valueFg="#F87171" labelFg="#FCA5A5" />
          <KpiTile value={kpis.residents} label="Current residents" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
          <KpiTile value={kpis.complianceAlerts} label="Compliance alerts" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
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
            <label className="block text-[12px] text-text-secondary">Address
              <input value={address} onChange={e => setAddress(e.target.value)} disabled={!canEdit} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60" />
            </label>
            <label className="block text-[12px] text-text-secondary">Linked client (owner / principal)
              <select value={clientId} onChange={e => setClientId(e.target.value)} disabled={!canEdit} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60">
                <option value="">— None —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[12px] text-text-secondary">Geofence radius (m)
                <input type="number" value={radius} onChange={e => setRadius(e.target.value)} disabled={!canEdit} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60" />
              </label>
              <label className="block text-[12px] text-text-secondary">Status
                <select value={isActive ? '1' : '0'} onChange={e => setIsActive(e.target.value === '1')} disabled={!canEdit} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60">
                  <option value="1">Active (billable)</option>
                  <option value="0">Inactive</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[12px] text-text-secondary">Latitude
                <input value={latitude} onChange={e => setLatitude(e.target.value)} disabled={!canEdit} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60" />
              </label>
              <label className="block text-[12px] text-text-secondary">Longitude
                <input value={longitude} onChange={e => setLongitude(e.target.value)} disabled={!canEdit} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60" />
              </label>
            </div>
            <label className="block text-[12px] text-text-secondary">Notes
              <textarea value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit} rows={3} className="mt-1 w-full px-3 py-2 border border-border rounded-md text-[13px] bg-background disabled:opacity-60" />
            </label>
            {canEdit && (
              <button type="button" disabled={busy} onClick={() => void saveSite()} className="btn-primary h-10 px-4 text-[13px] disabled:opacity-50">
                {busy ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        )}

        {tab === 'units' && (
          <div className="space-y-3">
            {canEdit && (
              <button type="button" onClick={openCreateUnit} className="btn-outlined h-9 px-3 text-[13px]">+ Unit</button>
            )}
            <p className="text-[12px] text-text-secondary">Flats, cottages, back rooms, shops — any lettable unit on this property.</p>
            {units.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No units yet.</p>
            ) : (
              <table className="w-full" style={{ minWidth: 560 }}>
                <thead>
                  <tr className="border-b border-divider">
                    <th className="data-th text-left">Unit</th>
                    <th className="data-th text-left">Type</th>
                    <th className="data-th text-left">Floor</th>
                    <th className="data-th text-left">Occupancy</th>
                    <th className="data-th text-left" />
                  </tr>
                </thead>
                <tbody>
                  {units.map(u => (
                    <tr key={u.id} className="border-b border-divider">
                      <td className="data-td text-[13px] font-medium">{u.unit_number}</td>
                      <td className="data-td text-[13px] capitalize">{u.unit_type ?? '—'}</td>
                      <td className="data-td text-[13px]">{u.floor ?? '—'}</td>
                      <td className="data-td text-[12px]">{u.is_occupied ? 'Occupied' : 'Vacant'}</td>
                      <td className="data-td text-right">
                        {canEdit && (
                          <button type="button" onClick={() => openEditUnit(u)} className="text-[12px] text-primary hover:underline">Edit</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'residents' && (
          <div className="space-y-3">
            {canEdit && (
              <button type="button" onClick={openCreateResident} className="btn-outlined h-9 px-3 text-[13px]">+ Resident</button>
            )}
            <p className="text-[12px] text-text-secondary">People staying in units. Assign a unit and move-in/out dates to drive occupancy.</p>
            {residents.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No residents yet.</p>
            ) : (
              <table className="w-full" style={{ minWidth: 640 }}>
                <thead>
                  <tr className="border-b border-divider">
                    <th className="data-th text-left">Name</th>
                    <th className="data-th text-left">Unit</th>
                    <th className="data-th text-left">Phone</th>
                    <th className="data-th text-left">Move in</th>
                    <th className="data-th text-left">Move out</th>
                    <th className="data-th text-left" />
                  </tr>
                </thead>
                <tbody>
                  {residents.map(r => (
                    <tr key={r.id} className={`border-b border-divider ${r.move_out_date ? 'opacity-60' : ''}`}>
                      <td className="data-td text-[13px] font-medium">{r.name} {r.surname}</td>
                      <td className="data-td text-[13px]">{unitLabel(r.unit_id)}</td>
                      <td className="data-td text-[13px] text-text-secondary">{r.phone ?? '—'}</td>
                      <td className="data-td text-[12px]">{fmtDate(r.move_in_date)}</td>
                      <td className="data-td text-[12px]">{fmtDate(r.move_out_date)}</td>
                      <td className="data-td text-right">
                        {canEdit && (
                          <button type="button" onClick={() => openEditResident(r)} className="text-[12px] text-primary hover:underline">Edit</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'compliance' && (
          <div className="space-y-3">
            {canEdit && (
              <button type="button" onClick={() => setShowCompliance(true)} className="btn-outlined h-9 px-3 text-[13px]">+ Certificate</button>
            )}
            {compliance.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No compliance entries for this property.</p>
            ) : (
              <table className="w-full" style={{ minWidth: 560 }}>
                <thead>
                  <tr className="border-b border-divider">
                    <th className="data-th text-left">Type</th>
                    <th className="data-th text-left">Number</th>
                    <th className="data-th text-left">Expiry</th>
                    <th className="data-th text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {compliance.map(c => {
                    const st = complianceStatus(c.expiry_date)
                    return (
                      <tr key={c.id} className="border-b border-divider">
                        <td className="data-td text-[13px]">{c.compliance_type}</td>
                        <td className="data-td text-[13px] text-text-secondary">{c.certificate_number ?? '—'}</td>
                        <td className="data-td text-[13px]">{fmtDate(c.expiry_date)}</td>
                        <td className="data-td text-[12px] capitalize">{st}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {showUnit && (
        <Modal title={editUnit ? 'Edit unit' : 'New unit'} onClose={() => setShowUnit(false)}>
          <label className="block text-[12px] text-text-secondary">Unit number *
            <input value={uNumber} onChange={e => setUNumber(e.target.value)} placeholder="e.g. A12, Cottage 1, Back room" className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Type
            <input value={uType} onChange={e => setUType(e.target.value)} placeholder="flat, cottage, shop…" className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Floor
            <input value={uFloor} onChange={e => setUFloor(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Notes
            <input value={uNotes} onChange={e => setUNotes(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowUnit(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
            <button type="button" disabled={busy || !uNumber.trim()} onClick={() => void saveUnit()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Save</button>
          </div>
        </Modal>
      )}

      {showResident && (
        <Modal title={editResident ? 'Edit resident' : 'New resident'} onClose={() => setShowResident(false)}>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-text-secondary">Name *
              <input value={rName} onChange={e => setRName(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Surname *
              <input value={rSurname} onChange={e => setRSurname(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
          </div>
          <label className="block text-[12px] text-text-secondary">Unit
            <select value={rUnit} onChange={e => setRUnit(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              <option value="">— Unassigned —</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.unit_number}{u.unit_type ? ` · ${u.unit_type}` : ''}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-text-secondary">Phone
              <input value={rPhone} onChange={e => setRPhone(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Email
              <input value={rEmail} onChange={e => setREmail(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-text-secondary">Move in
              <input type="date" value={rMoveIn} onChange={e => setRMoveIn(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Move out
              <input type="date" value={rMoveOut} onChange={e => setRMoveOut(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
          </div>
          <label className="block text-[12px] text-text-secondary">Notes
            <input value={rNotes} onChange={e => setRNotes(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowResident(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
            <button type="button" disabled={busy || !rName.trim() || !rSurname.trim()} onClick={() => void saveResident()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Save</button>
          </div>
        </Modal>
      )}

      {showCompliance && (
        <Modal title="New compliance entry" onClose={() => setShowCompliance(false)}>
          <label className="block text-[12px] text-text-secondary">Type *
            <input value={cType} onChange={e => setCType(e.target.value)} placeholder="e.g. Electrical CoC, Fire" className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Certificate number
            <input value={cNumber} onChange={e => setCNumber(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-text-secondary">Issued
              <input type="date" value={cIssued} onChange={e => setCIssued(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Expiry
              <input type="date" value={cExpiry} onChange={e => setCExpiry(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
          </div>
          <label className="block text-[12px] text-text-secondary">Issued by
            <input value={cBy} onChange={e => setCBy(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Notes
            <input value={cNotes} onChange={e => setCNotes(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCompliance(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
            <button type="button" disabled={busy || !cType.trim()} onClick={() => void saveCompliance()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Save</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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
