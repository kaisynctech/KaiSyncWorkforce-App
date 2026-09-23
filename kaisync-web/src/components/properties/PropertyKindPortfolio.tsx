'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { PropertyManagerField, type ManagerOption } from '@/components/properties/PropertyManagerField'
import { ListPagination } from '@/components/properties/ListPagination'
import {
  expandBulkUnitRows,
  GUEST_HOUSE_UNIT_TYPES,
  insertUnitsBulk,
  previewBulkUnitNames,
  propertyKindLabel,
  STUDENT_UNIT_TYPES,
  UNIT_TYPES,
  type BulkUnitSpec,
  type UnitNamingScheme,
} from '@/lib/properties'
import { paginateSlice, PROPERTY_LIST_PAGE_SIZE, totalPages } from '@/lib/property-list'
import type { PropertyKind, Site, UnitType } from '@/types/database'

type Props = {
  title: string
  description: string
  kind: PropertyKind
}

type SiteRow = Site & {
  managed_by?: { id: string; name: string; surname: string } | null
}

type MixRow = {
  key: string
  unitType: UnitType
  count: string
  namePrefix: string
}

const NAMING_OPTIONS: { value: UnitNamingScheme; label: string; hint: string }[] = [
  { value: 'prefix_number', label: 'Name + number', hint: 'Room 1, Room 2…' },
  { value: 'door', label: 'Door numbers', hint: 'Door 1, Door 2…' },
  { value: 'zero_pad', label: 'Padded numbers', hint: 'Room 001, Room 002…' },
  { value: 'number_only', label: 'Numbers only', hint: '1, 2, 3…' },
]

function unitTypeOptionsFor(kind: PropertyKind) {
  const allowed =
    kind === 'student_accommodation' ? STUDENT_UNIT_TYPES
      : kind === 'guest_house' ? GUEST_HOUSE_UNIT_TYPES
        : UNIT_TYPES.map(t => t.value)
  return UNIT_TYPES.filter(t => allowed.includes(t.value))
}

function defaultMix(kind: PropertyKind): MixRow[] {
  if (kind === 'guest_house') {
    return [
      { key: '1', unitType: 'double', count: '4', namePrefix: 'Double' },
      { key: '2', unitType: 'family', count: '2', namePrefix: 'Family' },
      { key: '3', unitType: 'luxury', count: '1', namePrefix: 'Luxury' },
    ]
  }
  return [{ key: '1', unitType: 'room', count: '0', namePrefix: 'Room' }]
}

export function PropertyKindPortfolio({ title, description, kind }: Props) {
  const router = useRouter()
  const [sites, setSites] = useState<SiteRow[]>([])
  const [unitStats, setUnitStats] = useState<Record<string, { total: number; occupied: number }>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [employees, setEmployees] = useState<ManagerOption[]>([])

  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [managedById, setManagedById] = useState('')
  const [naming, setNaming] = useState<UnitNamingScheme>('prefix_number')
  const [startAt, setStartAt] = useState('1')
  const [mode, setMode] = useState<'simple' | 'mix'>(
    kind === 'guest_house' ? 'mix' : 'simple',
  )
  const [simpleCount, setSimpleCount] = useState(kind === 'student_accommodation' ? '100' : '10')
  const [simplePrefix, setSimplePrefix] = useState(kind === 'student_accommodation' ? 'Room' : 'Room')
  const [simpleType, setSimpleType] = useState<UnitType>(
    kind === 'student_accommodation' ? 'room' : 'double',
  )
  const [mixRows, setMixRows] = useState<MixRow[]>(() => defaultMix(kind))
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const canEdit = can(perms, PERM.propertiesEdit)
  const typeOptions = unitTypeOptionsFor(kind)
  const isStudent = kind === 'student_accommodation'
  const isGuest = kind === 'guest_house'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) {
      setError('not_linked')
      setLoading(false)
      return
    }
    setCompanyId(member.companyId)

    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

    const [sRes, statsRes, eRes] = await Promise.all([
      supabase
        .from('sites')
        .select('*, managed_by:employees!sites_managed_by_employee_id_fkey(id, name, surname)')
        .eq('company_id', member.companyId)
        .eq('property_kind', kind)
        .order('name'),
      supabase.rpc('hr_site_unit_counts', { p_company_id: member.companyId }),
      supabase
        .from('employees')
        .select('id, name, surname')
        .eq('company_id', member.companyId)
        .eq('is_active', true)
        .order('name')
        .limit(1000),
    ])

    if (sRes.error) setError(sRes.error.message)
    const list = (sRes.data ?? []) as SiteRow[]
    setSites(list)
    setEmployees((eRes.data ?? []) as ManagerOption[])

    const siteIds = new Set(list.map(s => s.id))
    const stats: Record<string, { total: number; occupied: number }> = {}
    for (const row of (statsRes.data ?? []) as { site_id: string; total: number; occupied: number }[]) {
      if (!siteIds.has(row.site_id)) continue
      stats[row.site_id] = { total: Number(row.total) || 0, occupied: Number(row.occupied) || 0 }
    }
    if (statsRes.error) {
      console.error('hr_site_unit_counts', statsRes.error.message)
    }
    setUnitStats(stats)
    setLoading(false)
  }, [kind])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sites.filter(s => {
      if (!q) return true
      const mgr = s.managed_by ? `${s.managed_by.name} ${s.managed_by.surname}` : ''
      return s.name.toLowerCase().includes(q)
        || (s.address ?? '').toLowerCase().includes(q)
        || mgr.toLowerCase().includes(q)
    })
  }, [sites, search])

  useEffect(() => { setPage(1) }, [search, kind])

  const pageCount = totalPages(filtered.length, PROPERTY_LIST_PAGE_SIZE)
  const paged = useMemo(
    () => paginateSlice(filtered, Math.min(page, pageCount), PROPERTY_LIST_PAGE_SIZE),
    [filtered, page, pageCount],
  )

  const bulkSpecs: BulkUnitSpec[] = useMemo(() => {
    const start = parseInt(startAt, 10) || 1
    if (mode === 'simple') {
      return [{
        count: parseInt(simpleCount, 10) || 0,
        unitType: simpleType,
        namePrefix: naming === 'door' ? '' : simplePrefix,
        naming,
        startAt: start,
      }]
    }
    let cursor = start
    const specs: BulkUnitSpec[] = []
    for (const row of mixRows) {
      const count = parseInt(row.count, 10) || 0
      if (count <= 0) continue
      specs.push({
        count,
        unitType: row.unitType,
        namePrefix: naming === 'door' ? '' : (row.namePrefix.trim() || UNIT_TYPES.find(t => t.value === row.unitType)?.label || 'Room'),
        naming,
        startAt: cursor,
      })
      cursor += count
    }
    return specs
  }, [mode, simpleCount, simplePrefix, simpleType, naming, startAt, mixRows])

  const preview = useMemo(() => {
    if (bulkSpecs.length === 0) return 'No rooms will be created (you can add them later).'
    if (bulkSpecs.length === 1) return previewBulkUnitNames(bulkSpecs[0])
    return bulkSpecs.map(s => previewBulkUnitNames(s, 2)).join(' · ')
  }, [bulkSpecs])

  const totalRooms = useMemo(
    () => expandBulkUnitRows('x', 'y', bulkSpecs).rows.length,
    [bulkSpecs],
  )

  function openCreate() {
    setName('')
    setAddress('')
    setManagedById('')
    setNaming('prefix_number')
    setStartAt('1')
    setMode(isGuest ? 'mix' : 'simple')
    setSimpleCount(isStudent ? '100' : '10')
    setSimplePrefix('Room')
    setSimpleType(isStudent ? 'room' : 'double')
    setMixRows(defaultMix(kind))
    setError(null)
    setShowCreate(true)
  }

  async function createProperty() {
    if (!companyId || !canEdit || !name.trim()) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { data, error: e } = await supabase.from('sites').insert({
      company_id: companyId,
      name: name.trim(),
      address: address.trim() || null,
      property_kind: kind,
      managed_by_employee_id: managedById || null,
      is_active: true,
      radius_meters: 200,
    }).select('id').single()

    if (e || !data) {
      setBusy(false)
      setError(e?.message ?? 'Failed to create property')
      return
    }

    const { rows } = expandBulkUnitRows(companyId, data.id, bulkSpecs)
    if (rows.length > 0) {
      const result = await insertUnitsBulk(supabase, rows)
      if (!result.ok) {
        setBusy(false)
        setError(`Property created, but rooms failed after ${result.inserted}: ${result.message}`)
        setShowCreate(false)
        await load()
        router.push(`/dashboard/properties/${data.id}?tab=units`)
        return
      }
    }

    setBusy(false)
    setShowCreate(false)
    router.push(`/dashboard/properties/${data.id}?tab=units`)
  }

  if (error === 'not_linked') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[13px] text-text-secondary">Account not linked to an employee.</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-4 space-y-4 pb-12">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-[20px] font-semibold text-text-primary">{title}</h1>
            <p className="text-[12px] text-text-secondary mt-0.5">{description}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/properties" className="btn-outlined h-9 px-3 text-[13px] inline-flex items-center">
              All properties
            </Link>
            {canEdit && (
              <button type="button" onClick={openCreate} className="btn-primary h-9 px-3 text-[13px]">
                + {isStudent ? 'Student property' : isGuest ? 'Guest house' : 'Property'}
              </button>
            )}
          </div>
        </div>

        {error && error !== 'not_linked' && <p className="text-[13px] text-error">{error}</p>}

        {loading ? (
          <p className="text-center text-[13px] text-text-secondary py-8">Loading…</p>
        ) : sites.length === 0 ? (
          <div className="border border-divider rounded-xl p-6 space-y-3">
            <p className="text-[13px] text-text-secondary">
              No {propertyKindLabel(kind).toLowerCase()} properties yet.
            </p>
            <p className="text-[12px] text-text-disabled">
              Create from this page — the property kind is fixed to {propertyKindLabel(kind)}.
              You can generate rooms in one go (e.g. 100 rooms named Room 1…Room 100).
            </p>
            {canEdit && (
              <button type="button" onClick={openCreate} className="btn-primary h-9 px-3 text-[13px]">
                Create first property
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, address, manager…"
              className="w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
            />
            {filtered.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No properties match this search.</p>
            ) : (
              <div className="overflow-x-auto border border-divider rounded-xl">
                <table className="w-full" style={{ minWidth: 640 }}>
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className="data-th text-left">Name</th>
                      <th className="data-th text-left">Address</th>
                      <th className="data-th text-left">Managed by</th>
                      <th className="data-th text-right">Units</th>
                      <th className="data-th text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map(site => {
                      const st = unitStats[site.id] ?? { total: 0, occupied: 0 }
                      const mgr = site.managed_by
                        ? `${site.managed_by.name} ${site.managed_by.surname}`.trim()
                        : '—'
                      return (
                        <tr
                          key={site.id}
                          className="border-b border-divider hover:bg-surface-elevated cursor-pointer"
                          onClick={() => router.push(`/dashboard/properties/${site.id}`)}
                        >
                          <td className="data-td text-[13px] font-medium text-primary">{site.name}</td>
                          <td className="data-td text-[13px] text-text-secondary">{site.address ?? '—'}</td>
                          <td className="data-td text-[13px] text-text-secondary">{mgr}</td>
                          <td className="data-td text-[13px] text-right">{st.occupied}/{st.total}</td>
                          <td className="data-td text-[12px]">{site.is_active === false ? 'Inactive' : 'Active'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="px-3 pb-3">
                  <ListPagination
                    page={Math.min(page, pageCount)}
                    pageCount={pageCount}
                    total={filtered.length}
                    pageSize={PROPERTY_LIST_PAGE_SIZE}
                    onPageChange={setPage}
                    label="properties"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[92vh] overflow-y-auto">
            <h2 className="text-[16px] font-semibold text-text-primary">
              New {propertyKindLabel(kind).toLowerCase()}
            </h2>
            <p className="text-[11px] text-text-secondary">
              Kind is locked to <strong>{propertyKindLabel(kind)}</strong> — created only from this section.
            </p>

            <label className="block text-[12px] text-text-secondary">Name *
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={isStudent ? 'e.g. Riverside Student Village' : 'e.g. Oak Street Guest House'}
                className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
              />
            </label>
            <label className="block text-[12px] text-text-secondary">Address
              <input
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
              />
            </label>

            <PropertyManagerField
              companyId={companyId}
              value={managedById}
              onChange={setManagedById}
              employees={employees}
              onEmployeeCreated={emp => setEmployees(prev => {
                if (prev.some(e => e.id === emp.id)) return prev
                return [...prev, emp].sort((a, b) => a.name.localeCompare(b.name))
              })}
            />

            <div className="border-t border-divider pt-3 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[13px] font-medium text-text-primary">Rooms / units</p>
                {(isStudent || isGuest) && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setMode('simple')}
                      className={`h-8 px-2 text-[11px] rounded-md border ${mode === 'simple' ? 'border-primary text-primary bg-primary/5' : 'border-border text-text-secondary'}`}
                    >
                      Same naming
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('mix')}
                      className={`h-8 px-2 text-[11px] rounded-md border ${mode === 'mix' ? 'border-primary text-primary bg-primary/5' : 'border-border text-text-secondary'}`}
                    >
                      Room mix
                    </button>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-text-disabled">
                {isStudent
                  ? 'Got 100 rooms? Enter 100 and we create them now — rename any door later.'
                  : 'Mix family, luxury, doubles, etc. Each type gets its own names.'}
              </p>

              <label className="block text-[12px] text-text-secondary">How to name them
                <select
                  value={naming}
                  onChange={e => setNaming(e.target.value as UnitNamingScheme)}
                  className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
                >
                  {NAMING_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label} — {o.hint}</option>
                  ))}
                </select>
              </label>

              <label className="block text-[12px] text-text-secondary">Start numbering at
                <input
                  type="number"
                  min={0}
                  value={startAt}
                  onChange={e => setStartAt(e.target.value)}
                  className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
                />
              </label>

              {mode === 'simple' ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="block text-[12px] text-text-secondary sm:col-span-1">How many
                    <input
                      type="number"
                      min={0}
                      max={2000}
                      value={simpleCount}
                      onChange={e => setSimpleCount(e.target.value)}
                      className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
                    />
                  </label>
                  <label className="block text-[12px] text-text-secondary">
                    Name prefix
                    <input
                      value={simplePrefix}
                      onChange={e => setSimplePrefix(e.target.value)}
                      disabled={naming === 'door' || naming === 'number_only'}
                      placeholder="Room"
                      className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-50"
                    />
                  </label>
                  <label className="block text-[12px] text-text-secondary">Type
                    <select
                      value={simpleType}
                      onChange={e => setSimpleType(e.target.value as UnitType)}
                      className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
                    >
                      {typeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </label>
                </div>
              ) : (
                <div className="space-y-2">
                  {mixRows.map((row, idx) => (
                    <div key={row.key} className="grid grid-cols-12 gap-2 items-end">
                      <label className="col-span-4 block text-[11px] text-text-secondary">
                        Type
                        <select
                          value={row.unitType}
                          onChange={e => {
                            const v = e.target.value as UnitType
                            setMixRows(rows => rows.map((r, i) => i === idx ? {
                              ...r,
                              unitType: v,
                              namePrefix: UNIT_TYPES.find(t => t.value === v)?.label ?? r.namePrefix,
                            } : r))
                          }}
                          className="mt-1 w-full h-9 px-2 border border-border rounded-md text-[12px] bg-background"
                        >
                          {typeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </label>
                      <label className="col-span-3 block text-[11px] text-text-secondary">
                        Qty
                        <input
                          type="number"
                          min={0}
                          value={row.count}
                          onChange={e => setMixRows(rows => rows.map((r, i) => i === idx ? { ...r, count: e.target.value } : r))}
                          className="mt-1 w-full h-9 px-2 border border-border rounded-md text-[12px] bg-background"
                        />
                      </label>
                      <label className="col-span-4 block text-[11px] text-text-secondary">
                        Prefix
                        <input
                          value={row.namePrefix}
                          onChange={e => setMixRows(rows => rows.map((r, i) => i === idx ? { ...r, namePrefix: e.target.value } : r))}
                          disabled={naming === 'door' || naming === 'number_only'}
                          className="mt-1 w-full h-9 px-2 border border-border rounded-md text-[12px] bg-background disabled:opacity-50"
                        />
                      </label>
                      <button
                        type="button"
                        className="col-span-1 h-9 text-text-secondary hover:text-error text-[16px]"
                        onClick={() => setMixRows(rows => rows.filter((_, i) => i !== idx))}
                        disabled={mixRows.length <= 1}
                        aria-label="Remove row"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="text-[12px] text-primary hover:underline"
                    onClick={() => setMixRows(rows => [...rows, {
                      key: String(Date.now()),
                      unitType: isGuest ? 'single' : 'room',
                      count: '1',
                      namePrefix: isGuest ? 'Single' : 'Room',
                    }])}
                  >
                    + Add room type
                  </button>
                </div>
              )}

              <div className="rounded-lg bg-surface-elevated border border-divider px-3 py-2">
                <p className="text-[11px] text-text-secondary">Preview · {totalRooms} unit{totalRooms === 1 ? '' : 's'}</p>
                <p className="text-[12px] text-text-primary mt-0.5">{preview}</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowCreate(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
              <button
                type="button"
                disabled={busy || !name.trim()}
                onClick={() => void createProperty()}
                className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50"
              >
                {busy ? 'Creating…' : totalRooms > 0 ? `Create + ${totalRooms} rooms` : 'Create property'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
