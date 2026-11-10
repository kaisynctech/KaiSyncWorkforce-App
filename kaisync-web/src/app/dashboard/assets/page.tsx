'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  ASSET_STATUSES,
  appendAssetServiceNote,
  assetStatusLabel,
  extendWarrantyDate,
  isWarrantyExpired,
  isWarrantyExpiringSoon,
  type AssetStatus,
} from '@/lib/supply-assets'
import { createAsset, retireAsset as retireAssetApi, updateAsset } from '@/lib/assets'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  escapeIlike,
  pageRange,
  totalPages,
} from '@/lib/list-pagination'
import {
  StatusFilterTabs,
  MONEY_TH,
  MONEY_TD,
  TAB_ALL,
  type StatusTabDef,
} from '@/components/ui/StatusFilterTabs'
import { TextHeaderFilter, ResetFiltersButton, statusTab } from '@/components/ui/MoneyListFilters'
import type { Asset, Employee, Site, Unit } from '@/types/database'

type AssetKpis = {
  total: number
  active: number
  outOfService: number
  retired: number
  warrantyExpiring: number
  unassigned: number
}

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
}

const statusStyle = (s: string): { bg: string; fg: string } => {
  switch ((s ?? '').toLowerCase()) {
    case 'active': return { bg: '#DCFCE7', fg: '#166534' }
    case 'out_of_service': return { bg: '#FEF3C7', fg: '#92400E' }
    case 'retired': return { bg: '#F3F4F6', fg: '#4B5563' }
    default: return { bg: '#E5E7EB', fg: '#374151' }
  }
}

type StatusFilter = 'all' | AssetStatus | 'warranty_expiring'

const STATUS_TABS: StatusTabDef[] = [
  TAB_ALL,
  statusTab('active', 'Active', ['active'], 'green'),
  statusTab('out_of_service', 'Out of service', ['out_of_service'], 'amber'),
  statusTab('retired', 'Retired', ['retired'], 'gray'),
  statusTab('warranty_expiring', 'Warranty', [], 'red'),
]

type ColFilters = { asset: string; type: string; site: string }
const EMPTY_COLS: ColFilters = { asset: '', type: '', site: '' }

type AssetDraft = {
  id?: string
  label: string
  asset_type: string
  serial_number: string
  manufacturer: string
  model_number: string
  warranty_expires: string
  status: AssetStatus
  notes: string
  site_id: string
  unit_id: string
  assigned_employee_id: string
  serviceNote: string
}

type AssetRow = Asset & {
  sites?: { id: string; name: string } | null
  units?: { id: string; unit_number?: string | null } | null
  assigned_employee?: { id: string; name: string; surname: string } | null
}

const blankAsset = (): AssetDraft => ({
  label: '',
  asset_type: '',
  serial_number: '',
  manufacturer: '',
  model_number: '',
  warranty_expires: '',
  status: 'active',
  notes: '',
  site_id: '',
  unit_id: '',
  assigned_employee_id: '',
  serviceNote: '',
})

function toDraft(asset: AssetRow): AssetDraft {
  return {
    id: asset.id,
    label: asset.label ?? '',
    asset_type: asset.asset_type ?? '',
    serial_number: asset.serial_number ?? '',
    manufacturer: asset.manufacturer ?? '',
    model_number: asset.model_number ?? '',
    warranty_expires: asset.warranty_expires ? asset.warranty_expires.slice(0, 10) : '',
    status: (ASSET_STATUSES.includes(asset.status as AssetStatus) ? asset.status : 'active') as AssetStatus,
    notes: asset.notes ?? '',
    site_id: asset.site_id ?? '',
    unit_id: asset.unit_id ?? '',
    assigned_employee_id: asset.assigned_employee_id ?? '',
    serviceNote: '',
  }
}

function empName(e: { name: string; surname: string } | null | undefined): string {
  if (!e) return '—'
  return `${e.name ?? ''} ${e.surname ?? ''}`.trim() || '—'
}

export default function AssetsPage() {
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <AssetsInner />
    </Suspense>
  )
}

function AssetsInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editParam = searchParams.get('edit')
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [sites, setSites] = useState<Pick<Site, 'id' | 'name'>[]>([])
  const [units, setUnits] = useState<Pick<Unit, 'id' | 'site_id' | 'unit_number'>[]>([])
  const [employees, setEmployees] = useState<Pick<Employee, 'id' | 'name' | 'surname'>[]>([])
  const [actorName, setActorName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [cols, setCols] = useState<ColFilters>(EMPTY_COLS)
  const [colsDebounced, setColsDebounced] = useState<ColFilters>(EMPTY_COLS)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [total, setTotal] = useState(0)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [editing, setEditing] = useState<AssetDraft | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmRetire, setConfirmRetire] = useState<AssetRow | null>(null)
  const [kpis, setKpis] = useState<AssetKpis>({
    total: 0, active: 0, outOfService: 0, retired: 0, warrantyExpiring: 0, unassigned: 0,
  })

  const canEdit = can(perms, PERM.assetsEdit)

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    const t = setTimeout(() => setColsDebounced({
      asset: cols.asset.trim(),
      type: cols.type.trim(),
      site: cols.site.trim(),
    }), 300)
    return () => clearTimeout(t)
  }, [cols])

  useEffect(() => { setPage(1) }, [searchDebounced, colsDebounced, statusFilter, pageSize])

  const filtered = assets

  const unitsForSite = useMemo(() => {
    if (!editing?.site_id) return []
    return units.filter(u => u.site_id === editing.site_id)
  }, [units, editing?.site_id])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)

    const today = new Date()
    const todayIso = today.toISOString().slice(0, 10)
    const soon = new Date(today)
    soon.setDate(soon.getDate() + 30)
    const soonIso = soon.toISOString().slice(0, 10)

    const assetScope = () =>
      supabase.from('assets').select('id', { count: 'exact', head: true }).eq('company_id', member.companyId)

    const [sitesRes, unitsRes, empRes, meRes, totalRes, activeRes, oosRes, retiredRes, unassignedRes, signalRes] =
      await Promise.all([
        supabase.from('sites').select('id, name').eq('company_id', member.companyId).order('name'),
        supabase.from('units').select('id, site_id, unit_number').eq('company_id', member.companyId).order('unit_number'),
        supabase.from('employees').select('id, name, surname').eq('company_id', member.companyId).eq('is_active', true).order('name'),
        supabase.from('employees').select('name, surname, access_level').eq('id', member.employeeId).maybeSingle(),
        assetScope(),
        assetScope().eq('status', 'active'),
        assetScope().eq('status', 'out_of_service'),
        assetScope().eq('status', 'retired'),
        assetScope().is('assigned_employee_id', null).neq('status', 'retired'),
        supabase
          .from('assets')
          .select('warranty_expires')
          .eq('company_id', member.companyId)
          .neq('status', 'retired')
          .order('label')
          .limit(400),
      ])

    setPerms(await loadPermissions(supabase, member.companyId, meRes.data?.access_level))

    const signals = (signalRes.data ?? []) as { warranty_expires: string | null }[]
    const warrantySoonCount = signals.filter(a => isWarrantyExpiringSoon(a.warranty_expires)).length

    setKpis({
      total: totalRes.count ?? 0,
      active: activeRes.count ?? 0,
      outOfService: oosRes.count ?? 0,
      retired: retiredRes.count ?? 0,
      warrantyExpiring: warrantySoonCount,
      unassigned: unassignedRes.count ?? 0,
    })

    const { from, to } = pageRange(page, pageSize)
    // Site column filter needs an inner join on the embedded site so the filter
    // applies server-side; without it the original left-join select is kept.
    const selectCols = colsDebounced.site
      ? '*, sites!inner(id, name), units(id, unit_number), assigned_employee:employees!assigned_employee_id(id, name, surname)'
      : '*, sites(id, name), units(id, unit_number), assigned_employee:employees!assigned_employee_id(id, name, surname)'

    let query = supabase
      .from('assets')
      .select(selectCols, { count: 'exact' })
      .eq('company_id', member.companyId)
      .order('label')

    if (searchDebounced) {
      const q = escapeIlike(searchDebounced)
      query = query.or(`label.ilike.%${q}%,asset_type.ilike.%${q}%,serial_number.ilike.%${q}%,manufacturer.ilike.%${q}%`)
    }
    if (colsDebounced.asset) query = query.ilike('label', `%${escapeIlike(colsDebounced.asset)}%`)
    if (colsDebounced.type) query = query.ilike('asset_type', `%${escapeIlike(colsDebounced.type)}%`)
    if (colsDebounced.site) query = query.ilike('sites.name', `%${escapeIlike(colsDebounced.site)}%`)
    if (statusFilter !== 'all' && statusFilter !== 'warranty_expiring') {
      query = query.eq('status', statusFilter)
    }
    if (statusFilter === 'warranty_expiring') {
      query = query
        .neq('status', 'retired')
        .gte('warranty_expires', todayIso)
        .lte('warranty_expires', soonIso)
    }

    const { data, error: qErr, count } = await query.range(from, to)
    if (qErr) {
      setError(qErr.message)
      setAssets([])
      setTotal(0)
    } else {
      setAssets((data ?? []) as unknown as AssetRow[])
      setTotal(count ?? 0)
    }

    setSites((sitesRes.data ?? []) as Pick<Site, 'id' | 'name'>[])
    setUnits((unitsRes.data ?? []) as Pick<Unit, 'id' | 'site_id' | 'unit_number'>[])
    setEmployees((empRes.data ?? []) as Pick<Employee, 'id' | 'name' | 'surname'>[])
    if (meRes.data) {
      setActorName(`${meRes.data.name ?? ''} ${meRes.data.surname ?? ''}`.trim() || null)
    }
    setLoading(false)
  }, [page, pageSize, searchDebounced, colsDebounced, statusFilter])

  useEffect(() => { void load() }, [load])

  // Deep link from the Operations Action Centre: /dashboard/assets?edit=<assetId> opens the
  // same editor as clicking a row, then clears the param so a refresh does not re-open it.
  useEffect(() => {
    if (!editParam || !companyId) return
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error: qErr } = await supabase
        .from('assets')
        .select('*, sites(id, name), units(id, unit_number), assigned_employee:employees!assigned_employee_id(id, name, surname)')
        .eq('id', editParam)
        .eq('company_id', companyId)
        .maybeSingle()
      if (cancelled) return
      router.replace('/dashboard/assets')
      if (qErr) { setError(qErr.message); return }
      if (!data) { setError('Asset not found.'); return }
      setEditing(toDraft(data as unknown as AssetRow))
      setIsNew(false)
      setError(null)
    })()
    return () => { cancelled = true }
  }, [editParam, companyId, router])

  async function save() {
    if (!canEdit) { setError('You do not have permission to edit assets.'); return }
    if (!editing?.label?.trim()) { setError('Asset label is required.'); return }
    if (!companyId) { setError('Company context missing.'); return }
    setBusy(true)
    setError(null)
    const supabase = createClient()

    const input = {
      label: editing.label,
      assetType: editing.asset_type,
      serialNumber: editing.serial_number,
      manufacturer: editing.manufacturer,
      modelNumber: editing.model_number,
      warrantyExpires: editing.warranty_expires || null,
      status: editing.status,
      notes: editing.notes,
      siteId: editing.site_id || null,
      unitId: editing.unit_id || null,
      assignedEmployeeId: editing.assigned_employee_id || null,
    }

    if (isNew) {
      const created = await createAsset(supabase, {
        companyId,
        ...input,
        notes: editing.serviceNote.trim()
          ? appendAssetServiceNote(editing.notes, editing.serviceNote, actorName)
          : editing.notes,
      })
      if (!created.ok) { setError(created.message); setBusy(false); return }
      setEditing(null)
      setBusy(false)
      await load()
      return
    }

    if (editing.id) {
      const updated = await updateAsset(supabase, {
        companyId,
        assetId: editing.id,
        input,
        serviceNote: editing.serviceNote,
        actorName,
        previousNotes: editing.notes,
      })
      if (!updated.ok) { setError(updated.message); setBusy(false); return }
      setEditing(null)
      setBusy(false)
      await load()
      return
    }
    setBusy(false)
  }

  async function retireAsset(asset: AssetRow) {
    if (!canEdit || !companyId) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const result = await retireAssetApi(supabase, { companyId, assetId: asset.id })
    if (!result.ok) {
      setError(result.message)
      setBusy(false)
      return
    }
    setConfirmRetire(null)
    setEditing(null)
    setBusy(false)
    await load()
  }

  const hasFilters = !!cols.asset || !!cols.type || !!cols.site || !!search || statusFilter !== 'all'
  const patchCols = (patch: Partial<ColFilters>) => setCols(prev => ({ ...prev, ...patch }))

  if (error === 'not_linked') return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
        <p className="text-[13px] text-text-secondary">
          Your account is not linked to an active employee record.<br/>
          Please contact your administrator.
        </p>
      </div>
    </div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-divider shrink-0 bg-surface gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-sm bg-surface border border-border rounded-md px-2">
          <span className="material-icons text-text-secondary text-[16px]">search</span>
          <input
            placeholder="Search assets…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-text-primary text-[12px] h-8 outline-none placeholder:text-text-disabled"
          />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} className="btn-back" aria-label="Refresh">
            <span className="material-icons">refresh</span>
          </button>
          {canEdit && (
            <button type="button" className="btn-primary"
              onClick={() => { setEditing(blankAsset()); setIsNew(true); setError(null) }}>
              + Asset
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-divider shrink-0 mt-2">
        <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
          <ResetFiltersButton
            disabled={!hasFilters}
            onReset={() => {
              setCols(EMPTY_COLS)
              setSearch('')
              setStatusFilter('all')
            }}
          />
          <StatusFilterTabs
            tabs={STATUS_TABS}
            value={statusFilter}
            counts={{
              all: kpis.total,
              active: kpis.active,
              out_of_service: kpis.outOfService,
              retired: kpis.retired,
              warranty_expiring: kpis.warrantyExpiring,
            }}
            onChange={id => setStatusFilter(id as StatusFilter)}
          />
        </div>
        <div className="flex items-center gap-2 shrink-0 text-[12px] text-text-secondary">
          <span>{total === 0 ? '0' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</span>
          <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="dark-entry h-8 text-[12px] py-0">
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {error && error !== 'not_linked' && (
        <p className="mx-4 mt-2 text-[12px] text-error">{error}</p>
      )}

      <div className="flex-1 overflow-auto mt-2">
        <table className="w-full" style={{ minWidth: 760 }}>
          <thead>
            <tr className="bg-surface-elevated border-b border-divider">
              <th className={`${MONEY_TH} text-left`} style={{ width: 180 }}>
                <TextHeaderFilter label="Asset" value={cols.asset} onChange={v => patchCols({ asset: v })} placeholder="Asset name…" />
              </th>
              <th className={`${MONEY_TH} text-left`} style={{ width: 100 }}>
                <TextHeaderFilter label="Type" value={cols.type} onChange={v => patchCols({ type: v })} placeholder="Asset type…" />
              </th>
              <th className={`${MONEY_TH} text-left`} style={{ width: 120 }}>
                <TextHeaderFilter label="Site" value={cols.site} onChange={v => patchCols({ site: v })} placeholder="Site name…" />
              </th>
              <th className={`${MONEY_TH} text-left`} style={{ width: 140 }}>Assigned</th>
              <th className={`${MONEY_TH} text-left`} style={{ width: 120 }}>Warranty</th>
              <th className={`${MONEY_TH} text-left`} style={{ width: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className={`${MONEY_TD} text-center text-text-secondary py-10`}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className={`${MONEY_TD} text-center text-text-secondary py-10`}>No assets found.</td></tr>
            ) : filtered.map(asset => {
              const st = statusStyle(asset.status)
              const expired = asset.status !== 'retired' && isWarrantyExpired(asset.warranty_expires)
              const expiring = asset.status !== 'retired' && isWarrantyExpiringSoon(asset.warranty_expires)
              return (
                <tr
                  key={asset.id}
                  className="bg-surface-card cursor-pointer hover:bg-background transition-colors border-b border-divider last:border-0"
                  onClick={() => { setEditing(toDraft(asset)); setIsNew(false); setError(null) }}
                >
                  <td className={`${MONEY_TD} font-medium text-text-primary`}>
                    {asset.label}
                    {asset.serial_number && (
                      <span className="block text-[11px] text-text-secondary font-normal">S/N {asset.serial_number}</span>
                    )}
                  </td>
                  <td className={`${MONEY_TD} text-text-secondary`}>{asset.asset_type ?? '—'}</td>
                  <td className={`${MONEY_TD} text-text-secondary`}>
                    {asset.sites?.name ?? '—'}
                    {asset.units?.unit_number && (
                      <span className="block text-[11px]">Unit {asset.units.unit_number}</span>
                    )}
                  </td>
                  <td className={`${MONEY_TD} text-text-secondary`}>{empName(asset.assigned_employee)}</td>
                  <td className={MONEY_TD} style={{ color: expired ? '#B91C1C' : expiring ? '#D97706' : undefined }}>
                    {fmtDate(asset.warranty_expires)}
                    {expired && <span className="block text-[11px]">Expired</span>}
                    {!expired && expiring && <span className="block text-[11px]">Expiring soon</span>}
                  </td>
                  <td className={MONEY_TD}>
                    <span className="text-xs px-2 py-0.5 rounded-lg" style={{ backgroundColor: st.bg, color: st.fg }}>
                      {assetStatusLabel(asset.status)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-text-primary">{isNew ? 'New Asset' : (canEdit ? 'Edit Asset' : 'Asset')}</h3>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Label *</label>
              <input value={editing.label} onChange={e => setEditing(prev => prev ? { ...prev, label: e.target.value } : prev)} className="dark-entry w-full" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">Asset type *</label>
                <input
                  value={editing.asset_type}
                  onChange={e => setEditing(prev => prev ? { ...prev, asset_type: e.target.value } : prev)}
                  placeholder="General"
                  disabled={!canEdit}
                  className="dark-entry w-full disabled:opacity-60"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">Serial</label>
                <input value={editing.serial_number} onChange={e => setEditing(prev => prev ? { ...prev, serial_number: e.target.value } : prev)} className="dark-entry w-full" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">Manufacturer</label>
                <input value={editing.manufacturer} onChange={e => setEditing(prev => prev ? { ...prev, manufacturer: e.target.value } : prev)} className="dark-entry w-full" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">Model</label>
                <input value={editing.model_number} onChange={e => setEditing(prev => prev ? { ...prev, model_number: e.target.value } : prev)} className="dark-entry w-full" />
              </div>
            </div>

            <p className="section-label pt-1">ASSIGNMENT</p>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Site</label>
              <select
                value={editing.site_id}
                onChange={e => setEditing(prev => prev ? { ...prev, site_id: e.target.value, unit_id: '' } : prev)}
                className="dark-entry w-full appearance-none"
              >
                <option value="">Unassigned</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Unit</label>
              <select
                value={editing.unit_id}
                onChange={e => setEditing(prev => prev ? { ...prev, unit_id: e.target.value } : prev)}
                disabled={!editing.site_id}
                className="dark-entry w-full appearance-none disabled:opacity-50"
              >
                <option value="">None</option>
                {unitsForSite.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Assigned employee</label>
              <select
                value={editing.assigned_employee_id}
                onChange={e => setEditing(prev => prev ? { ...prev, assigned_employee_id: e.target.value } : prev)}
                className="dark-entry w-full appearance-none"
              >
                <option value="">Unassigned</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.name} {e.surname}</option>
                ))}
              </select>
            </div>

            <p className="section-label pt-1">WARRANTY & STATUS</p>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Warranty expires</label>
              <input type="date" value={editing.warranty_expires} onChange={e => setEditing(prev => prev ? { ...prev, warranty_expires: e.target.value } : prev)} className="dark-entry w-full" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-outlined h-8 px-2 text-[11px]"
                onClick={() => setEditing(prev => prev ? { ...prev, warranty_expires: extendWarrantyDate(prev.warranty_expires, 30) } : prev)}>
                +30 days
              </button>
              <button type="button" className="btn-outlined h-8 px-2 text-[11px]"
                onClick={() => setEditing(prev => prev ? { ...prev, warranty_expires: extendWarrantyDate(prev.warranty_expires, 90) } : prev)}>
                +90 days
              </button>
              <button type="button" className="btn-outlined h-8 px-2 text-[11px]"
                onClick={() => setEditing(prev => prev ? { ...prev, warranty_expires: extendWarrantyDate(prev.warranty_expires, 365) } : prev)}>
                +1 year
              </button>
              <button type="button" className="btn-outlined h-8 px-2 text-[11px]"
                onClick={() => setEditing(prev => prev ? { ...prev, warranty_expires: '' } : prev)}>
                Clear
              </button>
              {isWarrantyExpired(editing.warranty_expires) && editing.status === 'active' && (
                <button type="button" className="h-8 px-2 text-[11px] rounded-lg border border-[#F59E0B] text-[#92400E]"
                  onClick={() => setEditing(prev => prev ? { ...prev, status: 'out_of_service' } : prev)}>
                  Mark out of service
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Status</label>
              <select
                value={editing.status}
                onChange={e => setEditing(prev => prev ? { ...prev, status: e.target.value as AssetStatus } : prev)}
                className="dark-entry w-full appearance-none"
              >
                {ASSET_STATUSES.map(s => (
                  <option key={s} value={s}>{assetStatusLabel(s)}</option>
                ))}
              </select>
            </div>

            <p className="section-label pt-1">SERVICE NOTES</p>
            {editing.notes && (
              <pre className="text-[11px] text-text-secondary whitespace-pre-wrap bg-surface-dark rounded-lg p-2 max-h-28 overflow-y-auto font-sans">
                {editing.notes}
              </pre>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Add service note</label>
              <textarea
                value={editing.serviceNote}
                onChange={e => setEditing(prev => prev ? { ...prev, serviceNote: e.target.value } : prev)}
                rows={2}
                placeholder="e.g. Replaced filter, inspected motor…"
                className="dark-entry w-full min-h-[56px] py-2 resize-none"
              />
            </div>

            <div className="flex gap-2 justify-between pt-1">
              {canEdit && !isNew && editing.status !== 'retired' && (
                <button
                  onClick={() => {
                    const asset = assets.find(a => a.id === editing.id)
                    if (asset) { setConfirmRetire(asset); setEditing(null) }
                  }}
                  className="text-[12px] text-error hover:opacity-70 transition-opacity"
                >
                  Retire
                </button>
              )}
              <div className="flex gap-2 ml-auto">
                <button type="button" onClick={() => setEditing(null)} className="btn-outlined">
                  {canEdit ? 'Cancel' : 'Close'}
                </button>
                {canEdit && (
                  <button onClick={() => void save()} disabled={!editing.label.trim() || busy}
                    className="btn-primary">
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-2 border-t border-divider shrink-0">
        <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40">Previous</button>
        <span className="text-[12px] text-text-secondary">Page {page} of {totalPages(total, pageSize)}</span>
        <button disabled={page >= totalPages(total, pageSize)} onClick={() => setPage(p => p + 1)} className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40">Next</button>
      </div>

      {confirmRetire && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-xs p-5 space-y-3">
            <p className="font-semibold text-text-primary">Retire Asset?</p>
            <p className="text-sm text-text-secondary">
              &ldquo;{confirmRetire.label}&rdquo; will be marked retired. It stays in history and is not hard-deleted.
            </p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setConfirmRetire(null)} className="btn-outlined">Cancel</button>
              <button type="button" onClick={() => void retireAsset(confirmRetire)} disabled={busy}
                className="btn-danger">
                {busy ? '…' : 'Retire'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
