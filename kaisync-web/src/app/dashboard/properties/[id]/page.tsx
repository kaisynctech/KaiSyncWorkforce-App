'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { syncUnitOccupancy } from '@/lib/properties'
import { KpiTile } from '@/components/ui/KpiTile'
import type {
  LeaseDocumentType,
  LeasePaymentFrequency,
  LeaseStatus,
  PropertyKind,
  PropertyLease,
  PropertyLeaseDocument,
  Resident,
  Site,
  SiteComplianceEntry,
  Unit,
} from '@/types/database'

type Tab = 'overview' | 'units' | 'residents' | 'leases' | 'compliance'
type ClientOption = { id: string; name: string }
type EmployeeOption = { id: string; name: string; surname: string }
type RentInvoiceRow = {
  id: string
  lease_id: string | null
  invoice_number: string | null
  status: string
  total_amount: number
  balance_due: number
  due_date: string | null
  invoice_type: string | null
}

const PROPERTY_KINDS: PropertyKind[] = ['residential', 'commercial', 'mixed', 'other']
const LEASE_STATUSES: LeaseStatus[] = ['draft', 'active', 'ended', 'cancelled']
const LEASE_FREQS: LeasePaymentFrequency[] = ['monthly', 'weekly', 'other']
const DOC_TYPES: LeaseDocumentType[] = ['lease', 'id', 'addendum', 'other']

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
}

const fmtMoney = (n: number | null | undefined, currency = 'ZAR') => {
  if (n == null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)
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
    initialTab && ['overview', 'units', 'residents', 'leases', 'compliance'].includes(initialTab)
      ? initialTab
      : 'overview',
  )

  const [site, setSite] = useState<Site | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [residents, setResidents] = useState<Resident[]>([])
  const [leases, setLeases] = useState<PropertyLease[]>([])
  const [leaseDocs, setLeaseDocs] = useState<PropertyLeaseDocument[]>([])
  const [rentInvoices, setRentInvoices] = useState<RentInvoiceRow[]>([])
  const [compliance, setCompliance] = useState<SiteComplianceEntry[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
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
  const [managedById, setManagedById] = useState('')
  const [propertyKind, setPropertyKind] = useState<PropertyKind>('residential')
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

  const [showLease, setShowLease] = useState(false)
  const [editLease, setEditLease] = useState<PropertyLease | null>(null)
  const [lUnit, setLUnit] = useState('')
  const [lResident, setLResident] = useState('')
  const [lTenantClient, setLTenantClient] = useState('')
  const [lTenantName, setLTenantName] = useState('')
  const [lStart, setLStart] = useState('')
  const [lEnd, setLEnd] = useState('')
  const [lRent, setLRent] = useState('')
  const [lDeposit, setLDeposit] = useState('')
  const [lFreq, setLFreq] = useState<LeasePaymentFrequency>('monthly')
  const [lStatus, setLStatus] = useState<LeaseStatus>('draft')
  const [lNotes, setLNotes] = useState('')

  const [docLeaseId, setDocLeaseId] = useState<string | null>(null)
  const [docType, setDocType] = useState<LeaseDocumentType>('lease')
  const [docBusy, setDocBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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
    setEmployeeId(member.employeeId)
    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

    const [sRes, uRes, rRes, lRes, cRes, clRes, eRes, invRes] = await Promise.all([
      supabase
        .from('sites')
        .select('*, clients(id, name), managed_by:employees!sites_managed_by_employee_id_fkey(id, name, surname)')
        .eq('id', id)
        .eq('company_id', member.companyId)
        .maybeSingle(),
      supabase.from('units').select('*').eq('site_id', id).eq('company_id', member.companyId).order('unit_number'),
      supabase.from('residents').select('*').eq('site_id', id).eq('company_id', member.companyId).order('name'),
      supabase.from('property_leases').select('*').eq('site_id', id).eq('company_id', member.companyId).order('start_date', { ascending: false }),
      supabase.from('compliance_entries').select('*').eq('site_id', id).eq('company_id', member.companyId).order('expiry_date', { ascending: true, nullsFirst: false }),
      supabase.from('clients').select('id, name').eq('company_id', member.companyId).order('name').limit(500),
      supabase.from('employees').select('id, name, surname').eq('company_id', member.companyId).eq('is_active', true).order('name').limit(500),
      supabase
        .from('finance_invoices')
        .select('id, lease_id, invoice_number, status, total_amount, balance_due, due_date, invoice_type')
        .eq('company_id', member.companyId)
        .eq('site_id', id)
        .order('due_date', { ascending: false, nullsFirst: false })
        .limit(100),
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
    setManagedById(s.managed_by_employee_id ?? '')
    setPropertyKind((s.property_kind as PropertyKind) || 'residential')
    setIsActive(s.is_active !== false)
    setUnits((uRes.data ?? []) as Unit[])
    setResidents((rRes.data ?? []) as Resident[])
    const leaseRows = (lRes.data ?? []) as PropertyLease[]
    setLeases(leaseRows)
    setCompliance((cRes.data ?? []) as SiteComplianceEntry[])
    setClients((clRes.data ?? []) as ClientOption[])
    setEmployees((eRes.data ?? []) as EmployeeOption[])
    setRentInvoices((invRes.data ?? []) as RentInvoiceRow[])

    if (leaseRows.length > 0) {
      const leaseIds = leaseRows.map(l => l.id)
      const { data: docs } = await supabase
        .from('property_lease_documents')
        .select('*')
        .eq('company_id', member.companyId)
        .in('lease_id', leaseIds)
        .order('created_at', { ascending: false })
      setLeaseDocs((docs ?? []) as PropertyLeaseDocument[])
    } else {
      setLeaseDocs([])
    }

    setLoading(false)
  }, [id, router])

  useEffect(() => { void load() }, [load])

  const kpis = useMemo(() => {
    const occupied = units.filter(u => u.is_occupied).length
    const currentResidents = residents.filter(r => !r.move_out_date).length
    const activeLeases = leases.filter(l => l.status === 'active').length
    const today = new Date().toISOString().slice(0, 10)
    const arrears = rentInvoices.filter(inv =>
      Number(inv.balance_due) > 0
      && inv.status !== 'voided'
      && inv.status !== 'cancelled'
      && (inv.status === 'overdue' || (inv.due_date != null && inv.due_date < today)),
    )
    const arrearsTotal = arrears.reduce((s, inv) => s + Number(inv.balance_due || 0), 0)
    const expiring = compliance.filter(c => {
      const st = complianceStatus(c.expiry_date)
      return st === 'expired' || st === 'expiring'
    }).length
    return {
      units: units.length,
      vacant: units.length - occupied,
      residents: currentResidents,
      activeLeases,
      arrearsCount: arrears.length,
      arrearsTotal,
      complianceAlerts: expiring,
    }
  }, [units, residents, leases, rentInvoices, compliance])

  const unitLabel = (unitId: string | null | undefined) => {
    if (!unitId) return '—'
    return units.find(u => u.id === unitId)?.unit_number ?? '—'
  }

  const residentLabel = (residentId: string | null | undefined) => {
    if (!residentId) return null
    const r = residents.find(x => x.id === residentId)
    return r ? `${r.name} ${r.surname}` : null
  }

  const tenantDisplay = (lease: PropertyLease) => {
    return residentLabel(lease.resident_id)
      || clients.find(c => c.id === lease.tenant_client_id)?.name
      || lease.tenant_name
      || '—'
  }

  const docsForLease = (leaseId: string) => leaseDocs.filter(d => d.lease_id === leaseId)
  const invoicesForLease = (leaseId: string) => rentInvoices.filter(i => i.lease_id === leaseId)

  function rentInvoiceHref(lease: PropertyLease) {
    const params = new URLSearchParams({
      lease_id: lease.id,
      site_id: id,
    })
    if (lease.tenant_client_id) params.set('client_id', lease.tenant_client_id)
    return `/dashboard/money/invoices/new?${params.toString()}`
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
      managed_by_employee_id: managedById || null,
      property_kind: propertyKind,
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
    if (nextUnitId) await syncUnitOccupancy(supabase, companyId, nextUnitId)

    setBusy(false)
    setShowResident(false)
    await load()
  }

  function openCreateLease() {
    setEditLease(null)
    setLUnit(''); setLResident(''); setLTenantClient(''); setLTenantName('')
    setLStart(new Date().toISOString().slice(0, 10)); setLEnd('')
    setLRent(''); setLDeposit(''); setLFreq('monthly'); setLStatus('draft'); setLNotes('')
    setShowLease(true)
  }

  function openEditLease(lease: PropertyLease) {
    setEditLease(lease)
    setLUnit(lease.unit_id ?? '')
    setLResident(lease.resident_id ?? '')
    setLTenantClient(lease.tenant_client_id ?? '')
    setLTenantName(lease.tenant_name ?? '')
    setLStart(lease.start_date ?? '')
    setLEnd(lease.end_date ?? '')
    setLRent(lease.rent_amount != null ? String(lease.rent_amount) : '')
    setLDeposit(lease.deposit_amount != null ? String(lease.deposit_amount) : '')
    setLFreq(lease.payment_frequency || 'monthly')
    setLStatus(lease.status || 'draft')
    setLNotes(lease.notes ?? '')
    setShowLease(true)
  }

  async function saveLease() {
    if (!companyId || !canEdit || !lStart) return
    if (!lResident && !lTenantClient && !lTenantName.trim()) {
      setError('Lease needs a resident, tenant client, or tenant name.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const rent = lRent.trim() ? parseFloat(lRent) : null
    const deposit = lDeposit.trim() ? parseFloat(lDeposit) : null
    const payload = {
      unit_id: lUnit || null,
      resident_id: lResident || null,
      tenant_client_id: lTenantClient || null,
      tenant_name: lTenantName.trim() || null,
      start_date: lStart,
      end_date: lEnd || null,
      rent_amount: Number.isFinite(rent as number) ? rent : null,
      deposit_amount: Number.isFinite(deposit as number) ? deposit : null,
      payment_frequency: lFreq,
      status: lStatus,
      notes: lNotes.trim() || null,
      updated_at: new Date().toISOString(),
    }

    if (editLease) {
      const { error: e } = await supabase.from('property_leases').update(payload).eq('id', editLease.id).eq('company_id', companyId)
      setBusy(false)
      if (e) { setError(e.message); return }
    } else {
      const { error: e } = await supabase.from('property_leases').insert({
        company_id: companyId,
        site_id: id,
        currency: 'ZAR',
        created_by: employeeId,
        ...payload,
      })
      setBusy(false)
      if (e) { setError(e.message); return }
    }
    setShowLease(false)
    await load()
  }

  async function uploadLeaseDoc(file: File) {
    if (!companyId || !employeeId || !canEdit || !docLeaseId) return
    setDocBusy(true)
    setError(null)
    const supabase = createClient()
    const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : ''
    const path = `property_leases/${companyId}/${docLeaseId}/hr_${crypto.randomUUID()}${ext}`
    const { error: upErr } = await supabase.storage
      .from('workforce-media')
      .upload(path, file, { upsert: true, contentType: file.type || undefined })
    if (upErr) {
      setError(upErr.message)
      setDocBusy(false)
      return
    }
    const { data: pub } = supabase.storage.from('workforce-media').getPublicUrl(path)
    const { error: insErr } = await supabase.from('property_lease_documents').insert({
      company_id: companyId,
      lease_id: docLeaseId,
      document_name: file.name,
      document_type: docType,
      storage_path: path,
      file_url: pub.publicUrl,
      file_size_bytes: file.size,
      mime_type: file.type || null,
      uploaded_by: employeeId,
    })
    setDocBusy(false)
    if (insErr) {
      setError(insErr.message)
      return
    }
    setDocLeaseId(null)
    if (fileRef.current) fileRef.current.value = ''
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

  const managerName = site.managed_by
    ? `${site.managed_by.name} ${site.managed_by.surname}`
    : employees.find(e => e.id === site.managed_by_employee_id)
      ? `${employees.find(e => e.id === site.managed_by_employee_id)!.name} ${employees.find(e => e.id === site.managed_by_employee_id)!.surname}`
      : null

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'units', label: 'Units' },
    { id: 'residents', label: 'Residents' },
    { id: 'leases', label: 'Leases' },
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
            {site.property_kind ? ` · ${site.property_kind}` : ''}
            {site.clients?.name ? ` · Owner: ${site.clients.name}` : ''}
            {managerName ? ` · Manager: ${managerName}` : ''}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiTile value={kpis.units} label="Units" bg="#1E293B" valueFg="#FCD34D" labelFg="#64748B" />
          <KpiTile value={kpis.vacant} label="Vacant" bg="#3F1D1D" valueFg="#F87171" labelFg="#FCA5A5" />
          <KpiTile value={kpis.residents} label="Current residents" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
          <KpiTile value={kpis.activeLeases} label="Active leases" bg="#1E293B" valueFg="#60A5FA" labelFg="#64748B" />
          <KpiTile value={kpis.arrearsCount} label="Arrears invoices" bg="#3F1D1D" valueFg="#F87171" labelFg="#FCA5A5" />
          <KpiTile value={kpis.complianceAlerts} label="Compliance alerts" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
        </div>
        {kpis.arrearsTotal > 0 && (
          <p className="text-[13px] text-error">
            Rent arrears outstanding: {fmtMoney(kpis.arrearsTotal)}
          </p>
        )}

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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-[12px] text-text-secondary">Property kind
                <select value={propertyKind} onChange={e => setPropertyKind(e.target.value as PropertyKind)} disabled={!canEdit} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60">
                  {PROPERTY_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
              <label className="block text-[12px] text-text-secondary">Status
                <select value={isActive ? '1' : '0'} onChange={e => setIsActive(e.target.value === '1')} disabled={!canEdit} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60">
                  <option value="1">Active (billable)</option>
                  <option value="0">Inactive</option>
                </select>
              </label>
            </div>
            <label className="block text-[12px] text-text-secondary">Owner / principal client
              <select value={clientId} onChange={e => setClientId(e.target.value)} disabled={!canEdit} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60">
                <option value="">— None —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="block text-[12px] text-text-secondary">Managed by (staff)
              <select value={managedById} onChange={e => setManagedById(e.target.value)} disabled={!canEdit} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60">
                <option value="">— Unassigned —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name} {e.surname}</option>)}
              </select>
            </label>
            <label className="block text-[12px] text-text-secondary">Geofence radius (m)
              <input type="number" value={radius} onChange={e => setRadius(e.target.value)} disabled={!canEdit} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60" />
            </label>
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

        {tab === 'leases' && (
          <div className="space-y-3">
            {canEdit && (
              <button type="button" onClick={openCreateLease} className="btn-outlined h-9 px-3 text-[13px]">+ Lease</button>
            )}
            <p className="text-[12px] text-text-secondary">
              Lease agreements for units. Invoice rent into Money, attach signed leases/IDs, and track arrears.
            </p>
            {leases.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No leases yet.</p>
            ) : (
              <div className="space-y-4">
                {leases.map(lease => {
                  const docs = docsForLease(lease.id)
                  const invs = invoicesForLease(lease.id)
                  return (
                    <div key={lease.id} className="border border-divider rounded-xl overflow-hidden">
                      <table className="w-full" style={{ minWidth: 640 }}>
                        <tbody>
                          <tr className="border-b border-divider bg-surface-elevated">
                            <td className="data-td text-[13px] font-medium">{tenantDisplay(lease)}</td>
                            <td className="data-td text-[13px]">{unitLabel(lease.unit_id)}</td>
                            <td className="data-td text-[12px]">{fmtDate(lease.start_date)} – {fmtDate(lease.end_date)}</td>
                            <td className="data-td text-[13px]">{fmtMoney(lease.rent_amount, lease.currency)}/{lease.payment_frequency}</td>
                            <td className="data-td text-[12px] capitalize">{lease.status}</td>
                            <td className="data-td text-right whitespace-nowrap">
                              {canEdit && (
                                <>
                                  <button type="button" onClick={() => openEditLease(lease)} className="text-[12px] text-primary hover:underline mr-3">Edit</button>
                                  <Link href={rentInvoiceHref(lease)} className="text-[12px] text-primary hover:underline mr-3">
                                    Invoice rent
                                  </Link>
                                  <button
                                    type="button"
                                    onClick={() => { setDocLeaseId(lease.id); setDocType('lease') }}
                                    className="text-[12px] text-primary hover:underline"
                                  >
                                    Upload
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      {!lease.tenant_client_id && canEdit && (
                        <p className="px-3 py-1.5 text-[11px] text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300">
                          No tenant client on this lease — set one (or pick a client on the invoice form) before billing.
                        </p>
                      )}
                      {invs.length > 0 && (
                        <ul className="px-3 py-2 space-y-1 bg-background border-t border-divider">
                          {invs.map(inv => (
                            <li key={inv.id} className="flex items-center justify-between gap-2 text-[12px]">
                              <Link href={`/dashboard/money/invoices/${inv.id}`} className="text-primary hover:underline truncate">
                                {inv.invoice_number ?? 'Draft'} · {inv.status}
                                {inv.due_date ? ` · due ${fmtDate(inv.due_date)}` : ''}
                              </Link>
                              <span className={Number(inv.balance_due) > 0 ? 'text-error' : 'text-text-secondary'}>
                                bal {fmtMoney(Number(inv.balance_due), 'ZAR')}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {docs.length > 0 && (
                        <ul className="px-3 py-2 space-y-1 bg-background border-t border-divider">
                          {docs.map(d => (
                            <li key={d.id} className="flex items-center justify-between gap-2 text-[12px]">
                              <span className="text-text-secondary capitalize">{d.document_type}</span>
                              {d.file_url ? (
                                <a href={d.file_url} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate">
                                  {d.document_name}
                                </a>
                              ) : (
                                <span className="truncate">{d.document_name}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {rentInvoices.length > 0 && (
              <div className="pt-2">
                <h3 className="text-[14px] font-semibold text-text-primary mb-2">All rent invoices</h3>
                <table className="w-full" style={{ minWidth: 560 }}>
                  <thead>
                    <tr className="border-b border-divider">
                      <th className="data-th text-left">Invoice</th>
                      <th className="data-th text-left">Due</th>
                      <th className="data-th text-left">Status</th>
                      <th className="data-th text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rentInvoices.map(inv => (
                      <tr
                        key={inv.id}
                        className="border-b border-divider hover:bg-surface-elevated cursor-pointer"
                        onClick={() => router.push(`/dashboard/money/invoices/${inv.id}`)}
                      >
                        <td className="data-td text-[13px] text-primary">{inv.invoice_number ?? 'Draft'}</td>
                        <td className="data-td text-[12px]">{fmtDate(inv.due_date)}</td>
                        <td className="data-td text-[12px] capitalize">{inv.status}</td>
                        <td className={`data-td text-[13px] text-right ${Number(inv.balance_due) > 0 ? 'text-error' : ''}`}>
                          {fmtMoney(Number(inv.balance_due))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

      {showLease && (
        <Modal title={editLease ? 'Edit lease' : 'New lease'} onClose={() => setShowLease(false)}>
          <label className="block text-[12px] text-text-secondary">Unit
            <select value={lUnit} onChange={e => setLUnit(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              <option value="">— Whole property / unassigned —</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
            </select>
          </label>
          <label className="block text-[12px] text-text-secondary">Resident
            <select value={lResident} onChange={e => setLResident(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              <option value="">— None —</option>
              {residents.map(r => <option key={r.id} value={r.id}>{r.name} {r.surname}</option>)}
            </select>
          </label>
          <label className="block text-[12px] text-text-secondary">Tenant client (commercial)
            <select value={lTenantClient} onChange={e => setLTenantClient(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              <option value="">— None —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block text-[12px] text-text-secondary">Tenant name (if not linked)
            <input value={lTenantName} onChange={e => setLTenantName(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-text-secondary">Start *
              <input type="date" value={lStart} onChange={e => setLStart(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">End
              <input type="date" value={lEnd} onChange={e => setLEnd(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-text-secondary">Rent (ZAR)
              <input type="number" step="0.01" value={lRent} onChange={e => setLRent(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Deposit
              <input type="number" step="0.01" value={lDeposit} onChange={e => setLDeposit(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-text-secondary">Frequency
              <select value={lFreq} onChange={e => setLFreq(e.target.value as LeasePaymentFrequency)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                {LEASE_FREQS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="block text-[12px] text-text-secondary">Status
              <select value={lStatus} onChange={e => setLStatus(e.target.value as LeaseStatus)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                {LEASE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-[12px] text-text-secondary">Notes
            <input value={lNotes} onChange={e => setLNotes(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowLease(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
            <button type="button" disabled={busy || !lStart} onClick={() => void saveLease()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Save</button>
          </div>
        </Modal>
      )}

      {docLeaseId && (
        <Modal title="Upload lease document" onClose={() => setDocLeaseId(null)}>
          <label className="block text-[12px] text-text-secondary">Document type
            <select value={docType} onChange={e => setDocType(e.target.value as LeaseDocumentType)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block text-[12px] text-text-secondary">File
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
              className="mt-1 w-full text-[13px]"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) void uploadLeaseDoc(f)
              }}
            />
          </label>
          {docBusy && <p className="text-[12px] text-text-secondary">Uploading…</p>}
          <div className="flex justify-end">
            <button type="button" onClick={() => setDocLeaseId(null)} className="btn-outlined h-9 px-3 text-[13px]">Close</button>
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
