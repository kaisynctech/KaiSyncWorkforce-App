'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { KpiTile } from '@/components/ui/KpiTile'
import { PropertyManagerField, type ManagerOption } from '@/components/properties/PropertyManagerField'
import { ListPagination } from '@/components/properties/ListPagination'
import { GenerateRentInvoicesModal } from '@/components/properties/GenerateRentInvoicesModal'
import { PROPERTY_KINDS, propertyKindLabel } from '@/lib/properties'
import { paginateSlice, PROPERTY_LIST_PAGE_SIZE, totalPages } from '@/lib/property-list'
import type { PropertyKind, Site } from '@/types/database'

type SiteRow = Site & {
  units?: { count: number }[] | { count: number } | null
  unit_count?: number
  occupied_count?: number
}

const KIND_FILTERS: Array<PropertyKind | 'all'> = [
  'all',
  'residential',
  'commercial',
  'mixed',
  'student_accommodation',
  'guest_house',
  'other',
]

export default function PropertiesPage() {
  const router = useRouter()
  const [sites, setSites] = useState<SiteRow[]>([])
  const [unitStats, setUnitStats] = useState<Record<string, { total: number; occupied: number }>>({})
  const [activeLeaseCount, setActiveLeaseCount] = useState(0)
  const [arrearsCount, setArrearsCount] = useState(0)
  const [employees, setEmployees] = useState<ManagerOption[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showGenerateRent, setShowGenerateRent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<PropertyKind | 'all'>('all')
  const [page, setPage] = useState(1)
  const [form, setForm] = useState({
    name: '',
    address: '',
    radius_meters: '200',
    latitude: '',
    longitude: '',
    managed_by_employee_id: '',
    property_kind: 'residential' as PropertyKind,
    notes: '',
  })

  const canEdit = can(perms, PERM.propertiesEdit)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

    const today = new Date().toISOString().slice(0, 10)
    const [sRes, statsRes, eRes, lRes, invRes] = await Promise.all([
      supabase
        .from('sites')
        .select('*, clients(id, name), managed_by:employees!sites_managed_by_employee_id_fkey(id, name, surname)')
        .eq('company_id', member.companyId)
        .order('name'),
      supabase.rpc('hr_site_unit_counts', { p_company_id: member.companyId }),
      supabase
        .from('employees')
        .select('id, name, surname')
        .eq('company_id', member.companyId)
        .eq('is_active', true)
        .order('name')
        .limit(1000),
      supabase
        .from('property_leases')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', member.companyId)
        .eq('status', 'active'),
      supabase
        .from('finance_invoices')
        .select('id, balance_due, status, due_date, invoice_type')
        .eq('company_id', member.companyId)
        .eq('invoice_type', 'rent')
        .gt('balance_due', 0)
        .not('status', 'in', '("draft","cancelled","voided","paid")')
        .limit(5000),
    ])

    if (sRes.error) setError(sRes.error.message)
    setSites((sRes.data ?? []) as SiteRow[])

    const stats: Record<string, { total: number; occupied: number }> = {}
    for (const row of (statsRes.data ?? []) as { site_id: string; total: number; occupied: number }[]) {
      stats[row.site_id] = { total: Number(row.total) || 0, occupied: Number(row.occupied) || 0 }
    }
    if (statsRes.error) {
      // Fallback: non-fatal — KPIs may show 0 units until RPC is available
      console.error('hr_site_unit_counts', statsRes.error.message)
    }
    setUnitStats(stats)
    setEmployees((eRes.data ?? []) as ManagerOption[])
    setActiveLeaseCount(lRes.count ?? 0)
    setArrearsCount((invRes.data ?? []).filter(inv => {
      const row = inv as { status: string; due_date: string | null }
      return row.status === 'overdue' || (row.due_date != null && row.due_date < today)
    }).length)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function createSite() {
    if (!companyId || !canEdit || !form.name.trim()) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const lat = form.latitude ? parseFloat(form.latitude) : null
    const lng = form.longitude ? parseFloat(form.longitude) : null
    const { data, error: e } = await supabase.from('sites').insert({
      company_id: companyId,
      name: form.name.trim(),
      address: form.address.trim() || null,
      radius_meters: parseFloat(form.radius_meters) || 200,
      latitude: Number.isFinite(lat as number) ? lat : null,
      longitude: Number.isFinite(lng as number) ? lng : null,
      managed_by_employee_id: form.managed_by_employee_id || null,
      property_kind: form.property_kind,
      notes: form.notes.trim() || null,
      is_active: true,
    }).select('id').single()
    setBusy(false)
    if (e || !data) {
      setError(e?.message ?? 'Failed to create property')
      return
    }
    setShowCreate(false)
    setForm({ name: '', address: '', radius_meters: '200', latitude: '', longitude: '', managed_by_employee_id: '', property_kind: 'residential', notes: '' })
    router.push(`/dashboard/properties/${data.id}`)
  }

  function managerLabel(site: SiteRow): string {
    if (site.managed_by) return `${site.managed_by.name} ${site.managed_by.surname}`.trim()
    return '—'
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sites.filter(s => {
      if (kindFilter !== 'all' && (s.property_kind ?? 'residential') !== kindFilter) return false
      if (!q) return true
      const mgr = s.managed_by ? `${s.managed_by.name} ${s.managed_by.surname}` : ''
      return s.name.toLowerCase().includes(q)
        || (s.address ?? '').toLowerCase().includes(q)
        || mgr.toLowerCase().includes(q)
        || (s.clients?.name ?? '').toLowerCase().includes(q)
        || (s.property_kind ?? '').toLowerCase().includes(q)
    })
  }, [sites, search, kindFilter])

  useEffect(() => { setPage(1) }, [search, kindFilter])

  const pageCount = totalPages(filtered.length, PROPERTY_LIST_PAGE_SIZE)
  const paged = useMemo(
    () => paginateSlice(filtered, Math.min(page, pageCount), PROPERTY_LIST_PAGE_SIZE),
    [filtered, page, pageCount],
  )

  const kpis = useMemo(() => {
    const active = sites.filter(s => s.is_active !== false).length
    const inactive = sites.length - active
    let units = 0
    let vacant = 0
    for (const sid of Object.keys(unitStats)) {
      units += unitStats[sid].total
      vacant += Math.max(0, unitStats[sid].total - unitStats[sid].occupied)
    }
    return { active, inactive, units, vacant, activeLeaseCount, arrearsCount }
  }, [sites, unitStats, activeLeaseCount, arrearsCount])

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
            <h1 className="text-[20px] font-semibold text-text-primary">Properties</h1>
            <p className="text-[12px] text-text-secondary mt-0.5">
              {kpis.active} active · billable (20 included, then R49/property)
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Link href="/dashboard/properties/import" className="btn-outlined h-9 px-3 text-[13px] inline-flex items-center">
                Import
              </Link>
            )}
            <Link href="/dashboard/properties/arrears" className="btn-outlined h-9 px-3 text-[13px] inline-flex items-center">
              Rent arrears
            </Link>
            {canEdit && (
              <button
                type="button"
                onClick={() => setShowGenerateRent(true)}
                className="btn-outlined h-9 px-3 text-[13px]"
              >
                Generate rent
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={() => setShowCreate(true)} className="btn-primary h-9 px-3 text-[13px]">
                + Property
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiTile value={kpis.active} label="Active" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
          <KpiTile value={kpis.inactive} label="Inactive" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
          <KpiTile value={kpis.units} label="Units" bg="#1E293B" valueFg="#FCD34D" labelFg="#64748B" />
          <KpiTile value={kpis.vacant} label="Vacant units" bg="#3F1D1D" valueFg="#F87171" labelFg="#FCA5A5" />
          <KpiTile value={kpis.activeLeaseCount} label="Active leases" bg="#1E293B" valueFg="#60A5FA" labelFg="#64748B" />
          <button type="button" onClick={() => router.push('/dashboard/properties/arrears')} className="text-left">
            <KpiTile value={kpis.arrearsCount} label="Rent arrears" bg="#3F1D1D" valueFg="#F87171" labelFg="#FCA5A5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, address, manager…"
            className="flex-1 min-w-[200px] h-10 px-3 border border-border rounded-md text-[13px] bg-background"
          />
          <select
            value={kindFilter}
            onChange={e => setKindFilter(e.target.value as PropertyKind | 'all')}
            className="h-10 px-3 border border-border rounded-md text-[13px] bg-background"
          >
            {KIND_FILTERS.map(k => (
              <option key={k} value={k}>{k === 'all' ? 'All kinds' : propertyKindLabel(k)}</option>
            ))}
          </select>
        </div>

        {error && error !== 'not_linked' && <p className="text-[13px] text-error">{error}</p>}

        {loading ? (
          <p className="text-center text-[13px] text-text-secondary py-8">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-[13px] text-text-secondary py-8">No properties found.</p>
        ) : (
          <div className="overflow-x-auto border border-divider rounded-xl">
            <table className="w-full" style={{ minWidth: 720 }}>
              <thead>
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className="data-th text-left">Name</th>
                  <th className="data-th text-left">Address</th>
                  <th className="data-th text-left">Kind</th>
                  <th className="data-th text-left">Managed by</th>
                  <th className="data-th text-right">Units</th>
                  <th className="data-th text-left">GPS</th>
                  <th className="data-th text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(site => {
                  const st = unitStats[site.id] ?? { total: 0, occupied: 0 }
                  const hasGps = site.latitude != null && site.longitude != null
                  return (
                    <tr
                      key={site.id}
                      className="border-b border-divider hover:bg-surface-elevated cursor-pointer"
                      onClick={() => router.push(`/dashboard/properties/${site.id}`)}
                    >
                      <td className="data-td text-[13px] font-medium text-primary">{site.name}</td>
                      <td className="data-td text-[13px] text-text-secondary truncate max-w-[200px]">{site.address ?? '—'}</td>
                      <td className="data-td text-[12px] text-text-secondary">{propertyKindLabel(site.property_kind)}</td>
                      <td className="data-td text-[13px] text-text-secondary">{managerLabel(site)}</td>
                      <td className="data-td text-[13px] text-right">{st.occupied}/{st.total}</td>
                      <td className="data-td text-[12px]">{hasGps ? 'Yes' : '—'}</td>
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

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h2 className="text-[16px] font-semibold text-text-primary">New property</h2>
            <label className="block text-[12px] text-text-secondary">Name *
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Address
              <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Property kind
              <select value={form.property_kind} onChange={e => setForm(f => ({ ...f, property_kind: e.target.value as PropertyKind }))} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                {PROPERTY_KINDS.filter(k => k.value !== 'student_accommodation' && k.value !== 'guest_house').map(k => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </label>
            <p className="text-[11px] text-text-disabled -mt-1">
              Student accommodation and B&B / Guest house are created from their sidebar pages (with bulk rooms).
            </p>
            <PropertyManagerField
              companyId={companyId}
              value={form.managed_by_employee_id}
              onChange={id => setForm(f => ({ ...f, managed_by_employee_id: id }))}
              employees={employees}
              onEmployeeCreated={emp => setEmployees(prev => {
                if (prev.some(e => e.id === emp.id)) return prev
                return [...prev, emp].sort((a, b) => a.name.localeCompare(b.name))
              })}
            />
            <label className="block text-[12px] text-text-secondary">Geofence radius (m)
              <input type="number" value={form.radius_meters} onChange={e => setForm(f => ({ ...f, radius_meters: e.target.value }))} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[12px] text-text-secondary">Latitude
                <input value={form.latitude} onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
              </label>
              <label className="block text-[12px] text-text-secondary">Longitude
                <input value={form.longitude} onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
              </label>
            </div>
            <label className="block text-[12px] text-text-secondary">Notes
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1 w-full px-3 py-2 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
              <button type="button" disabled={busy || !form.name.trim()} onClick={() => void createSite()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">
                {busy ? 'Saving…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showGenerateRent && companyId && employeeId && (
        <GenerateRentInvoicesModal
          companyId={companyId}
          employeeId={employeeId}
          onClose={() => setShowGenerateRent(false)}
          onDone={() => { void load() }}
        />
      )}
    </div>
  )
}
