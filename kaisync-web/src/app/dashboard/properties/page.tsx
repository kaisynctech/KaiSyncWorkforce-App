'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { Site } from '@/types/database'

export default function PropertiesPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [expiringCount, setExpiringCount] = useState(0)
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [form, setForm] = useState({ name: '', address: '', radius_meters: '50', latitude: '', longitude: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)

    const [{ data: sData }, { data: cData }] = await Promise.all([
      supabase.from('sites').select('*').eq('company_id', member.companyId).order('name'),
      supabase.from('site_compliance')
        .select('id')
        .eq('company_id', member.companyId)
        .lte('expiry_date', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]),
    ])

    setSites((sData ?? []) as Site[])
    setExpiringCount((cData ?? []).length)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function createSite() {
    if (!form.name.trim()) return
    setBusy(true)
    const supabase = createClient()
    const lat = form.latitude ? parseFloat(form.latitude) : null
    const lng = form.longitude ? parseFloat(form.longitude) : null
    const { data } = await supabase.from('sites').insert({
      company_id: companyId,
      name: form.name.trim(),
      address: form.address.trim() || null,
      radius_meters: parseInt(form.radius_meters) || 50,
      latitude: lat,
      longitude: lng,
    }).select().single()
    if (data) setSites(prev => [...prev, data as Site].sort((a, b) => a.name.localeCompare(b.name)))
    setForm({ name: '', address: '', radius_meters: '50', latitude: '', longitude: '' })
    setShowCreate(false)
    setBusy(false)
  }

  const hasCoords = (site: Site) =>
    site.latitude != null && site.longitude != null

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
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface-dark shrink-0">
        <h1 className="text-[20px] font-semibold text-text-primary">Properties &amp; Sites</h1>
        <button
          className="w-10 h-10 rounded-full bg-primary text-white text-[20px] flex items-center justify-center hover:bg-primary-dark transition-colors"
          onClick={() => setShowCreate(true)}
        >
          +
        </button>
      </div>

      {/* Expiring compliance banner */}
      {expiringCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-error shrink-0"
          style={{ backgroundColor: '#FEE2E2' }}>
          <span className="text-[16px]" style={{ color: 'var(--color-error)' }}>⚠</span>
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            <strong>{expiringCount}</strong> compliance item{expiringCount !== 1 ? 's' : ''} expiring soon or overdue
          </p>
        </div>
      )}

      {/* Site cards */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
        ) : sites.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <span className="text-[48px]">🏢</span>
            <p className="text-text-secondary text-sm font-medium">No properties yet</p>
            <p className="text-text-secondary text-sm text-center">
              Add your first site to start tracking properties
            </p>
          </div>
        ) : sites.map(site => (
          <div key={site.id} className="card p-3">
            <div className="grid gap-3 items-center" style={{ gridTemplateColumns: 'auto 1fr auto' }}>
              {/* Icon */}
              <div className="w-11 h-11 rounded-lg bg-primary flex items-center justify-center text-[18px] shrink-0">
                🏢
              </div>
              {/* Info */}
              <div className="min-w-0 flex flex-col gap-0.5">
                <p className="text-sm text-text-primary">{site.name}</p>
                {site.address && <p className="text-xs text-text-secondary truncate">{site.address}</p>}
                <p className="text-[12px] text-text-secondary">
                  Radius: <strong>{site.radius_meters ?? 50}m</strong>
                </p>
              </div>
              {/* GPS badge */}
              <span
                className="text-[11px] font-bold px-2 py-1 rounded-xl shrink-0"
                style={hasCoords(site)
                  ? { backgroundColor: '#DCFCE7', color: '#166534' }
                  : { backgroundColor: '#F3F4F6', color: '#6B7280' }
                }
              >
                {hasCoords(site) ? 'GPS' : 'No GPS'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Create site modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">New Site</h3>
            {[
              ['name', 'Site name *', 'text'],
              ['address', 'Address', 'text'],
              ['radius_meters', 'Geofence radius (metres)', 'number'],
              ['latitude', 'Latitude (optional)', 'number'],
              ['longitude', 'Longitude (optional)', 'number'],
            ].map(([field, label, type]) => (
              <div key={field} className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">{label}</label>
                <input
                  type={type}
                  value={(form as Record<string, string>)[field]}
                  onChange={e => setForm(prev => ({ ...prev, [field]: e.target.value }))}
                  className="dark-entry w-full"
                />
              </div>
            ))}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="btn-outlined h-9 px-4 text-[13px]">
                Cancel
              </button>
              <button onClick={createSite} disabled={!form.name.trim() || busy}
                className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">
                {busy ? 'Saving…' : 'Add Site'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
