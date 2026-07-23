'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { SectionCard, FormField, entryClass } from '@/components/SectionCard'
import { FormSelect } from '@/components/FormSelect'
import type { Client, Employee } from '@/types/database'

export default function CreateJobPage() {
  const router = useRouter()

  const [companyId, setCompanyId] = useState<string | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [employees, setEmployees] = useState<Pick<Employee, 'id' | 'name' | 'surname'>[]>([])

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [estimatedCost, setEstimatedCost] = useState('')
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')
  const [clientId, setClientId] = useState('')
  const [address, setAddress] = useState('')
  const [assignedEmployeeId, setAssignedEmployeeId] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadContext() }, [])

  async function loadContext() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); return }
    setCompanyId(member.companyId)

    const [cl, emp] = await Promise.all([
      supabase.from('clients').select('id, name, client_code').eq('company_id', member.companyId).order('name'),
      supabase.from('employees').select('id, name, surname')
        .eq('company_id', member.companyId).eq('is_active', true).order('name'),
    ])

    setClients((cl.data ?? []) as Client[])
    setEmployees((emp.data ?? []) as Pick<Employee, 'id' | 'name' | 'surname'>[])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!companyId || !title.trim()) {
      setError('Job title is required.')
      return
    }
    setSaving(true)
    setError(null)

    const scheduledStart = startDate
      ? `${startDate}T${startTime || '00:00'}:00`
      : null
    const scheduledEnd = endDate
      ? `${endDate}T${endTime || '00:00'}:00`
      : null

    const supabase = createClient()
    const { data, error: insertError } = await supabase
      .from('jobs')
      .insert({
        company_id: companyId,
        title: title.trim(),
        description: description.trim() || null,
        priority,
        estimated_cost: estimatedCost ? parseFloat(estimatedCost) : null,
        scheduled_start: scheduledStart,
        scheduled_end: scheduledEnd,
        client_id: clientId || null,
        address: address.trim() || null,
        assigned_employee_id: assignedEmployeeId || null,
        status: 'open',
      })
      .select()
      .single()

    setSaving(false)
    if (insertError) { setError(insertError.message); return }
    router.push('/dashboard/jobs')
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

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-4 max-w-2xl mx-auto pb-8">
      <div className="flex items-center gap-2 mb-1">
        <Link href="/dashboard/jobs" className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <h1 className="text-[19px] font-bold text-text-primary">New Job</h1>
      </div>

      {/* JOB DETAILS */}
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
            placeholder="0.00" step="0.01" min="0" className={entryClass} />
        </FormField>
      </SectionCard>

      {/* SCHEDULE */}
      <SectionCard title="SCHEDULE">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Start date">
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={entryClass} />
          </FormField>
          <FormField label="Start time">
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className={entryClass} />
          </FormField>
          <FormField label="End date">
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={entryClass} />
          </FormField>
          <FormField label="End time">
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className={entryClass} />
          </FormField>
        </div>
      </SectionCard>

      {/* CLIENT */}
      <SectionCard title="CLIENT">
        <FormSelect label="Client" value={clientId} onChange={e => setClientId(e.target.value)}>
          <option value="">No client</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}{c.client_code ? ` (${c.client_code})` : ''}
            </option>
          ))}
        </FormSelect>
        <p className="text-[12px] text-text-disabled">
          + Add new client — coming in Phase 3
        </p>
      </SectionCard>

      {/* LOCATION */}
      <SectionCard title="LOCATION">
        <FormField label="Address">
          <input type="text" value={address} onChange={e => setAddress(e.target.value)}
            placeholder="Full address or description" className={entryClass} />
        </FormField>
      </SectionCard>

      {/* ASSIGNMENT */}
      <SectionCard title="ASSIGNMENT">
        <FormSelect label="Assign to employee" value={assignedEmployeeId}
          onChange={e => setAssignedEmployeeId(e.target.value)}>
          <option value="">Unassigned</option>
          {employees.map(emp => (
            <option key={emp.id} value={emp.id}>{emp.name} {emp.surname}</option>
          ))}
        </FormSelect>
      </SectionCard>

      {error && <p className="text-error text-[13px] px-1">{error}</p>}

      <button
        type="submit"
        disabled={saving || !title.trim()}
        className="w-full h-[52px] bg-primary text-white rounded-md font-semibold text-[15px] hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {saving ? 'Creating…' : 'Create Job'}
      </button>
    </form>
  )
}
