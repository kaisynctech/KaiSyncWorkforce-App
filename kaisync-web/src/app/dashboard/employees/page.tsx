'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getInitials } from '@/lib/utils'
import type { Employee, AccessLevel, LeaveRequest, WorkTeam } from '@/types/database'

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCESS_BADGES: Record<AccessLevel, { label: string; cls: string }> = {
  owner:    { label: 'Owner',    cls: 'bg-primary/10 text-primary' },
  manager:  { label: 'Manager',  cls: 'bg-warning-dark text-warning' },
  hr:       { label: 'HR',       cls: 'bg-accent-light/30 text-primary-dark' },
  employee: { label: 'Employee', cls: 'bg-success-dark text-success' },
}

const LEAVE_DEFAULTS: Record<string, number> = {
  annual_leave:          15,
  sick_leave:            30,
  family_responsibility:  3,
  maternity_leave:       90,
  study_leave:            5,
}

// ─── Local types ──────────────────────────────────────────────────────────────

type Tab = 'employees' | 'teams' | 'leave' | 'pending'

type Branch = { id: string; name: string }

type OnLeaveRecord = {
  employee_id: string
  leave_type: string
  end_date: string
  employees: { name: string; surname: string } | null
}

type LeaveBalance = {
  employeeId: string
  employeeName: string
  leaveType: string
  annualDays: number
  usedDays: number
  remaining: number
  lastRequestDate: string | null
}

type PendingEmployee = {
  id: string
  name: string
  surname: string
  email: string | null
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildLeaveBalances(
  employees: Employee[],
  requests: Pick<LeaveRequest, 'employee_id' | 'leave_type' | 'days_requested' | 'start_date'>[]
): LeaveBalance[] {
  const empMap = new Map(employees.map(e => [e.id, `${e.name} ${e.surname}`.trim()]))

  const groups = new Map<string, {
    employeeId: string
    employeeName: string
    leaveType: string
    usedDays: number
    lastDate: string | null
  }>()

  for (const req of requests) {
    const key      = `${req.employee_id}::${req.leave_type}`
    const existing = groups.get(key)
    const empName  = empMap.get(req.employee_id) ?? 'Unknown'
    if (!existing) {
      groups.set(key, {
        employeeId:  req.employee_id,
        employeeName: empName,
        leaveType:   req.leave_type,
        usedDays:    req.days_requested,
        lastDate:    req.start_date,
      })
    } else {
      existing.usedDays += req.days_requested
      if (!existing.lastDate || req.start_date > existing.lastDate) {
        existing.lastDate = req.start_date
      }
    }
  }

  return Array.from(groups.values())
    .map(g => {
      const annualDays = LEAVE_DEFAULTS[g.leaveType] ?? 5
      return {
        employeeId:      g.employeeId,
        employeeName:    g.employeeName,
        leaveType:       g.leaveType,
        annualDays,
        usedDays:        g.usedDays,
        remaining:       Math.max(0, annualDays - g.usedDays),
        lastRequestDate: g.lastDate,
      }
    })
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
}

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function returnDate(endDate: string) {
  const [y, m, d] = endDate.split('-').map(Number)
  return new Date(y, m - 1, d + 1).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeesPage() {
  const router = useRouter()

  // ── Core ──────────────────────────────────────────────────────────────────
  const [companyId,      setCompanyId]      = useState<string | null>(null)
  const [myAccessLevel,  setMyAccessLevel]  = useState<AccessLevel | null>(null)
  const [tab,            setTab]            = useState<Tab>('employees')
  const [error,          setError]          = useState<string | null>(null)

  // ── Tab 1 — Employees ─────────────────────────────────────────────────────
  const [employees,     setEmployees]     = useState<Employee[]>([])
  const [branches,      setBranches]      = useState<Branch[]>([])
  const [onLeave,       setOnLeave]       = useState<OnLeaveRecord[]>([])
  const [empLoading,    setEmpLoading]    = useState(true)
  const [showOnLeave,   setShowOnLeave]   = useState(true)
  const [search,        setSearch]        = useState('')
  const [filterRole,    setFilterRole]    = useState<AccessLevel | ''>('')
  const [filterStatus,  setFilterStatus]  = useState<'active' | 'inactive' | ''>('')
  const [filterBranch,  setFilterBranch]  = useState('')
  const [filterEmpType, setFilterEmpType] = useState('')

  // ── Tab 2 — Teams ─────────────────────────────────────────────────────────
  const [teams,          setTeams]          = useState<WorkTeam[]>([])
  const [teamsLoading,   setTeamsLoading]   = useState(false)
  const [teamsLoaded,    setTeamsLoaded]    = useState(false)
  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [newTeamName,    setNewTeamName]    = useState('')
  const [teamBusy,       setTeamBusy]       = useState(false)

  // ── Tab 3 — Leave ─────────────────────────────────────────────────────────
  const [leaveBalances,   setLeaveBalances]   = useState<LeaveBalance[]>([])
  const [pendingLeave,    setPendingLeave]    = useState<LeaveRequest[]>([])
  const [leaveLoading,    setLeaveLoading]    = useState(false)
  const [leaveLoaded,     setLeaveLoaded]     = useState(false)
  const [leaveSearch,     setLeaveSearch]     = useState('')
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('')
  const [leaveSubTab,     setLeaveSubTab]     = useState<'pending' | 'balances'>('pending')
  const [leaveActionBusy, setLeaveActionBusy] = useState<string | null>(null)

  // ── Tab 4 — Pending ───────────────────────────────────────────────────────
  const [pending,        setPending]        = useState<PendingEmployee[]>([])
  const [pendingLoading, setPendingLoading] = useState(false)
  const [pendingLoaded,  setPendingLoaded]  = useState(false)
  const [pendingBusy,    setPendingBusy]    = useState<string | null>(null)

  // ── Init & lazy loading ───────────────────────────────────────────────────
  useEffect(() => { init() }, [])

  useEffect(() => {
    if (!companyId) return
    if (tab === 'teams'   && !teamsLoaded)   loadTeams()
    if (tab === 'leave'   && !leaveLoaded)   loadLeave()
    if (tab === 'pending' && !pendingLoaded) loadPending()
  }, [tab, companyId])

  async function init() {
    const supabase = createClient()
    const member   = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setEmpLoading(false); return }

    setCompanyId(member.companyId)

    const today = new Date().toISOString().split('T')[0]
    const [meRes, empRes, branchRes, onLeaveRes] = await Promise.all([
      supabase.from('employees')
        .select('access_level')
        .eq('id', member.employeeId)
        .single(),
      supabase.from('employees')
        .select('*')
        .eq('company_id', member.companyId)
        .order('name'),
      supabase.from('branches')
        .select('id, name')
        .eq('company_id', member.companyId)
        .order('name'),
      supabase.from('leave_requests')
        .select('employee_id, leave_type, end_date, employees(name, surname)')
        .eq('company_id', member.companyId)
        .eq('status', 'approved')
        .lte('start_date', today)
        .gte('end_date', today),
    ])

    setMyAccessLevel(
      (meRes.data as { access_level: AccessLevel } | null)?.access_level ?? null
    )
    setEmployees((empRes.data ?? []) as Employee[])
    setBranches((branchRes.data ?? []) as Branch[])
    setOnLeave((onLeaveRes.data ?? []) as unknown as OnLeaveRecord[])
    setEmpLoading(false)
  }

  // ── Tab 2 ─────────────────────────────────────────────────────────────────
  async function loadTeams() {
    if (!companyId) return
    setTeamsLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('work_teams')
      .select('*')
      .eq('company_id', companyId)
      .order('name')
    setTeams((data ?? []) as WorkTeam[])
    setTeamsLoaded(true)
    setTeamsLoading(false)
  }

  async function createTeam() {
    if (!newTeamName.trim() || !companyId) return
    setTeamBusy(true)
    const supabase = createClient()
    await (supabase.from('work_teams') as ReturnType<typeof supabase.from>).insert({
      company_id: companyId,
      name: newTeamName.trim(),
      is_active: true,
    })
    setNewTeamName('')
    setShowCreateTeam(false)
    setTeamBusy(false)
    setTeamsLoaded(false)
    await loadTeams()
  }

  // ── Tab 3 ─────────────────────────────────────────────────────────────────
  async function loadLeave() {
    if (!companyId) return
    setLeaveLoading(true)
    const supabase  = createClient()
    const yearStart = `${new Date().getFullYear()}-01-01`

    const [{ data }, { data: pendingData }] = await Promise.all([
      supabase
        .from('leave_requests')
        .select('employee_id, leave_type, days_requested, start_date')
        .eq('company_id', companyId)
        .eq('status', 'approved')
        .gte('start_date', yearStart)
        .order('start_date', { ascending: false }),
      supabase
        .from('leave_requests')
        .select('*, employees(name, surname, employee_code)')
        .eq('company_id', companyId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
    ])

    setLeaveBalances(
      buildLeaveBalances(
        employees,
        (data ?? []) as Pick<LeaveRequest, 'employee_id' | 'leave_type' | 'days_requested' | 'start_date'>[]
      )
    )
    setPendingLeave((pendingData ?? []) as LeaveRequest[])
    setLeaveLoaded(true)
    setLeaveLoading(false)
  }

  async function decideLeave(requestId: string, decision: 'approved' | 'declined') {
    if (!companyId) return
    setLeaveActionBusy(requestId)
    const supabase = createClient()
    await supabase.rpc('decide_leave_request', {
      p_company_id: companyId,
      p_leave_request_id: requestId,
      p_decision: decision,
      p_note: null,
    })
    setLeaveActionBusy(null)
    setLeaveLoaded(false)
    await loadLeave()
  }

  // ── Tab 4 ─────────────────────────────────────────────────────────────────
  async function loadPending() {
    if (!companyId) return
    setPendingLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('employees')
      .select('id, name, surname, email, created_at')
      .eq('company_id', companyId)
      .eq('registration_status', 'pending')
      .order('created_at', { ascending: false })
    setPending((data ?? []) as PendingEmployee[])
    setPendingLoaded(true)
    setPendingLoading(false)
  }

  async function approvePending(employeeId: string) {
    setPendingBusy(employeeId)
    const supabase = createClient()
    await supabase.rpc('approve_pending_employee', { p_employee_id: employeeId })
    setPendingBusy(null)
    setPendingLoaded(false)
    await loadPending()
  }

  async function rejectPending(employeeId: string) {
    setPendingBusy(employeeId)
    const supabase = createClient()
    await supabase.rpc('reject_pending_employee', { p_employee_id: employeeId })
    setPendingBusy(null)
    setPendingLoaded(false)
    await loadPending()
  }

  async function approveAll() {
    if (!pending.length) return
    setPendingBusy('all')
    const supabase = createClient()
    for (const emp of pending) {
      await supabase.rpc('approve_pending_employee', { p_employee_id: emp.id })
    }
    setPendingBusy(null)
    setPendingLoaded(false)
    await loadPending()
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const canSeeLeave = myAccessLevel !== null && ['owner', 'hr'].includes(myAccessLevel)

  const TABS: { key: Tab; label: string }[] = [
    { key: 'employees', label: 'Employees' },
    { key: 'teams',     label: 'Teams' },
    ...(canSeeLeave ? [{
      key: 'leave' as Tab,
      label: leaveLoaded && pendingLeave.length > 0
        ? `Leave (${pendingLeave.length})`
        : 'Leave',
    }] : []),
    {
      key:   'pending',
      label: pendingLoaded && pending.length > 0 ? `Pending (${pending.length})` : 'Pending',
    },
  ]

  const filteredEmployees = employees.filter(e => {
    if (filterRole    && e.access_level    !== filterRole)    return false
    if (filterBranch  && e.branch_id       !== filterBranch)  return false
    if (filterEmpType && e.employment_type !== filterEmpType) return false
    if (filterStatus === 'active'   && !e.is_active) return false
    if (filterStatus === 'inactive' &&  e.is_active) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        e.name.toLowerCase().includes(q) ||
        e.surname.toLowerCase().includes(q) ||
        (e.employee_code ?? '').toLowerCase().includes(q) ||
        (e.department ?? '').toLowerCase().includes(q) ||
        (e.position ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  const leaveTypes = Array.from(new Set(leaveBalances.map(b => b.leaveType))).sort()

  const filteredLeave = leaveBalances.filter(b => {
    if (leaveTypeFilter && b.leaveType !== leaveTypeFilter) return false
    if (leaveSearch) {
      return b.employeeName.toLowerCase().includes(leaveSearch.toLowerCase())
    }
    return true
  })

  // ── Not-linked guard ──────────────────────────────────────────────────────
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-semibold text-text-primary">Employees</h1>
          <p className="text-[13px] text-text-secondary mt-0.5">{employees.length} total</p>
        </div>
        <Link
          href="/dashboard/employees/new"
          className="flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark transition-colors"
        >
          <span className="material-icons text-[18px]">person_add</span>
          Add Employee
        </Link>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 border-b border-divider">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`h-10 px-4 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* Tab 1 — Employees                                                   */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'employees' && (
        <>
          {/* Filter toolbar */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <div className="flex items-center gap-2 h-10 px-3 bg-surface border border-border rounded-md flex-1 min-w-[200px]">
              <span className="material-icons text-text-disabled text-[18px]">search</span>
              <input
                type="text"
                placeholder="Search by name, code, department…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
              />
            </div>
            <select
              value={filterRole}
              onChange={e => setFilterRole(e.target.value as AccessLevel | '')}
              className="h-10 px-3 bg-surface border border-border rounded-md text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none"
            >
              <option value="">All roles</option>
              <option value="owner">Owner</option>
              <option value="manager">Manager</option>
              <option value="hr">HR</option>
              <option value="employee">Employee</option>
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as 'active' | 'inactive' | '')}
              className="h-10 px-3 bg-surface border border-border rounded-md text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select
              value={filterEmpType}
              onChange={e => setFilterEmpType(e.target.value)}
              className="h-10 px-3 bg-surface border border-border rounded-md text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none"
            >
              <option value="">All types</option>
              <option value="permanent">Permanent</option>
              <option value="contract">Contract</option>
              <option value="part_time">Part-time</option>
              <option value="student">Student</option>
            </select>
          </div>

          {/* Branch filter pills */}
          {branches.length > 0 && (
            <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
              <button
                onClick={() => setFilterBranch('')}
                className={`shrink-0 h-7 px-3 rounded-full text-[11px] font-medium transition-colors ${
                  filterBranch === ''
                    ? 'bg-primary text-white'
                    : 'bg-surface border border-border text-text-secondary hover:text-text-primary'
                }`}
              >
                All Branches
              </button>
              {branches.map(b => (
                <button
                  key={b.id}
                  onClick={() => setFilterBranch(b.id)}
                  className={`shrink-0 h-7 px-3 rounded-full text-[11px] font-medium transition-colors ${
                    filterBranch === b.id
                      ? 'bg-primary text-white'
                      : 'bg-surface border border-border text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}

          {/* On Leave Today */}
          {onLeave.length > 0 && (
            <div className="mb-4 bg-surface border border-divider rounded-lg overflow-hidden">
              <button
                onClick={() => setShowOnLeave(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-background transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="material-icons text-[18px] text-warning">event_busy</span>
                  <span className="text-[13px] font-medium text-text-primary">
                    On Leave Today ({onLeave.length})
                  </span>
                </div>
                <span className="material-icons text-[18px] text-text-secondary">
                  {showOnLeave ? 'expand_less' : 'expand_more'}
                </span>
              </button>
              {showOnLeave && (
                <div className="border-t border-divider divide-y divide-divider">
                  {onLeave.map((r, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <span className="text-[13px] font-medium text-text-primary">
                          {r.employees ? `${r.employees.name} ${r.employees.surname}` : 'Unknown'}
                        </span>
                        <span className="text-[12px] text-text-secondary ml-2">
                          — {r.leave_type.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <span className="text-[11px] text-text-secondary">
                        back {returnDate(r.end_date)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Employee table */}
          <div className="bg-surface rounded-lg border border-divider overflow-hidden">
            {empLoading ? (
              <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
            ) : filteredEmployees.length === 0 ? (
              <div className="py-16 text-center">
                <span className="material-icons text-[48px] text-text-disabled block mb-2">people_outline</span>
                <p className="text-[14px] text-text-secondary">No employees found</p>
                <Link href="/dashboard/employees/new" className="mt-3 inline-block text-primary text-[13px] hover:underline">
                  + Add your first employee
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-divider bg-surface-elevated">
                      <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Employee</th>
                      <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Code</th>
                      <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Role</th>
                      <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Department</th>
                      <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map(emp => {
                      const badge = ACCESS_BADGES[emp.access_level]
                      return (
                        <tr
                          key={emp.id}
                          className="border-b border-divider last:border-0 hover:bg-background transition-colors cursor-pointer"
                          onClick={() => router.push(`/dashboard/employees/${emp.id}`)}
                        >
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                <span className="text-primary text-[12px] font-semibold">
                                  {getInitials(`${emp.name} ${emp.surname}`)}
                                </span>
                              </div>
                              <div>
                                <p className="font-medium text-text-primary">{emp.name} {emp.surname}</p>
                                {emp.position && (
                                  <p className="text-[11px] text-text-secondary">{emp.position}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-text-secondary font-mono">
                            {emp.employee_code ?? '—'}
                          </td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium ${badge.cls}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-text-secondary">
                            {emp.department ?? '—'}
                          </td>
                          <td className="px-5 py-3">
                            <span className={`flex items-center gap-1 text-[12px] font-medium w-fit ${
                              emp.is_active ? 'text-success' : 'text-text-disabled'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                emp.is_active ? 'bg-success' : 'bg-text-disabled'
                              }`} />
                              {emp.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* Tab 2 — Teams                                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'teams' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] text-text-secondary">{teams.length} team{teams.length !== 1 ? 's' : ''}</p>
            <button
              onClick={() => setShowCreateTeam(true)}
              className="flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark transition-colors"
            >
              <span className="material-icons text-[18px]">group_add</span>
              + Create Team
            </button>
          </div>

          {/* Create team modal */}
          {showCreateTeam && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
              <div className="bg-surface rounded-xl shadow-xl w-full max-w-sm p-6">
                <h2 className="text-[18px] font-semibold text-text-primary mb-4">New Team</h2>
                <input
                  type="text"
                  placeholder="Team name…"
                  value={newTeamName}
                  autoFocus
                  onChange={e => setNewTeamName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createTeam()}
                  className="w-full h-10 px-3 bg-background border border-border rounded-md text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 mb-4"
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowCreateTeam(false); setNewTeamName('') }}
                    className="flex-1 h-10 rounded-md border border-border text-[13px] text-text-secondary hover:bg-background transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createTeam}
                    disabled={!newTeamName.trim() || teamBusy}
                    className="flex-1 h-10 rounded-md bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
                  >
                    {teamBusy ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {teamsLoading ? (
            <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
          ) : teams.length === 0 ? (
            <div className="py-16 text-center">
              <span className="material-icons text-[48px] text-text-disabled block mb-2">groups</span>
              <p className="text-[14px] text-text-secondary">No teams yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="bg-surface rounded-lg border border-divider overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface-elevated">
                    <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Team</th>
                    <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Members</th>
                    <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map(team => (
                    <tr
                      key={team.id}
                      className="border-b border-divider last:border-0 hover:bg-background transition-colors cursor-pointer"
                      onClick={() => router.push(`/dashboard/work-teams/${team.id}`)}
                    >
                      <td className="px-5 py-3">
                        <p className="font-medium text-text-primary">{team.name}</p>
                        {team.description && (
                          <p className="text-[11px] text-text-secondary">{team.description}</p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-text-secondary">
                        {team.member_count} {team.member_count === 1 ? 'member' : 'members'}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`flex items-center gap-1 text-[12px] font-medium w-fit ${
                          team.is_active ? 'text-success' : 'text-text-disabled'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            team.is_active ? 'bg-success' : 'bg-text-disabled'
                          }`} />
                          {team.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* Tab 3 — Leave (admin-gated)                                          */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'leave' && (
        <>
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setLeaveSubTab('pending')}
              className={`h-8 px-3 rounded-2xl text-[12px] font-medium ${
                leaveSubTab === 'pending' ? 'bg-primary text-white' : 'bg-surface border border-border text-text-secondary'
              }`}
            >
              Pending ({pendingLeave.length})
            </button>
            <button
              onClick={() => setLeaveSubTab('balances')}
              className={`h-8 px-3 rounded-2xl text-[12px] font-medium ${
                leaveSubTab === 'balances' ? 'bg-primary text-white' : 'bg-surface border border-border text-text-secondary'
              }`}
            >
              Balances
            </button>
          </div>

          {leaveSubTab === 'pending' ? (
            <div className="bg-surface rounded-lg border border-divider overflow-hidden">
              {leaveLoading ? (
                <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
              ) : pendingLeave.length === 0 ? (
                <div className="py-16 text-center">
                  <span className="material-icons text-[48px] text-text-disabled block mb-2">beach_access</span>
                  <p className="text-[14px] text-text-secondary">No pending leave requests</p>
                </div>
              ) : (
                <div className="divide-y divide-divider">
                  {pendingLeave.map(req => {
                    const emp = req.employees as { name: string; surname: string; employee_code?: string } | undefined
                    const name = emp ? `${emp.name} ${emp.surname}` : 'Employee'
                    return (
                      <div key={req.id} className="flex items-center gap-4 px-5 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-text-primary truncate">{name}</p>
                          <p className="text-[12px] text-text-secondary capitalize">
                            {req.leave_type.replace(/_/g, ' ')} · {fmtDate(req.start_date)}
                            {req.end_date ? ` – ${fmtDate(req.end_date)}` : ''}
                            {req.days_requested != null ? ` · ${req.days_requested}d` : ''}
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => decideLeave(req.id, 'declined')}
                            disabled={leaveActionBusy === req.id}
                            className="h-8 px-3 rounded-md text-[12px] font-medium bg-error-dark text-error hover:bg-red-100 transition-colors disabled:opacity-50"
                          >
                            {leaveActionBusy === req.id ? '…' : 'Decline'}
                          </button>
                          <button
                            onClick={() => decideLeave(req.id, 'approved')}
                            disabled={leaveActionBusy === req.id}
                            className="h-8 px-3 rounded-md text-[12px] font-medium bg-success-dark text-success hover:bg-green-100 transition-colors disabled:opacity-50"
                          >
                            {leaveActionBusy === req.id ? '…' : 'Approve'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="flex items-center gap-2 h-10 px-3 bg-surface border border-border rounded-md flex-1 min-w-[200px]">
                  <span className="material-icons text-text-disabled text-[18px]">search</span>
                  <input
                    type="text"
                    placeholder="Search employee…"
                    value={leaveSearch}
                    onChange={e => setLeaveSearch(e.target.value)}
                    className="flex-1 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
                  />
                </div>
                <select
                  value={leaveTypeFilter}
                  onChange={e => setLeaveTypeFilter(e.target.value)}
                  className="h-10 px-3 bg-surface border border-border rounded-md text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none"
                >
                  <option value="">All leave types</option>
                  {leaveTypes.map(lt => (
                    <option key={lt} value={lt}>{lt.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>

              <div className="bg-surface rounded-lg border border-divider overflow-hidden">
                {leaveLoading ? (
                  <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
                ) : filteredLeave.length === 0 ? (
                  <div className="py-16 text-center">
                    <span className="material-icons text-[48px] text-text-disabled block mb-2">beach_access</span>
                    <p className="text-[14px] text-text-secondary">No approved leave records for this year</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b border-divider bg-surface-elevated">
                          <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Employee</th>
                          <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Leave Type</th>
                          <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Annual Days</th>
                          <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Used</th>
                          <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Remaining</th>
                          <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Last Request</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLeave.map((b, i) => (
                          <tr key={i} className="border-b border-divider last:border-0">
                            <td className="px-5 py-3 font-medium text-text-primary">{b.employeeName}</td>
                            <td className="px-5 py-3 text-text-secondary capitalize">
                              {b.leaveType.replace(/_/g, ' ')}
                            </td>
                            <td className="px-5 py-3 text-text-secondary text-center">{b.annualDays}</td>
                            <td className="px-5 py-3 text-text-secondary text-center">{b.usedDays}</td>
                            <td className="px-5 py-3 text-center">
                              <span className={`font-semibold ${
                                b.remaining <= 0 ? 'text-error' : b.remaining <= 3 ? 'text-warning' : 'text-success'
                              }`}>
                                {b.remaining}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-text-secondary">
                              {b.lastRequestDate ? fmtDate(b.lastRequestDate) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* Tab 4 — Pending Registrations                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'pending' && (
        <>
          {!pendingLoading && pending.length > 0 && (
            <div className="flex justify-end mb-4">
              <button
                onClick={approveAll}
                disabled={pendingBusy !== null}
                className="h-10 px-4 rounded-md bg-success/10 text-success text-[13px] font-semibold hover:bg-success/20 disabled:opacity-50 transition-colors border border-success/30"
              >
                {pendingBusy === 'all' ? 'Approving all…' : `Approve All (${pending.length})`}
              </button>
            </div>
          )}

          <div className="bg-surface rounded-lg border border-divider overflow-hidden">
            {pendingLoading ? (
              <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
            ) : pending.length === 0 ? (
              <div className="py-16 text-center">
                <span className="material-icons text-[48px] text-text-disabled block mb-2">check_circle</span>
                <p className="text-[14px] text-text-secondary">No pending registrations</p>
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface-elevated">
                    <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Employee</th>
                    <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Email</th>
                    <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Submitted</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(emp => {
                    const isBusy = pendingBusy === emp.id || pendingBusy === 'all'
                    return (
                      <tr key={emp.id} className="border-b border-divider last:border-0">
                        <td className="px-5 py-3 font-medium text-text-primary">
                          {emp.name} {emp.surname}
                        </td>
                        <td className="px-5 py-3 text-text-secondary">{emp.email ?? '—'}</td>
                        <td className="px-5 py-3 text-text-secondary">{fmtDate(emp.created_at)}</td>
                        <td className="px-5 py-3">
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => approvePending(emp.id)}
                              disabled={pendingBusy !== null}
                              className="h-8 px-3 rounded-md bg-success/10 text-success text-[12px] font-semibold hover:bg-success/20 disabled:opacity-50 transition-colors"
                            >
                              {isBusy ? '…' : 'Approve'}
                            </button>
                            <button
                              onClick={() => rejectPending(emp.id)}
                              disabled={pendingBusy !== null}
                              className="h-8 px-3 rounded-md bg-error/10 text-error text-[12px] font-semibold hover:bg-error/20 disabled:opacity-50 transition-colors"
                            >
                              {isBusy ? '…' : 'Reject'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

    </div>
  )
}
