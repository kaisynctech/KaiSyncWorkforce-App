'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { Site, Resident, Unit, SiteComplianceEntry } from '@/types/database'

type Tab = 'residents' | 'units' | 'compliance'

const fmtDate = (d: string | null | undefined) => {
  if (!d) return null
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
}

const initials = (name: string, surname?: string) =>
  `${name.charAt(0)}${(surname ?? '').charAt(0)}`.toUpperCase() || '?'

function complianceStatus(expiry: string | null | undefined): string {
  if (!expiry) return 'open'
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return 'expired'
  if (days <= 30) return 'expiring'
  return 'valid'
}

export default function ResidentsPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('residents')
  const [residents, setResidents] = useState<Resident[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [compliance, setCompliance] = useState<SiteComplianceEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [showResidentModal, setShowResidentModal] = useState(false)
  const [editResident, setEditResident] = useState<Resident | null>(null)
  const [rName, setRName] = useState('')
  const [rSurname, setRSurname] = useState('')
  const [rPhone, setRPhone] = useState('')

  const [showUnitModal, setShowUnitModal] = useState(false)
  const [uNumber, setUNumber] = useState('')
  const [uType, setUType] = useState('')

  const loadSites = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); return }
    setCompanyId(member.companyId)
    const { data } = await supabase.from('sites').select('*').eq('company_id', member.companyId).order('name')
    const list = (data ?? []) as Site[]
    setSites(list)
    if (list.length > 0) setSelectedSiteId(prev => prev || list[0].id)
  }, [])

  useEffect(() => { loadSites() }, [loadSites])

  const loadTabData = useCallback(async (siteId: string, tab: Tab) => {
    if (!siteId) return
    setLoading(true)
    const supabase = createClient()
    if (tab === 'residents') {
      const { data } = await supabase
        .from('residents')
        .select('*')
        .eq('site_id', siteId)
        .order('name')
      setResidents((data ?? []) as Resident[])
    } else if (tab === 'units') {
      const { data } = await supabase
        .from('units')
        .select('*')
        .eq('site_id', siteId)
        .order('unit_number')
      setUnits((data ?? []) as Unit[])
    } else {
      const { data } = await supabase
        .from('compliance_entries')
        .select('*')
        .eq('site_id', siteId)
        .order('expiry_date', { ascending: true, nullsFirst: false })
      setCompliance((data ?? []) as SiteComplianceEntry[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (selectedSiteId) loadTabData(selectedSiteId, activeTab)
  }, [selectedSiteId, activeTab, loadTabData])

  function openCreateResident() {
    setEditResident(null)
    setRName(''); setRSurname(''); setRPhone('')
    setShowResidentModal(true)
  }

  function openEditResident(r: Resident) {
    setEditResident(r)
    setRName(r.name); setRSurname(r.surname); setRPhone(r.phone ?? '')
    setShowResidentModal(true)
  }

  async function saveResident() {
    if (!companyId || !selectedSiteId || !rName.trim() || !rSurname.trim()) return
    setBusy(true)
    const supabase = createClient()
    if (editResident) {
      await supabase.from('residents').update({
        name: rName.trim(),
        surname: rSurname.trim(),
        phone: rPhone.trim() || null,
      }).eq('id', editResident.id)
    } else {
      const today = new Date().toISOString().split('T')[0]
      await supabase.from('residents').insert({
        company_id: companyId,
        site_id: selectedSiteId,
        name: rName.trim(),
        surname: rSurname.trim(),
        phone: rPhone.trim() || null,
        move_in_date: today,
      })
    }
    setBusy(false)
    setShowResidentModal(false)
    await loadTabData(selectedSiteId, 'residents')
  }

  async function saveUnit() {
    if (!companyId || !selectedSiteId || !uNumber.trim()) return
    setBusy(true)
    const supabase = createClient()
    await supabase.from('units').insert({
      company_id: companyId,
      site_id: selectedSiteId,
      unit_number: uNumber.trim(),
      unit_type: uType.trim() || null,
    })
    setBusy(false)
    setShowUnitModal(false)
    setUNumber(''); setUType('')
    await loadTabData(selectedSiteId, 'units')
  }

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
      <div className="flex items-center justify-between px-4 py-3 bg-surface-dark shrink-0">
        <h1 className="text-[20px] font-semibold text-text-primary">Residents &amp; Units</h1>
        <div className="flex gap-2">
          {activeTab === 'residents' && (
            <button
              onClick={openCreateResident}
              disabled={!selectedSiteId}
              className="btn-primary text-[12px] px-3 py-2 rounded-[16px] disabled:opacity-50"
            >
              + Resident
            </button>
          )}
          {activeTab === 'units' && (
            <button
              onClick={() => { setUNumber(''); setUType(''); setShowUnitModal(true) }}
              disabled={!selectedSiteId}
              className="btn-primary text-[12px] px-3 py-2 rounded-[16px] disabled:opacity-50"
            >
              + Unit
            </button>
          )}
        </div>
      </div>

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

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {!selectedSiteId ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Select a site to continue.</p>
        ) : loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
        ) : activeTab === 'residents' ? (
          residents.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10">
              <span className="material-icons text-[48px] text-text-disabled">group</span>
              <p className="text-text-secondary text-[13px]">No residents found.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {residents.map(r => {
                const current = !r.move_out_date
                const fullName = `${r.name} ${r.surname}`.trim()
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openEditResident(r)}
                    className="card my-1 p-3 text-left hover:border-primary/40 transition-colors"
                  >
                    <div className="grid gap-3 items-center" style={{ gridTemplateColumns: 'auto 1fr auto' }}>
                      <div className="w-11 h-11 rounded-full bg-primary flex items-center justify-center shrink-0">
                        <span className="text-[16px] font-bold text-white">{initials(r.name, r.surname)}</span>
                      </div>
                      <div>
                        <p className="text-sm text-text-primary">{fullName}</p>
                        {r.phone && <p className="text-xs text-text-secondary">{r.phone}</p>}
                        {r.move_in_date && (
                          <p className="text-xs text-text-secondary">Moved in: {fmtDate(r.move_in_date)}</p>
                        )}
                      </div>
                      <span className="text-[11px] font-bold px-2 py-1 rounded-xl shrink-0"
                        style={current
                          ? { backgroundColor: '#DCFCE7', color: '#166534' }
                          : { backgroundColor: '#F3F4F6', color: '#6B7280' }
                        }>
                        {current ? 'Active' : 'Moved Out'}
                      </span>
                    </div>
                  </button>
                )
              })}
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
                      <p className="text-sm text-text-primary">{u.unit_number || u.display_name}</p>
                      {u.unit_type && <p className="text-xs text-text-secondary">{u.unit_type}</p>}
                    </div>
                    {u.is_occupied != null && (
                      <span className="text-[11px] font-bold px-2 py-1 rounded-xl shrink-0"
                        style={u.is_occupied
                          ? { backgroundColor: '#DCFCE7', color: '#166534' }
                          : { backgroundColor: '#F3F4F6', color: '#6B7280' }
                        }>
                        {u.is_occupied ? 'Occupied' : 'Vacant'}
                      </span>
                    )}
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
              {compliance.map(c => {
                const status = complianceStatus(c.expiry_date)
                return (
                  <div key={c.id} className="card my-1 p-3">
                    <div className="grid grid-cols-[1fr_auto] items-start">
                      <div>
                        <p className="text-sm text-text-primary">{c.compliance_type}</p>
                        {c.certificate_number && (
                          <p className="text-xs text-text-secondary">{c.certificate_number}</p>
                        )}
                        {c.expiry_date && (
                          <p className="text-xs text-text-secondary">Expires: {fmtDate(c.expiry_date)}</p>
                        )}
                      </div>
                      <span
                        className="text-[11px] font-bold px-2 py-0.5 rounded-[10px] shrink-0 capitalize"
                        style={
                          status === 'expired' ? { backgroundColor: '#FEE2E2', color: '#991B1B' }
                            : status === 'expiring' ? { backgroundColor: '#FEF3C7', color: '#92400E' }
                              : { backgroundColor: '#DCFCE7', color: '#166534' }
                        }
                      >
                        {status}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>

      {showResidentModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">
              {editResident ? 'Edit Resident' : 'New Resident'}
            </h3>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Name *</label>
              <input value={rName} onChange={e => setRName(e.target.value)} className="dark-entry w-full" autoFocus />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Surname *</label>
              <input value={rSurname} onChange={e => setRSurname(e.target.value)} className="dark-entry w-full" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Phone</label>
              <input value={rPhone} onChange={e => setRPhone(e.target.value)} className="dark-entry w-full" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowResidentModal(false)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
              <button
                onClick={saveResident}
                disabled={!rName.trim() || !rSurname.trim() || busy}
                className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUnitModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">New Unit</h3>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Unit number *</label>
              <input value={uNumber} onChange={e => setUNumber(e.target.value)} className="dark-entry w-full" autoFocus />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Unit type</label>
              <input value={uType} onChange={e => setUType(e.target.value)} placeholder="e.g. Apartment" className="dark-entry w-full" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowUnitModal(false)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
              <button
                onClick={saveUnit}
                disabled={!uNumber.trim() || busy}
                className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
