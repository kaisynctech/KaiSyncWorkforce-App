'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { FormSelect } from '@/components/FormSelect'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { Project } from '@/types/database'

const STATUS_FILTERS = ['all', 'draft', 'sent', 'in_progress', 'won', 'lost'] as const
const STATUS_LABELS: Record<string, string> = {
  all: 'All', draft: 'Draft', sent: 'Sent', in_progress: 'In progress', won: 'Won', lost: 'Lost',
}
const STATUS_OPTIONS = ['draft', 'sent', 'in_progress', 'won', 'lost']
const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft:       { bg: '#E5E7EB', fg: '#6B7280' },
  sent:        { bg: '#DBEAFE', fg: '#1E40AF' },
  in_progress: { bg: '#FEF3C7', fg: '#92400E' },
  won:         { bg: '#DCFCE7', fg: '#166534' },
  lost:        { bg: '#FEE2E2', fg: '#991B1B' },
}

const fmtCurrency = (n: number | null) =>
  n != null ? `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 0 })}` : '—'

export default function ProjectsPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<'all' | 'mine'>('all')
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)

  useEffect(() => { load() }, [scope])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)
    setMyEmployeeId(member.employeeId)

    let query = supabase
      .from('client_deals')
      .select('*, clients(id, name), employees(id, name, surname)')
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })

    if (scope === 'mine') {
      query = query.eq('assignee_employee_id', member.employeeId)
    }

    const { data } = await query
    setProjects((data ?? []) as Project[])
    setLoading(false)
  }

  async function updateStatus(p: Project, newStatus: string) {
    if (!companyId) return
    const supabase = createClient()
    await supabase.from('client_deals').update({ status: newStatus }).eq('id', p.id).eq('company_id', companyId)
    setProjects(prev => prev.map(x => x.id === p.id ? { ...x, status: newStatus } : x))
  }

  const filtered = projects.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (searchText) {
      const q = searchText.toLowerCase()
      if (
        !(p.name ?? '').toLowerCase().includes(q) &&
        !(p.code ?? '').toLowerCase().includes(q) &&
        !(p.clients?.name ?? '').toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[20px] font-semibold text-text-primary">Projects</h1>
        <div className="flex gap-2">
          <button onClick={load} className="btn-outlined h-9 px-3 text-[13px]">Export</button>
          <button onClick={() => router.push('/dashboard/projects/new')} className="btn-primary h-9 px-3 text-[13px]">+ Project</button>
        </div>
      </div>

      {/* Scope toggle */}
      <div className="grid grid-cols-2 gap-2 mx-4 mt-3">
        <button onClick={() => setScope('all')} className="h-[34px] rounded-[10px] text-[12px] font-medium"
          style={{ backgroundColor: scope === 'all' ? '#3B82F6' : '#FFFFFF', color: scope === 'all' ? '#FFFFFF' : '#6B7280' }}>
          All Projects ({projects.length})
        </button>
        <button onClick={() => setScope('mine')} className="h-[34px] rounded-[10px] text-[12px] font-medium"
          style={{ backgroundColor: scope === 'mine' ? '#3B82F6' : '#FFFFFF', color: scope === 'mine' ? '#FFFFFF' : '#6B7280' }}>
          My Projects
        </button>
      </div>

      <p className="text-text-secondary text-[12px] mx-4 mt-1.5">{filtered.length} project{filtered.length !== 1 ? 's' : ''}</p>

      {/* Search */}
      <div className="mx-4 mt-1">
        <input type="search" placeholder="Search code, title, client…"
          className="w-full bg-surface border border-border text-text-primary placeholder:text-text-disabled rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
          value={searchText} onChange={e => setSearchText(e.target.value)} />
      </div>

      {/* Status filter chips */}
      <div className="overflow-x-auto shrink-0 mt-1">
        <div className="flex gap-2 px-4 py-1">
          {STATUS_FILTERS.map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className="h-[30px] rounded-2xl px-3 text-[11px] whitespace-nowrap shrink-0"
              style={{ backgroundColor: statusFilter === f ? '#3B82F6' : '#FFFFFF', color: statusFilter === f ? '#FFFFFF' : '#6B7280' }}>
              {STATUS_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto mx-4 mb-4 bg-surface rounded-lg border border-divider">
          <table style={{ minWidth: 800 }} className="w-full">
            <thead>
              <tr className="bg-[#1E293B]">
                <th style={{ width:  72 }} className="data-th pl-2 text-white/70">Code</th>
                <th                        className="data-th text-white/70">Project</th>
                <th style={{ width:  88 }} className="data-th text-white/70">Client</th>
                <th style={{ width: 108 }} className="data-th text-white/70">Manager</th>
                <th style={{ width: 128 }} className="data-th text-white/70">Status</th>
                <th style={{ width:  92 }} className="data-th text-right text-white/70">Offer</th>
                <th style={{ width:  84 }} className="data-th text-right text-white/70">Paid</th>
                <th style={{ width:  56 }} className="data-th text-right text-white/70">%</th>
                <th style={{ width:  72 }} className="data-th text-center pr-2 text-white/70">Pay</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="py-12 text-center text-[13px] text-text-disabled">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="py-8 text-center text-[13px] text-text-secondary">
                  No projects match this view. Try All projects or adjust filters.
                </td></tr>
              ) : (
                filtered.map(p => {
                  const sc = STATUS_COLORS[p.status ?? 'draft'] ?? STATUS_COLORS.draft
                  const progress = p.offer_amount && p.paid_amount
                    ? Math.round((p.paid_amount / p.offer_amount) * 100)
                    : 0
                  const managerName = p.employees
                    ? `${p.employees.name} ${p.employees.surname}`
                    : '—'
                  return (
                    <tr key={p.id} className="bg-surface border-b border-divider hover:bg-background transition-colors">
                      <td className="data-td pl-2">
                        <button onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                          className="text-text-primary text-[12px] font-medium hover:text-primary transition-colors">
                          {p.code ?? '—'}
                        </button>
                      </td>
                      <td className="data-td">
                        <button onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                          className="text-left text-text-primary text-[13px] font-medium truncate w-full hover:text-primary transition-colors">
                          {p.name}
                        </button>
                      </td>
                      <td className="data-td text-text-secondary text-[12px] truncate">{p.clients?.name ?? '—'}</td>
                      <td className="data-td text-text-secondary text-[12px] truncate">{managerName}</td>
                      <td className="data-td">
                        <select
                          value={p.status ?? 'draft'}
                          onChange={e => updateStatus(p, e.target.value)}
                          className="text-[11px] h-8 px-2 rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 w-full"
                          style={{ color: sc.fg }}
                        >
                          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                        </select>
                      </td>
                      <td className="data-td text-text-secondary text-[12px] text-right">{fmtCurrency(p.offer_amount)}</td>
                      <td className="data-td text-text-secondary text-[12px] text-right">{fmtCurrency(p.paid_amount)}</td>
                      <td className="data-td text-text-primary font-semibold text-[12px] text-right">{progress}%</td>
                      <td className="data-td text-center pr-2">
                        <button className="bg-primary text-white rounded-lg h-7 px-2 text-[10px] font-medium">+ Pay</button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
