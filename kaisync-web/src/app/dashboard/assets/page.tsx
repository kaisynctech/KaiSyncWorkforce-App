'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  ASSET_STATUSES,
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
import { KpiTile } from '@/components/ui/KpiTile'
import type { Asset, Employee, Site, Unit } from '@/types/database'

type AssetKpis = {
  total: number
  active: number
  outOfService: number
  retired: number
  warrantyExpiring: number
  unassigned: number
}

type AssetActionItem = {
  id: string
  asset_id: string
  asset_label: string
  action_type: string
  title: string
  detail: string
}

const ACTION_TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  warranty_expired:  { bg: '#FEE2E2', fg: '#991B1B' },
  warranty_expiring: { bg: '#FEF3C7', fg: '#92400E' },
  out_of_service:    { bg: '#FEF3C7', fg: '#92400E' },
  unassigned:        { bg: '#E5E7EB', fg: '#374151' },
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
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [total, setTotal] = useState(0)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [editing, setEditing] = useState<AssetDraft | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmRetire, setConfirmRetire] = useState<AssetRow | null>(null)
  const [warrantyExpiringSoon, setWarrantyExpiringSoon] = useState(0)
  const [kpis, setKpis] = useState<AssetKpis>({
    total: 0, active: 0, outOfService: 0, retired: 0, warrantyExpiring: 0, unassigned: 0,
  })
  const [actionItems, setActionItems] = useState<AssetActionItem[]>([])

  const canEdit = can(perms, PERM.assetsEdit)

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(1) }, [searchDebounced, statusFilter, pageSize])

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
          .select('id, label, status, warranty_expires, assigned_employee_id')
          .eq('company_id', member.companyId)
          .neq('status', 'retired')
          .order('label')
          .limit(400),
      ])

    setPerms(await loadPermissions(supabase, member.companyId, meRes.data?.access_level))

    const signals = (signalRes.data ?? []) as {
      id: string
      label: string | null
      status: string
      warranty_expires: string | null
      assigned_employee_id: string | null
    }[]
    const warrantySoonCount = signals.filter(a => isWarrantyExpiringSoon(a.warranty_expires)).length
    setWarrantyExpiringSoon(warrantySoonCount)

    setKpis({
      total: totalRes.count ?? 0,
      active: activeRes.count ?? 0,
      outOfService: oosRes.count ?? 0,
      retired: retiredRes.count ?? 0,
      warrantyExpiring: warrantySoonCount,
      unassigned: unassignedRes.count ?? 0,
    })

    const actions: AssetActionItem[] = []
    for (const a of signals) {
      const label = a.label?.trim() || 'Untitled asset'
      if (isWarrantyExpired(a.warranty_expires)) {
        actions.push({
          id: `${a.id}-wexp`,
          asset_id: a.id,
          asset_label: label,
          action_type: 'warranty_expired',
          title: 'Warranty expired',
          detail: 'Review service / replace coverage',
        })
      } else if (isWarrantyExpiringSoon(a.warranty_expires)) {
        actions.push({
          id: `${a.id}-wsoon`,
          asset_id: a.id,
          asset_label: label,
          action_type: 'warranty_expiring',
          title: 'Warranty expiring',
          detail: 'Expires within 30 days',
        })
      }
      if (a.status === 'out_of_service') {
        actions.push({
          id: `${a.id}-oos`,
          asset_id: a.id,
          asset_label: label,
          action_type: 'out_of_service',
          title: 'Out of service',
          detail: 'Asset unavailable for use',
        })
      }
      if (!a.assigned_employee_id && a.status === 'active') {
        actions.push({
          id: `${a.id}-un`,
          asset_id: a.id,
          asset_label: label,
          action_type: 'unassigned',
          title: 'Unassigned custody',
          detail: 'No employee assigned',
        })
      }
    }
    setActionItems(actions.slice(0, 25))

    const { from, to } = pageRange(page, pageSize)
    let query = supabase
      .from('assets')
      .select('*, sites(id, name), units(id, unit_number), assigned_employee:employees!assigned_employee_id(id, name, surname)', { count: 'exact' })
      .eq('company_id', member.companyId)
      .order('label')

    if (searchDebounced) {
      const q = escapeIlike(searchDebounced)
      query = query.or(`label.ilike.%${q}%,asset_type.ilike.%${q}%,serial_number.ilike.%${q}%,manufacturer.ilike.%${q}%`)
    }
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
      setAssets((data ?? []) as AssetRow[])
      setTotal(count ?? 0)
    }

    setSites((sitesRes.data ?? []) as Pick<Site, 'id' | 'name'>[])
    setUnits((unitsRes.data ?? []) as Pick<Unit, 'id' | 'site_id' | 'unit_number'>[])
    setEmployees((empRes.data ?? []) as Pick<Employee, 'id' | 'name' | 'surname'>[])
    if (meRes.data) {
      setActorName(`${meRes.data.name ?? ''} ${meRes.data.surname ?? ''}`.trim() || null)
    }
    setLoading(false)
  }, [page, pageSize, searchDebounced, statusFilter])

  useEffect(() => { void load() }, [load])

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
      const created = await createAsset(supabase, { companyId, ...input })
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

  const filterChips: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'out_of_service', label: 'Out of service' },
    { key: 'retired', label: 'Retired' },
    { key: 'warranty_expiring', label: `Warranty (${warrantyExpiringSoon})` },
  ]

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
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-sm bg-surface border border-border rounded-lg px-2">
          <span className="material-icons text-text-secondary text-[16px]">search</span>
          <input
            placeholder="Search assets…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-text-primary text-[13px] h-[38px] outline-none placeholder:text-text-disabled"
          />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="bg-surface-dark rounded-md h-9 w-9 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons text-[18px]">refresh</span>
          </button>
          {canEdit && (
            <button className="btn-primary h-9 px-3 text-[13px]"
              onClick={() => { setEditing(blankAsset()); setIsNew(true); setError(null) }}>
              + Asset
            </button>
          )}
        </div>
      </div>

      <div className="mx-4 mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiTile value={kpis.total} label="Total" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
        <KpiTile value={kpis.active} label="Active" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
        <KpiTile value={kpis.outOfService} label="Out of service" bg="#1E293B" valueFg="#FCD34D" labelFg="#64748B" />
        <KpiTile value={kpis.retired} label="Retired" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
        <KpiTile value={kpis.warrantyExpiring} label="Warranty 30d" bg="#1E293B" valueFg="#FCD34D" labelFg="#64748B" />
        <KpiTile value={kpis.unassigned} label="Unassigned" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
      </div>

      {actionItems.length > 0 && (
        <div className="mx-4 mt-3 card overflow-hidden">
          <div className="px-3 py-2 border-b border-divider flex items-center justify-between">
            <p className="text-[11px] font-semibold tracking-wider uppercase text-text-secondary">Action Centre</p>
            <span className="text-[11px] text-text-disabled">{actionItems.length} item{actionItems.length !== 1 ? 's' : ''}</span>
          </div>
          <ul className="divide-y divide-divider max-h-48 overflow-y-auto">
            {actionItems.map(item => {
              const colors = ACTION_TYPE_COLORS[item.action_type] ?? { bg: '#E5E7EB', fg: '#374151' }
              return (
                <li
                  key={item.id}
                  className="px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-background transition-colors"
                  onClick={() => {
                    void (async () => {
                      const row = assets.find(a => a.id === item.asset_id)
                      if (row) { setEditing(toDraft(row)); setIsNew(false); setError(null); return }
                      const supabase = createClient()
                      const { data } = await supabase
                        .from('assets')
                        .select('*, sites(id, name), units(id, unit_number), assigned_employee:employees!assigned_employee_id(id, name, surname)')
                        .eq('id', item.asset_id)
                        .maybeSingle()
                      if (data) { setEditing(toDraft(data as AssetRow)); setIsNew(false); setError(null) }
                    })()
                  }}
                >
                  <span className="text-[10px] px-2 py-0.5 rounded-lg shrink-0" style={{ backgroundColor: colors.bg, color: colors.fg }}>
                    {item.title}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-text-primary truncate">{item.asset_label}</p>
                    <p className="text-[11px] text-text-secondary truncate">{item.detail}</p>
                  </div>
                  <span className="material-icons text-[16px] text-text-disabled">chevron_right</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-divider shrink-0 mt-2">
        <div className="flex items-center gap-2 overflow-x-auto">
          {filterChips.map(chip => {
            const active = statusFilter === chip.key
            return (
              <button
                key={chip.key}
                onClick={() => setStatusFilter(chip.key)}
                className={`h-8 px-3 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-primary text-white'
                    : 'bg-surface-dark text-text-secondary hover:text-text-primary'
                }`}
              >
                {chip.label}
              </button>
            )
          })}
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
        <table className="w-full" style={{ minWidth: 1100 }}>
          <thead>
            <tr className="bg-surface-elevated border-b border-divider">
              <th className="data-th text-left" style={{ width: 180 }}>Asset</th>
              <th className="data-th text-left" style={{ width: 100 }}>Type</th>
              <th className="data-th text-left" style={{ width: 120 }}>Site</th>
              <th className="data-th text-left" style={{ width: 140 }}>Assigned</th>
              <th className="data-th text-left" style={{ width: 120 }}>Warranty</th>
              <th className="data-th text-left" style={{ width: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="data-td text-center text-text-secondary py-10">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="data-td text-center text-text-secondary py-10">No assets found.</td></tr>
            ) : filtered.map(asset => {
              const st = statusStyle(asset.status)
              const expired = isWarrantyExpired(asset.warranty_expires)
              const expiring = isWarrantyExpiringSoon(asset.warranty_expires)
              return (
                <tr
                  key={asset.id}
                  className="bg-surface-card cursor-pointer hover:bg-background transition-colors border-b border-divider last:border-0"
                  onClick={() => { setEditing(toDraft(asset)); setIsNew(false); setError(null) }}
                >
                  <td className="data-td text-sm font-medium text-text-primary">
                    {asset.label}
                    {asset.serial_number && (
                      <span className="block text-[11px] text-text-secondary font-normal">S/N {asset.serial_number}</span>
                    )}
                  </td>
                  <td className="data-td text-sm text-text-secondary">{asset.asset_type ?? '—'}</td>
                  <td className="data-td text-sm text-text-secondary">
                    {asset.sites?.name ?? '—'}
                    {asset.units?.unit_number && (
                      <span className="block text-[11px]">Unit {asset.units.unit_number}</span>
                    )}
                  </td>
                  <td className="data-td text-sm text-text-secondary">{empName(asset.assigned_employee)}</td>
                  <td className="data-td text-sm" style={{ color: expired ? '#B91C1C' : expiring ? '#D97706' : undefined }}>
                    {fmtDate(asset.warranty_expires)}
                    {expired && <span className="block text-[11px]">Expired</span>}
                    {!expired && expiring && <span className="block text-[11px]">Expiring soon</span>}
                  </td>
                  <td className="data-td">
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
                <button onClick={() => setEditing(null)} className="btn-outlined h-9 px-4 text-[13px]">
                  {canEdit ? 'Cancel' : 'Close'}
                </button>
                {canEdit && (
                  <button onClick={() => void save()} disabled={!editing.label.trim() || busy}
                    className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">
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
              <button onClick={() => setConfirmRetire(null)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
              <button onClick={() => void retireAsset(confirmRetire)} disabled={busy}
                className="h-9 px-4 text-[13px] rounded-lg bg-error text-white font-medium disabled:opacity-50">
                {busy ? '…' : 'Retire'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
