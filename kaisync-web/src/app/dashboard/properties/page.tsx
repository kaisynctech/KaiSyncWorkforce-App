'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { KpiTile } from '@/components/ui/KpiTile'
import type { PropertyKind, Site } from '@/types/database'

type ClientOption = { id: string; name: string }

type SiteRow = Site & {
  units?: { count: number }[] | { count: number } | null
  unit_count?: number
  occupied_count?: number
}

export default function PropertiesPage() {
  const router = useRouter()
  const [sites, setSites] = useState<SiteRow[]>([])
  const [unitStats, setUnitStats] = useState<Record<string, { total: number; occupied: number }>>({})
  const [clients, setClients] = useState<ClientOption[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({
    name: '',
    address: '',
    radius_meters: '200',
    latitude: '',
    longitude: '',
    client_id: '',
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

    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

    const [sRes, uRes, cRes] = await Promise.all([
      supabase
        .from('sites')
        .select('*, clients(id, name)')
        .eq('company_id', member.companyId)
        .order('name'),
      supabase
        .from('units')
        .select('id, site_id, is_occupied')
        .eq('company_id', member.companyId),
      supabase
        .from('clients')
        .select('id, name')
        .eq('company_id', member.companyId)
        .order('name')
        .limit(500),
    ])

    if (sRes.error) setError(sRes.error.message)
    setSites((sRes.data ?? []) as SiteRow[])

    const stats: Record<string, { total: number; occupied: number }> = {}
    for (const u of uRes.data ?? []) {
      const sid = (u as { site_id: string }).site_id
      if (!stats[sid]) stats[sid] = { total: 0, occupied: 0 }
      stats[sid].total += 1
      if ((u as { is_occupied?: boolean }).is_occupied) stats[sid].occupied += 1
    }
    setUnitStats(stats)
    setClients((cRes.data ?? []) as ClientOption[])
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
      client_id: form.client_id || null,
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
    setForm({ name: '', address: '', radius_meters: '200', latitude: '', longitude: '', client_id: '', property_kind: 'residential', notes: '' })
    router.push(`/dashboard/properties/${data.id}`)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sites
    return sites.filter(s =>
      s.name.toLowerCase().includes(q)
      || (s.address ?? '').toLowerCase().includes(q)
      || (s.clients?.name ?? '').toLowerCase().includes(q),
    )
  }, [sites, search])

  const kpis = useMemo(() => {
    const active = sites.filter(s => s.is_active !== false).length
    const inactive = sites.length - active
    let units = 0
    let vacant = 0
    for (const sid of Object.keys(unitStats)) {
      units += unitStats[sid].total
      vacant += Math.max(0, unitStats[sid].total - unitStats[sid].occupied)
    }
    return { active, inactive, units, vacant }
  }, [sites, unitStats])

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
          {canEdit && (
            <button type="button" onClick={() => setShowCreate(true)} className="btn-primary h-9 px-3 text-[13px]">
              + Property
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiTile value={kpis.active} label="Active" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
          <KpiTile value={kpis.inactive} label="Inactive" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
          <KpiTile value={kpis.units} label="Units" bg="#1E293B" valueFg="#FCD34D" labelFg="#64748B" />
          <KpiTile value={kpis.vacant} label="Vacant units" bg="#3F1D1D" valueFg="#F87171" labelFg="#FCA5A5" />
        </div>

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, address, client…"
          className="w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
        />

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
                  <th className="data-th text-left">Owner</th>
                  <th className="data-th text-right">Units</th>
                  <th className="data-th text-left">GPS</th>
                  <th className="data-th text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(site => {
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
                      <td className="data-td text-[12px] capitalize text-text-secondary">{site.property_kind ?? 'residential'}</td>
                      <td className="data-td text-[13px] text-text-secondary">{site.clients?.name ?? '—'}</td>
                      <td className="data-td text-[13px] text-right">{st.occupied}/{st.total}</td>
                      <td className="data-td text-[12px]">{hasGps ? 'Yes' : '—'}</td>
                      <td className="data-td text-[12px]">{site.is_active === false ? 'Inactive' : 'Active'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
                <option value="residential">residential</option>
                <option value="commercial">commercial</option>
                <option value="mixed">mixed</option>
                <option value="other">other</option>
              </select>
            </label>
            <label className="block text-[12px] text-text-secondary">Owner / principal client
              <select value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                <option value="">— None —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
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
    </div>
  )
}
