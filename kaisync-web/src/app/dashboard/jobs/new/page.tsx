'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { SectionCard, FormField, entryClass } from '@/components/SectionCard'
import { FormSelect } from '@/components/FormSelect'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { createJob } from '@/lib/jobs'
import { localDateTimeToIso, localDateTimeInputOf } from '@/lib/schedule-times'
import { JobWherePicker, type JobWhereValue } from '@/components/jobs/JobWherePicker'
import { ClientSearch } from '@/components/jobs/ClientSearch'
import { SearchPicker } from '@/components/SearchPicker'
import {
  addServiceChecklistToJob,
  areaOptions,
  formatPrice,
  listClientServices,
  listJobServices,
  listSiteAreas,
  type ClientServiceRow,
  type JobService,
} from '@/lib/job-services'
import { addJobEquipment, areaAndInner, listSiteEquipment } from '@/lib/job-equipment'
import type { Client, Employee } from '@/types/database'

export default function CreateJobPage() {
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <CreateJobInner />
    </Suspense>
  )
}

function CreateJobInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedDealId = searchParams.get('dealId') ?? ''
  const preselectedClientId = searchParams.get('clientId') ?? ''

  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [deals, setDeals] = useState<{ id: string; title: string; project_code: string | null; client_id: string | null }[]>([])
  const [employees, setEmployees] = useState<Pick<Employee, 'id' | 'name' | 'surname' | 'employee_number' | 'position' | 'department'>[]>([])
  const [perms, setPerms] = useState<PermissionSet | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [estimatedCost, setEstimatedCost] = useState('')
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')
  const [clientId, setClientId] = useState(preselectedClientId)
  const [dealId, setDealId] = useState(preselectedDealId)
  const [address, setAddress] = useState('')
  const [assignedEmployeeId, setAssignedEmployeeId] = useState('')
  const [where, setWhere] = useState<JobWhereValue>({ siteId: '', areaId: '', serviceId: '' })
  const [addAreaUnits, setAddAreaUnits] = useState(true)
  const [services, setServices] = useState<JobService[]>([])
  const [clientRows, setClientRows] = useState<ClientServiceRow[]>([])
  const [serviceId, setServiceId] = useState('')
  // What the service filled in, so a later change (client, start time) only replaces values nobody typed over.
  const [autoTitle, setAutoTitle] = useState('')
  const [autoCost, setAutoCost] = useState('')
  const [autoEnd, setAutoEnd] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const canCreate = can(perms, PERM.jobsCreate)

  const pickedService = services.find(s => s.id === serviceId) ?? null
  const employeeOptions = useMemo(() => employees.map(e => ({
    id: e.id,
    label: `${e.name ?? ''} ${e.surname ?? ''}`.trim(),
    detail: e.employee_number ?? null,
    keywords: [e.position, e.department].filter(Boolean).join(' '),
  })), [employees])

  /** The client's agreed price wins over the company's usual price. */
  function priceFor(id: string, rows: ClientServiceRow[] = clientRows): number | null {
    const agreed = rows.find(r => r.service_id === id)?.agreed_price
    return agreed ?? services.find(s => s.id === id)?.default_price ?? null
  }

  /** Fills the end from the start plus the service's usual time, unless someone set the end by hand. */
  function fillEnd(service: JobService | null, date: string, time: string) {
    const current = endDate ? `${endDate}T${endTime}` : ''
    if (!service?.default_duration_minutes || !date || (current && current !== autoEnd)) return
    const startIso = localDateTimeToIso(date, time)
    if (!startIso) return
    const end = localDateTimeInputOf(new Date(new Date(startIso).getTime() + service.default_duration_minutes * 60000).toISOString())
    setEndDate(end.slice(0, 10))
    setEndTime(end.slice(11, 16))
    setAutoEnd(`${end.slice(0, 10)}T${end.slice(11, 16)}`)
  }

  /** Choosing the service first fills the title, estimated cost and end time (only where nothing was typed). */
  function pickService(id: string) {
    setServiceId(id)
    const service = services.find(s => s.id === id) ?? null
    if (!service) return
    if (!title.trim() || title === autoTitle) { setTitle(service.name); setAutoTitle(service.name) }
    const price = priceFor(id)
    if (price != null && (!estimatedCost || estimatedCost === autoCost)) { setEstimatedCost(String(price)); setAutoCost(String(price)) }
    fillEnd(service, startDate, startTime)
  }

  /** Loads the client's own service list; an agreed price replaces the filled-in cost. */
  async function loadClientServices(nextClientId: string, company: string | null = companyId) {
    if (!nextClientId || !company) { setClientRows([]); return }
    const res = await listClientServices(createClient(), company, nextClientId)
    const rows = res.ok ? res.data : []
    setClientRows(rows)
    if (serviceId) {
      const price = priceFor(serviceId, rows)
      if (price != null && (!estimatedCost || estimatedCost === autoCost)) { setEstimatedCost(String(price)); setAutoCost(String(price)) }
    }
  }

  function pickClient(next: string) {
    changeClient(next)
    if (dealId) {
      const deal = deals.find(d => d.id === dealId)
      if (deal?.client_id && next && deal.client_id !== next) setDealId('')
    }
  }

  function changeClient(next: string) {
    setClientId(next)
    setWhere({ siteId: '', areaId: '', serviceId: '' })
    void loadClientServices(next)
  }

  useEffect(() => { void loadContext() }, [])

  async function loadContext() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    const [cl, emp, dl, me, sv] = await Promise.all([
      supabase.from('clients').select('id, name, client_code, account_number').eq('company_id', member.companyId).order('name').limit(10000),
      supabase.from('employees').select('id, name, surname, employee_number, position, department')
        .eq('company_id', member.companyId).eq('is_active', true).order('name'),
      supabase.from('client_deals').select('id, title, project_code, client_id').eq('company_id', member.companyId).order('title'),
      supabase.from('employees').select('access_level').eq('id', member.employeeId).maybeSingle(),
      listJobServices(supabase, member.companyId),
    ])
    if (sv.ok) setServices(sv.data)

    setPerms(await loadPermissions(supabase, member.companyId, me.data?.access_level))

    const dealRows = (dl.data ?? []) as { id: string; title: string; project_code: string | null; client_id: string | null }[]
    setClients((cl.data ?? []) as Client[])
    setEmployees((emp.data ?? []) as Pick<Employee, 'id' | 'name' | 'surname' | 'employee_number' | 'position' | 'department'>[])
    setDeals(dealRows)

    if (preselectedDealId) {
      setDealId(preselectedDealId)
      const deal = dealRows.find(d => d.id === preselectedDealId)
      if (deal?.client_id) { setClientId(deal.client_id); void loadClientServices(deal.client_id, member.companyId) }
    } else if (preselectedClientId) {
      setClientId(preselectedClientId)
      void loadClientServices(preselectedClientId, member.companyId)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canCreate) { setError('You do not have permission to create jobs.'); return }
    if (!companyId || !title.trim()) {
      setError('Job title is required.')
      return
    }
    setSaving(true)
    setError(null)

    // Local (South African) time. These used to be sent without a time zone and stored 2 h late.
    const scheduledStart = localDateTimeToIso(startDate, startTime)
    const scheduledEnd = localDateTimeToIso(endDate, endTime)

    const supabase = createClient()
    const assignee = assignedEmployeeId || null
    const created = await createJob(supabase, {
      companyId,
      title,
      description,
      priority,
      estimatedCost: estimatedCost ? parseFloat(estimatedCost) : null,
      scheduledStart,
      scheduledEnd,
      clientId: clientId || null,
      siteId: clientId ? where.siteId || null : null,
      areaId: clientId ? where.areaId || null : null,
      serviceId: serviceId || null,
      dealId: dealId || null,
      address,
      assigneeEmployeeId: assignee,
      assignedEmployeeIds: assignee ? [assignee] : [],
      createdByEmployeeId: employeeId,
      assignCode: true,
    })

    if (created.ok && pickedService && pickedService.checklist.length) {
      const steps = await addServiceChecklistToJob(supabase, companyId, created.data.id, pickedService.checklist)
      if (!steps.ok) console.warn('Checklist steps were not added:', steps.message)
    }
    // The area's equipment (and the areas inside it) goes on the job card for the technician to tick off.
    if (created.ok && clientId && where.siteId && where.areaId && addAreaUnits) {
      const [areas, units] = await Promise.all([
        listSiteAreas(supabase, companyId, [where.siteId], { includeInactive: true }),
        listSiteEquipment(supabase, companyId, [where.siteId]),
      ])
      if (areas.ok && units.ok) {
        const inArea = areaAndInner(where.areaId, areaOptions(areas.data))
        const ids = units.data.filter(u => u.status === 'active' && u.area_id && inArea.has(u.area_id)).map(u => u.id)
        const added = await addJobEquipment(supabase, companyId, created.data.id, ids)
        if (!added.ok) console.warn('Equipment was not added:', added.message)
      }
    }
    setSaving(false)
    if (!created.ok) { setError(created.message); return }
    router.push(`/dashboard/jobs/${created.data.id}`)
  }

  if (error === 'not_linked') return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3">
        <Link href="/dashboard/jobs" aria-label="Back to jobs" className="inline-flex text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <span className="material-icons text-[48px] text-text-disabled">person_off</span>
          <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
          <p className="text-[13px] text-text-secondary">
            Your account is not linked to an active employee record.<br/>
            Please contact your administrator.
          </p>
        </div>
      </div>
    </div>
  )

  if (perms && !canCreate) {
    return (
      <div className="h-full flex flex-col p-6">
        <Link href="/dashboard/jobs" aria-label="Back to jobs" className="inline-flex text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <span className="material-icons text-[48px] text-text-disabled">lock</span>
          <p className="text-[16px] font-semibold text-text-primary">Permission required</p>
          <p className="text-[13px] text-text-secondary">You do not have permission to create jobs.</p>
        </div>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-4 pb-8">
      <div className="flex items-center gap-2 mb-1">
        <Link href="/dashboard/jobs" className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <h1 className="text-[19px] font-bold text-text-primary">New Job</h1>
      </div>

      <SectionCard title="SERVICE & CLIENT">
        <FormSelect label="What is the job?" value={serviceId} onChange={e => pickService(e.target.value)}
          hint={services.length === 0 ? 'No services yet. Add them under Jobs › Job services, or skip this and type a title below.' : undefined}>
          <option value="">{services.length ? 'Choose a service (optional)' : 'No services yet'}</option>
          {clientRows.length > 0 && (
            <optgroup label="Agreed for this client">
              {services.filter(s => clientRows.some(r => r.service_id === s.id)).map(s => (
                <option key={s.id} value={s.id}>{s.name}{priceFor(s.id) != null ? ` · ${formatPrice(priceFor(s.id))}` : ''}</option>
              ))}
            </optgroup>
          )}
          <optgroup label={clientRows.length > 0 ? 'Other services' : 'Services'}>
            {services.filter(s => !clientRows.some(r => r.service_id === s.id)).map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.default_price != null ? ` · ${formatPrice(s.default_price)}` : ''}</option>
            ))}
          </optgroup>
        </FormSelect>
        {pickedService?.description && <p className="text-[12px] text-text-secondary">{pickedService.description}</p>}
        {pickedService && (
          <p className="text-[12px] text-text-secondary">
            Fills in the title and estimated cost{pickedService.default_duration_minutes ? ', and the end time once you pick a start' : ''}.
            {pickedService.checklist.length > 0 && ` ${pickedService.checklist.length} checklist step${pickedService.checklist.length === 1 ? '' : 's'} will be added to the job.`}
          </p>
        )}
        {pickedService && clientRows.length > 0 && !clientRows.some(r => r.service_id === pickedService.id) && (
          <p className="text-[12px] text-warning">This service is not on this client&apos;s agreed list.</p>
        )}

        <ClientSearch clients={clients} value={clientId} onChange={pickClient} />

        {companyId && clientId && (
          <>
            <JobWherePicker
              companyId={companyId}
              clientId={clientId}
              value={where}
              onChange={setWhere}
              canAdd={canCreate}
              showService={false}
            />
            {where.areaId && (
              <label className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer">
                <input type="checkbox" className="accent-primary" checked={addAreaUnits} onChange={e => setAddAreaUnits(e.target.checked)} />
                Put this area&apos;s equipment on the job card
              </label>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard title="JOB DETAILS">
        <FormField label="Title *">
          <input type="text" value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Site cleanup — Block B" required className={entryClass} />
        </FormField>
        <FormField label="Description / Notes">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Additional details or instructions…"
            rows={3}
            className={`${entryClass} h-auto py-3 resize-none`}
          />
        </FormField>
        <FormSelect label="Priority" value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </FormSelect>
        <FormField label="Estimated cost (R)">
          <input type="number" value={estimatedCost} onChange={e => setEstimatedCost(e.target.value)}
            onWheel={e => e.currentTarget.blur()}
            placeholder="0.00" step="0.01" min="0" className={entryClass} />
        </FormField>
      </SectionCard>

      <SectionCard title="SCHEDULE">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Start date">
            <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); fillEnd(pickedService, e.target.value, startTime) }} className={entryClass} />
          </FormField>
          <FormField label="Start time">
            <input type="time" value={startTime} onChange={e => { setStartTime(e.target.value); fillEnd(pickedService, startDate, e.target.value) }} className={entryClass} />
          </FormField>
          <FormField label="End date">
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={entryClass} />
          </FormField>
          <FormField label="End time">
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className={entryClass} />
          </FormField>
        </div>
      </SectionCard>

      <SectionCard title="PROJECT">
        <FormSelect
          label="Project"
          value={dealId}
          onChange={e => {
            const next = e.target.value
            setDealId(next)
            if (next) {
              const deal = deals.find(d => d.id === next)
              if (deal?.client_id && deal.client_id !== clientId) changeClient(deal.client_id)
            }
          }}
        >
          <option value="">No project</option>
          {deals
            .filter(d => !clientId || !d.client_id || d.client_id === clientId)
            .map(d => (
              <option key={d.id} value={d.id}>
                {d.title}{d.project_code ? ` (${d.project_code})` : ''}
              </option>
            ))}
        </FormSelect>
      </SectionCard>

      <SectionCard title="LOCATION">
        <FormField label="Address">
          <input type="text" value={address} onChange={e => setAddress(e.target.value)}
            placeholder="Full address or description" className={entryClass} />
        </FormField>
      </SectionCard>

      <SectionCard title="ASSIGNMENT">
        <SearchPicker
          label="Assign to employee"
          noun="employee"
          value={assignedEmployeeId}
          onChange={setAssignedEmployeeId}
          placeholder={`Type a name or employee number (${employees.length.toLocaleString()} staff) — leave empty for unassigned`}
          options={employeeOptions}
        />
      </SectionCard>

      {error && <p className="text-error text-[13px] px-1">{error}</p>}

      <button
        type="submit"
        disabled={saving || !title.trim() || !canCreate}
        className="w-full h-[52px] bg-primary text-white rounded-md font-semibold text-[15px] hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {saving ? 'Creating…' : 'Create Job'}
      </button>
    </form>
  )
}
