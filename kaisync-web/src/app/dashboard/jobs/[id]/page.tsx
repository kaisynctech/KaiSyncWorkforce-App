'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { FormSelect } from '@/components/FormSelect'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { Job, Employee, JobContractor, LaborEntry, JobInventoryItem, JobPhoto } from '@/types/database'

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['open', 'scheduled', 'in_progress', 'completed', 'cancelled'] as const

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  completed:   { bg: '#DCFCE7', fg: '#166534' },
  in_progress: { bg: '#DBEAFE', fg: '#1e40af' },
  cancelled:   { bg: '#FEE2E2', fg: '#991b1b' },
  open:        { bg: '#F3F4F6', fg: '#374151' },
  scheduled:   { bg: '#F3F4F6', fg: '#374151' },
}

const PRIORITY_COLORS: Record<string, { bg: string; fg: string }> = {
  high:   { bg: '#FEE2E2', fg: '#991b1b' },
  medium: { bg: '#FEF3C7', fg: '#92400E' },
  low:    { bg: '#DCFCE7', fg: '#166534' },
}

// ─── Local types ──────────────────────────────────────────────────────────────

type JobDetail = Job & {
  clients:  { name: string; client_code: string | null } | null
  sites:    { name: string; address: string | null } | null
  projects: { name: string } | null
}

type ClientRow       = { id: string; name: string }
type ContractorRow   = { id: string; name: string; contractor_code: string | null }
type InventoryRow    = { id: string; name: string; unit_cost: number | null; quantity_on_hand: number | null }

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtDatetime = (d: string | null) => {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(d))
}

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

const inputCls = 'w-full h-10 px-3 bg-background border border-border rounded-lg text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function JobDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const jobId = params.id

  // ── Core state ──────────────────────────────────────────────────────────────
  const [job,            setJob]            = useState<JobDetail | null>(null)
  const [companyId,      setCompanyId]      = useState<string | null>(null)
  const [myEmployeeId,   setMyEmployeeId]   = useState<string | null>(null)
  const [employees,      setEmployees]      = useState<Pick<Employee, 'id' | 'name' | 'surname'>[]>([])
  const [assignedIds,    setAssignedIds]    = useState<Set<string>>(new Set())
  const [jobContractors, setJobContractors] = useState<JobContractor[]>([])
  const [laborEntries,   setLaborEntries]   = useState<LaborEntry[]>([])
  const [inventory,      setInventory]      = useState<JobInventoryItem[]>([])
  const [photos,         setPhotos]         = useState<JobPhoto[]>([])
  const [statusUpdate,   setStatusUpdate]   = useState<string>('open')
  const [error,          setError]          = useState<string | null>(null)
  const [saving,         setSaving]         = useState(false)
  const [deleting,       setDeleting]       = useState(false)
  const [photoBusy,      setPhotoBusy]      = useState(false)

  // ── Edit form ───────────────────────────────────────────────────────────────
  const [isEditing,       setIsEditing]       = useState(false)
  const [editTitle,       setEditTitle]       = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editPriority,    setEditPriority]    = useState<Job['priority']>('medium')
  const [editStart,       setEditStart]       = useState('')
  const [editEnd,         setEditEnd]         = useState('')
  const [editClientId,    setEditClientId]    = useState<string | null>(null)
  const [clients,         setClients]         = useState<ClientRow[]>([])

  // ── Contractor modal ─────────────────────────────────────────────────────
  const [showContractorModal,   setShowContractorModal]   = useState(false)
  const [contractorSearch,      setContractorSearch]      = useState('')
  const [allContractors,        setAllContractors]        = useState<ContractorRow[]>([])
  const [selectedContractorId,  setSelectedContractorId]  = useState('')
  const [agreedAmount,          setAgreedAmount]          = useState('')

  // ── Inventory modal ──────────────────────────────────────────────────────
  const [showInventoryModal, setShowInventoryModal] = useState(false)
  const [inventorySearch,    setInventorySearch]    = useState('')
  const [allInventory,       setAllInventory]       = useState<InventoryRow[]>([])
  const [selectedItemId,     setSelectedItemId]     = useState('')
  const [quantity,           setQuantity]           = useState('1')

  const beforeInputRef = useRef<HTMLInputElement>(null)
  const afterInputRef  = useRef<HTMLInputElement>(null)

  useEffect(() => { load() }, [jobId])

  // ── Data loading ─────────────────────────────────────────────────────────

  async function load() {
    const supabase = createClient()
    const member   = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); return }

    setCompanyId(member.companyId)
    setMyEmployeeId(member.employeeId)

    const [jobRes, empRes, jcRes, leRes, invRes, photoRes, assignRes, clientRes, contractorRes, invItemsRes] =
      await Promise.all([
        supabase.from('jobs').select('*, clients(*), sites(*), projects(*)').eq('id', jobId).single(),
        supabase.from('employees').select('id, name, surname').eq('company_id', member.companyId).eq('is_active', true).order('name'),
        supabase.from('job_contractors').select('*, contractors(name, contractor_code)').eq('job_id', jobId),
        supabase.from('labor_entries').select('*').eq('job_id', jobId).order('work_date'),
        supabase.from('job_inventory').select('*').eq('job_id', jobId),
        supabase.from('job_photos').select('*').eq('job_id', jobId),
        supabase.from('job_employees').select('employee_id').eq('job_id', jobId),
        supabase.from('clients').select('id, name').eq('company_id', member.companyId).order('name'),
        supabase.from('contractors').select('id, name, contractor_code').eq('company_id', member.companyId).eq('is_active', true).order('name'),
        supabase.from('inventory_items').select('id, name, unit_cost, quantity_on_hand').eq('company_id', member.companyId).order('name'),
      ])

    if (jobRes.data) {
      setJob(jobRes.data as JobDetail)
      setStatusUpdate(jobRes.data.status)
    }
    setEmployees((empRes.data     ?? []) as Pick<Employee, 'id' | 'name' | 'surname'>[])
    setJobContractors((jcRes.data  ?? []) as JobContractor[])
    setLaborEntries((leRes.data    ?? []) as LaborEntry[])
    setInventory((invRes.data      ?? []) as JobInventoryItem[])
    setPhotos((photoRes.data       ?? []) as JobPhoto[])
    setAssignedIds(new Set((assignRes.data ?? []).map((r: { employee_id: string }) => r.employee_id)))
    setClients((clientRes.data     ?? []) as ClientRow[])
    setAllContractors((contractorRes.data ?? []) as ContractorRow[])
    setAllInventory((invItemsRes.data     ?? []) as InventoryRow[])
  }

  // ── Edit job ─────────────────────────────────────────────────────────────

  function startEdit() {
    if (!job) return
    setEditTitle(job.title)
    setEditDescription(job.description ?? '')
    setEditPriority(job.priority)
    setEditStart(job.scheduled_start ? job.scheduled_start.slice(0, 16) : '')
    setEditEnd(job.scheduled_end ? job.scheduled_end.slice(0, 16) : '')
    setEditClientId(job.client_id ?? null)
    setIsEditing(true)
  }

  async function saveEdit() {
    if (!job) return
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error: e } = await supabase.from('jobs').update({
      title:           editTitle.trim(),
      description:     editDescription.trim() || null,
      priority:        editPriority,
      scheduled_start: editStart ? new Date(editStart).toISOString() : null,
      scheduled_end:   editEnd ? new Date(editEnd).toISOString() : null,
      client_id:       editClientId,
    }).eq('id', jobId)
    if (e) {
      setError(e.message)
    } else {
      setJob(prev => prev ? {
        ...prev,
        title:           editTitle.trim(),
        description:     editDescription.trim() || null,
        priority:        editPriority,
        scheduled_start: editStart ? new Date(editStart).toISOString() : null,
        scheduled_end:   editEnd ? new Date(editEnd).toISOString() : null,
        client_id:       editClientId,
      } : prev)
      setIsEditing(false)
    }
    setSaving(false)
  }

  // ── Assign contractor ─────────────────────────────────────────────────────

  async function assignContractor() {
    if (!selectedContractorId || !companyId) return
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error: e } = await supabase.rpc('hr_upsert_job_contractor', {
      p_company_id:    companyId,
      p_job_id:        jobId,
      p_contractor_id: selectedContractorId,
      p_agreed_amount: parseFloat(agreedAmount) || 0,
    })
    if (e) {
      setError(e.message)
    } else {
      setShowContractorModal(false)
      setSelectedContractorId('')
      setAgreedAmount('')
      setContractorSearch('')
      await load()
    }
    setSaving(false)
  }

  // ── Allocate inventory ────────────────────────────────────────────────────

  async function allocateInventory() {
    if (!selectedItemId || !companyId || !myEmployeeId) return
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const item = allInventory.find(i => i.id === selectedItemId)
    const { error: e } = await supabase.rpc('hr_allocate_inventory_to_job', {
      p_company_id:        companyId,
      p_job_id:            jobId,
      p_employee_id:       myEmployeeId,
      p_inventory_item_id: selectedItemId,
      p_quantity:          parseFloat(quantity) || 1,
      p_unit_cost:         item?.unit_cost ?? null,
    })
    if (e) {
      setError(e.message)
    } else {
      setShowInventoryModal(false)
      setSelectedItemId('')
      setQuantity('1')
      setInventorySearch('')
      await load()
    }
    setSaving(false)
  }

  // ── Existing handlers ─────────────────────────────────────────────────────

  function toggleEmployee(empId: string) {
    setAssignedIds(prev => {
      const next = new Set(prev)
      if (next.has(empId)) next.delete(empId)
      else next.add(empId)
      return next
    })
  }

  async function handleSaveStatus() {
    if (!job) return
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error: e } = await supabase.from('jobs').update({ status: statusUpdate }).eq('id', jobId)
    if (e) setError(e.message)
    else setJob(prev => prev ? { ...prev, status: statusUpdate as Job['status'] } : prev)
    setSaving(false)
  }

  async function handleSaveTeam() {
    setSaving(true)
    setError(null)
    const supabase = createClient()
    await supabase.from('job_employees').delete().eq('job_id', jobId)
    if (assignedIds.size > 0) {
      const rows = Array.from(assignedIds).map(emp_id => ({ job_id: jobId, employee_id: emp_id }))
      const { error: e } = await supabase.from('job_employees').insert(rows)
      if (e) { setError(e.message); setSaving(false); return }
    }
    setSaving(false)
  }

  async function handleDeleteJob() {
    if (!window.confirm('Delete this job? This cannot be undone.')) return
    setDeleting(true)
    const supabase = createClient()
    const { error: e } = await supabase.from('jobs').delete().eq('id', jobId)
    if (e) { setError(e.message); setDeleting(false); return }
    router.push('/dashboard/jobs')
  }

  async function handleCloseJob() {
    if (!window.confirm('Mark this job as completed and close it?')) return
    setSaving(true)
    const supabase = createClient()
    const { error: e } = await supabase.from('jobs')
      .update({ status: 'completed', closed_at: new Date().toISOString() })
      .eq('id', jobId)
    if (e) setError(e.message)
    else {
      setJob(prev => prev ? { ...prev, status: 'completed' } : prev)
      setStatusUpdate('completed')
    }
    setSaving(false)
  }

  async function handleMarkFirstResponse() {
    setSaving(true)
    const supabase = createClient()
    const { error: e } = await supabase.from('jobs')
      .update({ first_response_at: new Date().toISOString() })
      .eq('id', jobId)
    if (e) setError(e.message)
    else setJob(prev => prev ? { ...prev, first_response_at: new Date().toISOString() } : prev)
    setSaving(false)
  }

  async function uploadPhoto(type: 'before' | 'after', file: File) {
    setPhotoBusy(true)
    const supabase = createClient()
    const path = `jobs/${jobId}/${type}/${Date.now()}_${file.name}`
    const { error: upErr } = await supabase.storage.from('workforce-media').upload(path, file)
    if (upErr) { setError(upErr.message); setPhotoBusy(false); return }
    const { data: signed } = await supabase.storage.from('workforce-media').createSignedUrl(path, 3600)
    const { data: photoData, error: photoErr } = await supabase
      .from('job_photos')
      .insert({ job_id: jobId, photo_type: type, storage_path: path, url: signed?.signedUrl ?? path })
      .select().single()
    if (!photoErr && photoData) setPhotos(prev => [...prev, photoData as JobPhoto])
    setPhotoBusy(false)
  }

  async function handleRemoveContractor(jcId: string) {
    const supabase = createClient()
    await supabase.from('job_contractors').delete().eq('id', jcId)
    setJobContractors(prev => prev.filter(c => c.id !== jcId))
  }

  // ── Guards ────────────────────────────────────────────────────────────────

  if (!job) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-secondary text-[13px]">Loading…</span>
      </div>
    )
  }

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

  // ── Derived ───────────────────────────────────────────────────────────────

  const statusColor    = STATUS_COLORS[job.status]   ?? STATUS_COLORS.open
  const priorityColor  = PRIORITY_COLORS[job.priority] ?? PRIORITY_COLORS.low
  const beforePhotos   = photos.filter(p => p.photo_type === 'before')
  const afterPhotos    = photos.filter(p => p.photo_type === 'after')
  const laborTotal     = laborEntries.reduce((s, e) => s + e.total_cost, 0)
  const inventoryTotal = inventory.reduce((s, i) => s + i.total_cost, 0)
  const totalCost      = (job.labor_cost ?? laborTotal) + (job.inventory_cost ?? inventoryTotal)
  const isOpen         = job.status !== 'completed' && job.status !== 'cancelled'

  const filteredContractors = allContractors.filter(c =>
    c.name.toLowerCase().includes(contractorSearch.toLowerCase())
  )
  const filteredInventory = allInventory.filter(i =>
    i.name.toLowerCase().includes(inventorySearch.toLowerCase())
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 space-y-4 overflow-y-auto pb-8">

      {/* ── Action bar ── */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={handleSaveTeam}
          disabled={saving || isEditing}
          className="h-[42px] px-[18px] text-sm min-w-[72px] rounded-xl bg-primary text-white font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors shrink-0"
        >
          Save
        </button>
        <Link
          href={`/dashboard/jobs/${jobId}/chat`}
          className="h-[42px] px-[18px] text-sm min-w-[72px] rounded-xl border border-primary text-primary font-semibold hover:bg-primary/5 transition-colors shrink-0 flex items-center justify-center"
        >
          Chat
        </Link>
        {/* Edit / Save edit / Cancel */}
        <button
          onClick={isEditing ? saveEdit : startEdit}
          disabled={saving}
          className="h-[42px] px-[18px] text-sm min-w-[72px] rounded-xl border border-border text-text-primary font-semibold hover:border-primary hover:text-primary disabled:opacity-50 transition-colors shrink-0"
        >
          {saving && isEditing ? '…' : isEditing ? 'Save' : 'Edit'}
        </button>
        {isEditing && (
          <button
            onClick={() => setIsEditing(false)}
            className="h-[42px] px-[18px] text-sm min-w-[72px] rounded-xl border border-border text-text-secondary font-semibold hover:text-text-primary transition-colors shrink-0"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleDeleteJob}
          disabled={deleting}
          className="h-[42px] px-[18px] text-sm min-w-[72px] rounded-xl border font-semibold disabled:opacity-50 shrink-0"
          style={{ backgroundColor: '#450A0A', color: '#FCA5A5', borderColor: '#FCA5A5' }}
        >
          {deleting ? '…' : 'Delete'}
        </button>
      </div>

      {/* Error banner */}
      {error && error !== 'not_linked' && (
        <p className="font-semibold text-[13px]" style={{ color: '#FCA5A5' }}>{error}</p>
      )}

      {/* ── Job header card ── */}
      <div className="bg-surface rounded-xl p-4 border border-divider space-y-3">
        {isEditing ? (
          /* ── Edit form ── */
          <div className="space-y-3">
            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Edit Job</p>
            <div>
              <label className="text-[11px] text-text-secondary mb-1 block">Title</label>
              <input
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                className={inputCls}
                placeholder="Job title"
              />
            </div>
            <div>
              <label className="text-[11px] text-text-secondary mb-1 block">Description</label>
              <textarea
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                placeholder="Description (optional)"
                rows={3}
              />
            </div>
            <div>
              <label className="text-[11px] text-text-secondary mb-1 block">Priority</label>
              <FormSelect value={editPriority} onChange={e => setEditPriority(e.target.value as Job['priority'])}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </FormSelect>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-text-secondary mb-1 block">Start</label>
                <input
                  type="datetime-local"
                  value={editStart}
                  onChange={e => setEditStart(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-[11px] text-text-secondary mb-1 block">End</label>
                <input
                  type="datetime-local"
                  value={editEnd}
                  onChange={e => setEditEnd(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-text-secondary mb-1 block">Client</label>
              <FormSelect
                value={editClientId ?? ''}
                onChange={e => setEditClientId(e.target.value || null)}
              >
                <option value="">No client</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </FormSelect>
            </div>
          </div>
        ) : (
          /* ── Display mode ── */
          <>
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-[18px] font-semibold text-text-primary leading-tight">{job.title}</h1>
              <span
                className="rounded-xl px-[10px] py-1 text-[11px] font-semibold shrink-0"
                style={{ backgroundColor: statusColor.bg, color: statusColor.fg }}
              >
                {job.status.replace('_', ' ')}
              </span>
            </div>
            {job.description && (
              <p className="text-[13px] text-text-secondary">{job.description}</p>
            )}
            <div className="border-t border-divider pt-3">
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-center">
                <span className="text-[12px] text-text-secondary">Priority</span>
                <span
                  className="rounded-xl px-[10px] py-1 text-[11px] font-semibold w-fit"
                  style={{ backgroundColor: priorityColor.bg, color: priorityColor.fg }}
                >
                  {job.priority}
                </span>

                <span className="text-[12px] text-text-secondary">Client</span>
                <span className="text-[13px] text-text-primary">{job.clients?.name ?? '—'}</span>

                <span className="text-[12px] text-text-secondary">Site</span>
                <span className="text-[13px] text-text-primary">{job.sites?.address ?? job.address ?? '—'}</span>

                <span className="text-[12px] text-text-secondary">Start</span>
                <span className="text-[13px] text-text-primary">{fmtDatetime(job.scheduled_start)}</span>

                <span className="text-[12px] text-text-secondary">End</span>
                <span className="text-[13px] text-text-primary">{fmtDatetime(job.scheduled_end)}</span>

                <span className="text-[12px] text-text-secondary">Est. Cost</span>
                <span className="text-[13px] text-text-primary">R{(job.estimated_cost ?? 0).toFixed(2)}</span>

                <span className="text-[12px] text-text-secondary">Project</span>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-text-primary">{job.projects?.name ?? '—'}</span>
                  {job.projects && (
                    <button className="text-primary text-[11px] h-[28px] px-2 hover:opacity-70 transition-opacity">Open</button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {isOpen && !isEditing && (
          <div className="flex gap-2 pt-1 border-t border-divider flex-wrap">
            {!job.first_response_at && (
              <button
                onClick={handleMarkFirstResponse}
                disabled={saving}
                className="h-8 px-3 text-[12px] rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors disabled:opacity-50"
              >
                Mark First Response
              </button>
            )}
            <button
              onClick={handleCloseJob}
              disabled={saving}
              className="h-8 px-4 text-[12px] rounded-lg bg-primary text-white font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
            >
              Close Job
            </button>
          </div>
        )}
      </div>

      {/* ── Status update card ── */}
      <div className="bg-surface rounded-xl p-4 border border-divider space-y-3">
        <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase">Update Status</p>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <FormSelect value={statusUpdate} onChange={e => setStatusUpdate(e.target.value)}>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </FormSelect>
          </div>
          <button
            onClick={handleSaveStatus}
            disabled={saving}
            className="h-12 w-20 text-[13px] rounded-lg bg-primary text-white font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors shrink-0"
          >
            Update
          </button>
        </div>
      </div>

      {/* ── Team & Contractor card ── */}
      <div className="bg-surface rounded-xl border border-divider overflow-hidden">
        <div className="px-4 py-2.5 border-b border-divider bg-surface-elevated">
          <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase">Team & Contractor</p>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-[12px] text-text-secondary">Assign employees and/or a contractor for this job.</p>

          {/* Employee checklist */}
          <div className="max-h-[160px] overflow-y-auto space-y-0.5 rounded-lg border border-divider p-2">
            {employees.length === 0 && (
              <p className="text-text-disabled text-[12px] px-1 py-1">No employees in company.</p>
            )}
            {employees.map(emp => (
              <label key={emp.id} className="flex items-center gap-2 px-1 py-1.5 rounded cursor-pointer hover:bg-background transition-colors">
                <input
                  type="checkbox"
                  checked={assignedIds.has(emp.id)}
                  onChange={() => toggleEmployee(emp.id)}
                  className="rounded border-border accent-primary"
                />
                <span className="text-[13px] text-text-primary">{emp.name} {emp.surname}</span>
              </label>
            ))}
          </div>

          {/* Contractor sub-section */}
          <div className="border-t border-divider pt-3 space-y-2">
            <p className="text-[13px] font-semibold text-text-primary">Contractors</p>
            <p className="text-[12px] text-text-secondary">Assign one or more contractors to this job.</p>

            {jobContractors.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]" style={{ minWidth: 480 }}>
                  <thead>
                    <tr className="text-text-secondary text-[11px] border-b border-divider">
                      <th className="text-left pb-2 pr-2">Contractor</th>
                      <th className="text-left pb-2 pr-2 w-24">Amount</th>
                      <th className="pb-2 w-9"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobContractors.map(jc => (
                      <tr key={jc.id} className="border-b border-divider last:border-0">
                        <td className="py-2 pr-2">
                          <p className="text-text-primary truncate">{jc.contractors?.name ?? '—'}</p>
                          {jc.has_compliance_hold && (
                            <p className="text-[9px]" style={{ color: '#FCA5A5' }}>⚠ Compliance hold</p>
                          )}
                        </td>
                        <td className="py-2 pr-2 text-text-primary text-[12px]">
                          {jc.agreed_amount != null ? `R${jc.agreed_amount.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-2">
                          <button
                            onClick={() => handleRemoveContractor(jc.id)}
                            className="text-text-secondary hover:text-error w-9 h-8 text-[13px] transition-colors"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {jobContractors.length === 0 && (
              <p className="text-text-secondary text-[12px]">No contractors assigned yet.</p>
            )}

            <button
              onClick={() => { setShowContractorModal(true); setContractorSearch(''); setSelectedContractorId(''); setAgreedAmount('') }}
              className="h-10 px-4 text-[13px] rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-primary transition-colors"
            >
              + Assign Contractor
            </button>
          </div>

          <button
            onClick={handleSaveTeam}
            disabled={saving}
            className="w-full h-11 text-[13px] rounded-lg bg-primary text-white font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
            Save team & contractor
          </button>
        </div>
      </div>

      {/* ── Cost breakdown ── */}
      <div className="bg-surface rounded-xl p-4 border border-divider space-y-2">
        <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase mb-3">Cost Breakdown</p>
        <div className="flex justify-between">
          <span className="text-[13px] text-text-primary">Labor</span>
          <span className="text-[13px] text-text-primary">R{(job.labor_cost ?? laborTotal).toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[13px] text-text-primary">Inventory</span>
          <span className="text-[13px] text-text-primary">R{(job.inventory_cost ?? inventoryTotal).toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[13px] text-text-primary">Actual</span>
          <span className="text-[13px] text-text-primary">R{(job.actual_cost ?? 0).toFixed(2)}</span>
        </div>
        <div className="border-t border-divider pt-2 flex justify-between">
          <span className="text-[13px] font-semibold text-text-primary">Total</span>
          <span className="text-[13px] font-semibold text-primary">R{totalCost.toFixed(2)}</span>
        </div>
      </div>

      {/* ── Labor entries ── */}
      <div className="bg-surface rounded-xl p-4 border border-divider space-y-2">
        <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase mb-1">Labor Entries</p>
        {laborEntries.length === 0 ? (
          <p className="text-text-secondary text-[12px]">No labor entries.</p>
        ) : (
          laborEntries.map(le => (
            <div key={le.id} className="grid grid-cols-[1fr_auto_auto] gap-x-2 py-1 border-b border-divider last:border-0">
              <span className="text-[13px] text-text-primary">{fmtDate(le.work_date)}</span>
              <span className="text-[13px] text-text-secondary">{le.hours}h</span>
              <span className="text-[13px] text-primary">R{le.total_cost.toFixed(2)}</span>
            </div>
          ))
        )}
      </div>

      {/* ── Inventory ── */}
      <div className="bg-surface rounded-xl p-4 border border-divider space-y-2">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase">Inventory</p>
          <button
            onClick={() => { setShowInventoryModal(true); setInventorySearch(''); setSelectedItemId(''); setQuantity('1') }}
            className="h-9 px-3 text-[12px] rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-primary transition-colors"
          >
            + Add
          </button>
        </div>
        {inventoryTotal > 0 && (
          <p className="text-primary text-[12px]">Total inventory cost: R{inventoryTotal.toFixed(2)}</p>
        )}
        {inventory.length === 0 ? (
          <p className="text-text-secondary text-[12px]">No inventory selected yet.</p>
        ) : (
          inventory.map(item => (
            <div key={item.id} className="border-b border-divider pb-2 last:border-0">
              <div className="grid grid-cols-[1fr_auto] gap-x-2">
                <span className="text-[13px] text-text-primary">{item.name}</span>
                <span className="text-[13px] text-primary">R{item.total_cost.toFixed(2)}</span>
              </div>
              <p className="text-[11px] text-text-secondary">
                {item.supplier ? `Supplier: ${item.supplier} · ` : ''}{item.quantity} × R{item.unit_cost.toFixed(2)}
              </p>
            </div>
          ))
        )}
      </div>

      {/* ── Photos ── */}
      <div className="bg-surface rounded-xl p-4 border border-divider space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase">Job Photos</p>
          {photoBusy && <span className="material-icons text-[16px] text-text-secondary animate-spin">refresh</span>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => beforeInputRef.current?.click()}
            disabled={photoBusy}
            className="h-10 px-[14px] text-[12px] rounded-lg bg-primary text-white font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
            Upload Before
          </button>
          <button
            onClick={() => afterInputRef.current?.click()}
            disabled={photoBusy}
            className="h-10 px-[14px] text-[12px] rounded-lg border border-primary text-primary font-semibold hover:bg-primary/5 disabled:opacity-50 transition-colors"
          >
            Upload After
          </button>
        </div>

        <input ref={beforeInputRef} type="file" accept="image/*" className="hidden"
          onChange={async e => {
            const file = e.target.files?.[0]
            if (file) { await uploadPhoto('before', file); e.target.value = '' }
          }} />
        <input ref={afterInputRef} type="file" accept="image/*" className="hidden"
          onChange={async e => {
            const file = e.target.files?.[0]
            if (file) { await uploadPhoto('after', file); e.target.value = '' }
          }} />

        {beforePhotos.length > 0 && (
          <div className="space-y-1">
            <p className="text-[12px] font-semibold text-text-primary">Before</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {beforePhotos.map(p => (
                <img key={p.id} src={p.url} alt="Before"
                  className="w-[72px] h-[72px] object-cover rounded-lg shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => window.open(p.url, '_blank')} />
              ))}
            </div>
          </div>
        )}
        {afterPhotos.length > 0 && (
          <div className="space-y-1">
            <p className="text-[12px] font-semibold" style={{ color: '#22C55E' }}>After</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {afterPhotos.map(p => (
                <img key={p.id} src={p.url} alt="After"
                  className="w-[72px] h-[72px] object-cover rounded-lg shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => window.open(p.url, '_blank')} />
              ))}
            </div>
          </div>
        )}
        {photos.length === 0 && !photoBusy && (
          <p className="text-text-secondary text-[12px]">No photos uploaded yet.</p>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* Assign Contractor Modal                                               */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {showContractorModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface rounded-xl w-full max-w-md p-5 space-y-4 shadow-xl">
            <h2 className="text-[16px] font-semibold text-text-primary">Assign Contractor</h2>

            <input
              type="text"
              placeholder="Search contractors…"
              value={contractorSearch}
              onChange={e => setContractorSearch(e.target.value)}
              className={inputCls}
              autoFocus
            />

            <div className="max-h-[200px] overflow-y-auto space-y-0.5 border border-divider rounded-lg p-1">
              {filteredContractors.length === 0 ? (
                <p className="text-[12px] text-text-disabled px-2 py-2">No contractors found</p>
              ) : (
                filteredContractors.map(c => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 px-2 py-2 cursor-pointer hover:bg-background rounded-lg transition-colors"
                  >
                    <input
                      type="radio"
                      name="contractor"
                      checked={selectedContractorId === c.id}
                      onChange={() => setSelectedContractorId(c.id)}
                      className="accent-primary"
                    />
                    <span className="text-[13px] text-text-primary flex-1">{c.name}</span>
                    {c.contractor_code && (
                      <span className="text-[11px] text-text-secondary">{c.contractor_code}</span>
                    )}
                  </label>
                ))
              )}
            </div>

            <input
              type="number"
              placeholder="Agreed amount (R)"
              value={agreedAmount}
              onChange={e => setAgreedAmount(e.target.value)}
              className={inputCls}
              min="0"
              step="0.01"
            />

            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setShowContractorModal(false)}
                className="h-10 px-4 rounded-lg border border-border text-[13px] text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={assignContractor}
                disabled={!selectedContractorId || saving}
                className="h-10 px-5 rounded-lg bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
              >
                {saving ? 'Assigning…' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* Add Inventory Modal                                                   */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {showInventoryModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface rounded-xl w-full max-w-md p-5 space-y-4 shadow-xl">
            <h2 className="text-[16px] font-semibold text-text-primary">Add Inventory Item</h2>

            <input
              type="text"
              placeholder="Search items…"
              value={inventorySearch}
              onChange={e => setInventorySearch(e.target.value)}
              className={inputCls}
              autoFocus
            />

            <div className="max-h-[200px] overflow-y-auto space-y-0.5 border border-divider rounded-lg p-1">
              {filteredInventory.length === 0 ? (
                <p className="text-[12px] text-text-disabled px-2 py-2">No items found</p>
              ) : (
                filteredInventory.map(item => (
                  <label
                    key={item.id}
                    className="flex items-center gap-2 px-2 py-2 cursor-pointer hover:bg-background rounded-lg transition-colors"
                  >
                    <input
                      type="radio"
                      name="inventory"
                      checked={selectedItemId === item.id}
                      onChange={() => setSelectedItemId(item.id)}
                      className="accent-primary"
                    />
                    <span className="text-[13px] text-text-primary flex-1">{item.name}</span>
                    <span className="text-[11px] text-text-secondary">
                      {item.unit_cost != null ? `R${item.unit_cost.toFixed(2)}` : '—'}
                      {item.quantity_on_hand != null ? ` · ${item.quantity_on_hand} in stock` : ''}
                    </span>
                  </label>
                ))
              )}
            </div>

            <div>
              <label className="text-[11px] text-text-secondary mb-1 block">Quantity</label>
              <input
                type="number"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                className={inputCls}
                min="1"
                step="1"
              />
            </div>

            {selectedItemId && (() => {
              const item = allInventory.find(i => i.id === selectedItemId)
              const qty  = parseFloat(quantity) || 1
              const cost = (item?.unit_cost ?? 0) * qty
              return cost > 0 ? (
                <p className="text-[12px] text-primary">
                  Total: R{cost.toFixed(2)} ({qty} × R{(item?.unit_cost ?? 0).toFixed(2)})
                </p>
              ) : null
            })()}

            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setShowInventoryModal(false)}
                className="h-10 px-4 rounded-lg border border-border text-[13px] text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={allocateInventory}
                disabled={!selectedItemId || saving}
                className="h-10 px-5 rounded-lg bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
              >
                {saving ? 'Adding…' : 'Add to Job'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
