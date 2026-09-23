'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
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
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <ResidentsInner />
    </Suspense>
  )
}

function ResidentsInner() {
  const searchParams = useSearchParams()
  const siteIdFromUrl = searchParams.get('siteId') ?? ''

  const [sites, setSites] = useState<Site[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState(siteIdFromUrl)
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
  const [rEmergName, setREmergName] = useState('')
  const [rEmergPhone, setREmergPhone] = useState('')
  const [rEmergRel, setREmergRel] = useState('')

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
    setSelectedSiteId(prev => {
      if (siteIdFromUrl && list.some(s => s.id === siteIdFromUrl)) return siteIdFromUrl
      if (prev && list.some(s => s.id === prev)) return prev
      return list[0]?.id ?? ''
    })
  }, [siteIdFromUrl])

  useEffect(() => { void loadSites() }, [loadSites])

  const loadTabData = useCallback(async (siteId: string, tab: Tab) => {
    if (!siteId) return
    setLoading(true)
    const supabase = createClient()
    if (tab === 'residents') {
      const { data } = await supabase.from('residents').select('*').eq('site_id', siteId).order('name')
      setResidents((data ?? []) as Resident[])
    } else if (tab === 'units') {
      const { data } = await supabase.from('units').select('*').eq('site_id', siteId).order('unit_number')
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
    if (selectedSiteId) void loadTabData(selectedSiteId, activeTab)
  }, [selectedSiteId, activeTab, loadTabData])

  function openCreateResident() {
    setEditResident(null)
    setRName(''); setRSurname(''); setRPhone('')
    setREmergName(''); setREmergPhone(''); setREmergRel('')
    setShowResidentModal(true)
  }

  function openEditResident(r: Resident) {
    setEditResident(r)
    setRName(r.name); setRSurname(r.surname); setRPhone(r.phone ?? '')
    setREmergName(r.emergency_contact_name ?? '')
    setREmergPhone(r.emergency_contact_phone ?? '')
    setREmergRel(r.emergency_contact_relationship ?? '')
    setShowResidentModal(true)
  }

  async function saveResident() {
    if (!companyId || !selectedSiteId || !rName.trim() || !rSurname.trim()) return
    setBusy(true)
    const supabase = createClient()
    const emergency = {
      emergency_contact_name: rEmergName.trim() || null,
      emergency_contact_phone: rEmergPhone.trim() || null,
      emergency_contact_relationship: rEmergRel.trim() || null,
    }
    if (editResident) {
      await supabase.from('residents').update({
        name: rName.trim(),
        surname: rSurname.trim(),
        phone: rPhone.trim() || null,
        ...emergency,
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
        ...emergency,
      })
    }
    setBusy(false)
    setShowResidentModal(false)
    void loadTabData(selectedSiteId, 'residents')
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
      is_occupied: false,
    })
    setBusy(false)
    setShowUnitModal(false)
    setUNumber(''); setUType('')
    void loadTabData(selectedSiteId, 'units')
  }

  if (error === 'not_linked') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[13px] text-text-secondary">Account not linked to an employee.</p>
      </div>
    )
  }

  const selectedSite = sites.find(s => s.id === selectedSiteId)

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 bg-surface-dark shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-[20px] font-semibold text-text-primary">Residents</h1>
          {selectedSiteId && (
            <Link href={`/dashboard/properties/${selectedSiteId}`} className="text-[12px] text-primary hover:underline">
              Open property detail →
            </Link>
          )}
        </div>
        <select
          value={selectedSiteId}
          onChange={e => setSelectedSiteId(e.target.value)}
          className="w-full max-w-md h-10 px-3 border border-border rounded-md text-[13px] bg-background"
        >
          {sites.length === 0 && <option value="">No properties</option>}
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {selectedSite?.address && (
          <p className="text-[12px] text-text-secondary">{selectedSite.address}</p>
        )}
        <div className="flex gap-1 border-b border-divider">
          {(['residents', 'units', 'compliance'] as Tab[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={`px-3 py-2 text-[13px] font-medium border-b-2 -mb-px capitalize ${
                activeTab === t ? 'border-primary text-primary' : 'border-transparent text-text-secondary'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!selectedSiteId ? (
          <p className="text-[13px] text-text-secondary text-center py-8">Select a property.</p>
        ) : loading ? (
          <p className="text-[13px] text-text-secondary text-center py-8">Loading…</p>
        ) : activeTab === 'residents' ? (
          <div className="space-y-3">
            <button type="button" onClick={openCreateResident} className="btn-outlined h-9 px-3 text-[13px]">+ Resident</button>
            {residents.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No residents.</p>
            ) : (
              <div className="space-y-2">
                {residents.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openEditResident(r)}
                    className="w-full text-left card p-3 flex items-center gap-3 hover:bg-surface-elevated"
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[12px] font-semibold">
                      {initials(r.name, r.surname)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-text-primary">{r.name} {r.surname}</p>
                      <p className="text-[12px] text-text-secondary">
                        {r.phone ?? 'No phone'}{r.move_in_date ? ` · in ${fmtDate(r.move_in_date)}` : ''}
                        {r.emergency_contact_name
                          ? ` · ICE: ${r.emergency_contact_name}${r.emergency_contact_phone ? ` ${r.emergency_contact_phone}` : ''}`
                          : ''}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : activeTab === 'units' ? (
          <div className="space-y-3">
            <button type="button" onClick={() => setShowUnitModal(true)} className="btn-outlined h-9 px-3 text-[13px]">+ Unit</button>
            {units.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No units.</p>
            ) : (
              <table className="w-full" style={{ minWidth: 400 }}>
                <thead>
                  <tr className="border-b border-divider">
                    <th className="data-th text-left">Unit</th>
                    <th className="data-th text-left">Type</th>
                    <th className="data-th text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map(u => (
                    <tr key={u.id} className="border-b border-divider">
                      <td className="data-td text-[13px]">{u.unit_number}</td>
                      <td className="data-td text-[13px]">{u.unit_type ?? '—'}</td>
                      <td className="data-td text-[12px]">{u.is_occupied ? 'Occupied' : 'Vacant'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {compliance.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No compliance entries.</p>
            ) : (
              <table className="w-full" style={{ minWidth: 400 }}>
                <thead>
                  <tr className="border-b border-divider">
                    <th className="data-th text-left">Type</th>
                    <th className="data-th text-left">Expiry</th>
                    <th className="data-th text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {compliance.map(c => (
                    <tr key={c.id} className="border-b border-divider">
                      <td className="data-td text-[13px]">{c.compliance_type}</td>
                      <td className="data-td text-[13px]">{fmtDate(c.expiry_date) ?? '—'}</td>
                      <td className="data-td text-[12px] capitalize">{complianceStatus(c.expiry_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {showResidentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-surface rounded-xl w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">{editResident ? 'Edit resident' : 'New resident'}</h3>
            <input value={rName} onChange={e => setRName(e.target.value)} placeholder="Name" className="dark-entry w-full" />
            <input value={rSurname} onChange={e => setRSurname(e.target.value)} placeholder="Surname" className="dark-entry w-full" />
            <input value={rPhone} onChange={e => setRPhone(e.target.value)} placeholder="Phone" className="dark-entry w-full" />
            <p className="text-[11px] font-medium text-text-secondary">Emergency / next of kin</p>
            <input value={rEmergName} onChange={e => setREmergName(e.target.value)} placeholder="Contact name" className="dark-entry w-full" />
            <input value={rEmergPhone} onChange={e => setREmergPhone(e.target.value)} placeholder="Contact phone" className="dark-entry w-full" />
            <input value={rEmergRel} onChange={e => setREmergRel(e.target.value)} placeholder="Relationship (e.g. parent)" className="dark-entry w-full" />
            <p className="text-[11px] text-text-secondary">For unit assignment, use the property detail page.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowResidentModal(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
              <button type="button" disabled={busy || !rName.trim() || !rSurname.trim()} onClick={() => void saveResident()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}

      {showUnitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-surface rounded-xl w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">New unit</h3>
            <input value={uNumber} onChange={e => setUNumber(e.target.value)} placeholder="Unit number" className="dark-entry w-full" />
            <input value={uType} onChange={e => setUType(e.target.value)} placeholder="Type" className="dark-entry w-full" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowUnitModal(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
              <button type="button" disabled={busy || !uNumber.trim()} onClick={() => void saveUnit()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
