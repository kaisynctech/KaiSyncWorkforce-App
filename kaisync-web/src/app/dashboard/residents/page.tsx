'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { Site, Resident, Unit, SiteComplianceEntry } from '@/types/database'

type Tab = 'residents' | 'units' | 'compliance'

const fmtDate = (d: string | null) => {
  if (!d) return null
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
}

const initials = (name: string) => name.charAt(0).toUpperCase()

export default function ResidentsPage() {
  const router = useRouter()
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('residents')
  const [residents, setResidents] = useState<Resident[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [compliance, setCompliance] = useState<SiteComplianceEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSites = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); return }
    const { data } = await supabase.from('sites').select('*').eq('company_id', member.companyId).order('name')
    const list = (data ?? []) as Site[]
    setSites(list)
    if (list.length > 0) setSelectedSiteId(list[0].id)
  }, [])

  useEffect(() => { loadSites() }, [loadSites])

  const loadTabData = useCallback(async (siteId: string, tab: Tab) => {
    if (!siteId) return
    setLoading(true)
    const supabase = createClient()
    if (tab === 'residents') {
      const { data } = await supabase.from('residents').select('*').eq('site_id', siteId).order('name')
      setResidents((data ?? []) as Resident[])
    } else if (tab === 'units') {
      const { data } = await supabase.from('units').select('*').eq('site_id', siteId).order('display_name')
      setUnits((data ?? []) as Unit[])
    } else {
      const { data } = await supabase.from('site_compliance').select('*').eq('site_id', siteId).order('title')
      setCompliance((data ?? []) as SiteComplianceEntry[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (selectedSiteId) loadTabData(selectedSiteId, activeTab)
  }, [selectedSiteId, activeTab, loadTabData])

  const TABS: { key: Tab; label: string }[] = [
    { key: 'residents', label: 'Residents' },
    { key: 'units', label: 'Units' },
    { key: 'compliance', label: 'Compliance' },
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
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface-dark shrink-0">
        <h1 className="text-[20px] font-semibold text-text-primary">Residents &amp; Units</h1>
        <div className="flex gap-2">
          {activeTab === 'residents' && (
            <button className="btn-primary text-[12px] px-3 py-2 rounded-[16px]">+ Resident</button>
          )}
          {activeTab === 'units' && (
            <button className="btn-primary text-[12px] px-3 py-2 rounded-[16px]">+ Unit</button>
          )}
        </div>
      </div>

      {/* Site picker */}
      <div className="px-3 py-2 flex items-center gap-2 bg-surface-dark border-b border-divider shrink-0">
        <label className="text-xs text-text-secondary shrink-0">Site:</label>
        <select
          value={selectedSiteId}
          onChange={e => setSelectedSiteId(e.target.value)}
          className="flex-1 bg-transparent border-none text-text-primary text-[13px] outline-none"
        >
          <option value="">Select a site…</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* Tab toggle */}
      <div className="flex gap-2 px-2 py-2 overflow-x-auto shrink-0 border-b border-divider">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className="h-[32px] px-3 text-[12px] whitespace-nowrap rounded-[16px] font-medium transition-colors"
            style={activeTab === t.key
              ? { backgroundColor: '#3B82F6', color: '#fff' }
              : { backgroundColor: '#fff', color: '#6B7280' }
            }>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
        ) : activeTab === 'residents' ? (
          residents.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10">
              <span className="text-[48px]">👥</span>
              <p className="text-text-secondary text-[13px]">No residents found.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {residents.map(r => (
                <div key={r.id} className="card my-1 p-3">
                  <div className="grid gap-3 items-center" style={{ gridTemplateColumns: 'auto 1fr auto' }}>
                    <div className="w-11 h-11 rounded-full bg-primary flex items-center justify-center shrink-0">
                      <span className="text-[16px] font-bold text-white">{initials(r.name)}</span>
                    </div>
                    <div>
                      <p className="text-sm text-text-primary">{r.full_name || r.name}</p>
                      {r.phone && <p className="text-xs text-text-secondary">{r.phone}</p>}
                      {r.move_in_date && (
                        <p className="text-xs text-text-secondary">Moved in: {fmtDate(r.move_in_date)}</p>
                      )}
                    </div>
                    <span className="text-[11px] font-bold px-2 py-1 rounded-xl shrink-0"
                      style={r.is_current_resident
                        ? { backgroundColor: '#DCFCE7', color: '#166534' }
                        : { backgroundColor: '#F3F4F6', color: '#6B7280' }
                      }>
                      {r.is_current_resident ? 'Active' : 'Moved Out'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : activeTab === 'units' ? (
          units.length === 0 ? (
            <p className="text-text-secondary text-[13px] text-center py-8">No units found.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {units.map(u => (
                <div key={u.id} className="card my-1 p-3">
                  <div className="grid grid-cols-[1fr_auto] items-center">
                    <div>
                      <p className="text-sm text-text-primary">{u.display_name}</p>
                      {u.unit_type && <p className="text-xs text-text-secondary">{u.unit_type}</p>}
                    </div>
                    <span className="text-[11px] font-bold px-2 py-1 rounded-xl shrink-0"
                      style={u.is_occupied
                        ? { backgroundColor: '#DCFCE7', color: '#166534' }
                        : { backgroundColor: '#F3F4F6', color: '#6B7280' }
                      }>
                      {u.is_occupied ? 'Occupied' : 'Vacant'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          compliance.length === 0 ? (
            <p className="text-text-secondary text-[13px] text-center py-8">No compliance items.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {compliance.map(c => (
                <div key={c.id} className="card my-1 p-3">
                  <div className="grid grid-cols-[1fr_auto] items-start">
                    <div>
                      <p className="text-sm text-text-primary">{c.title}</p>
                      <p className="text-xs text-text-secondary">{c.category}</p>
                      {c.expiry_date && (
                        <p className="text-xs text-text-secondary">Expires: {fmtDate(c.expiry_date)}</p>
                      )}
                    </div>
                    <span
                      className="text-[11px] font-bold px-2 py-0.5 rounded-[10px] shrink-0"
                      style={{ backgroundColor: 'var(--color-surface-dark)', color: 'var(--color-primary)' }}
                    >
                      {c.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
