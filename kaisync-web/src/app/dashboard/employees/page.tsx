'use client'

import { ErrorWithUpgrade } from '@/components/billing/ErrorWithUpgrade'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getInitials } from '@/lib/utils'
import { listBranches, listEmployeeDirectory, listEmployeesScoped, setEmployeeBranchGeofence } from '@/lib/employees'
import { loadScopedEmployeeIds } from '@/lib/employee-scope'
import { normalizeAccessLevel } from '@/lib/employee-taxonomy'
import { decideLeaveRequest, formatLeaveDecideError } from '@/lib/leave'
import { getCompanyAnnualDays, loadLeaveSettings, type LeaveSettingsMap } from '@/lib/leave-settings'
import { createWorkTeam, listWorkTeams, withMemberCount, type WorkTeamRow } from '@/lib/work-teams'
import type { Employee, AccessLevel, LeaveRequest, WorkTeam } from '@/types/database'
import {
  ResponsiveDataView,
  DataCard,
  DataCardTitle,
  DataCardMeta,
  DataCardRow,
} from '@/components/ui/ResponsiveDataView'
import { ModalShell } from '@/components/ui/ModalShell'
import { StatusFilterTabs, TAB_ALL, MONEY_TH, MONEY_TD } from '@/components/ui/StatusFilterTabs'
import {
  TextHeaderFilter,
  StatusHeaderFilter,
  ResetFiltersButton,
  statusTab,
  matchText,
} from '@/components/ui/MoneyListFilters'

// ─── Constants ────────────────────────────────────────────────────────────────

const DIRECTORY_PAGE_SIZE = 50

const ACCESS_BADGES: Record<AccessLevel, { label: string; cls: string }> = {
  owner:    { label: 'Owner',    cls: 'bg-primary/10 text-primary' },
  admin:    { label: 'Admin',    cls: 'bg-primary/10 text-primary' },
  manager:  { label: 'Manager',  cls: 'bg-warning-dark text-warning' },
  hr:       { label: 'HR',       cls: 'bg-accent-light/30 text-primary-dark' },
  employee: { label: 'Employee', cls: 'bg-success-dark text-success' },
}

/** Status tabs map to list_employee_directory p_status ('' = all). */
const STATUS_TABS = [
  statusTab('active', 'Active', ['active'], 'green'),
  statusTab('inactive', 'Inactive', ['inactive'], 'slate'),
  TAB_ALL,
]

const TEAM_STATUS_TABS = STATUS_TABS

/** Leave view switcher — same chrome as status tabs, not row-status filters. */
const LEAVE_VIEW_TABS = [
  { id: 'pending', label: 'Pending', match: null, idle: 'border-amber-200 text-amber-700 hover:bg-amber-50', active: 'bg-amber-500 text-white border-amber-500' },
  { id: 'upcoming', label: 'Upcoming', match: null, idle: 'border-blue-200 text-blue-700 hover:bg-blue-50', active: 'bg-blue-600 text-white border-blue-600' },
  { id: 'balances', label: 'Balances', match: null, idle: 'border-slate-200 text-slate-700 hover:bg-slate-50', active: 'bg-slate-700 text-white border-slate-700' },
]

const UPCOMING_STATUS_TABS = [
  statusTab('approved', 'Approved', ['approved'], 'green'),
  statusTab('pending', 'Pending', ['pending'], 'amber'),
  TAB_ALL,
]

const ROLE_OPTIONS = [
  { id: 'owner', label: 'Owner' },
  { id: 'admin', label: 'Admin' },
  { id: 'manager', label: 'Manager' },
  { id: 'hr', label: 'HR' },
  { id: 'employee', label: 'Employee' },
]

const EMP_TYPE_OPTIONS = [
  { id: 'permanent', label: 'Permanent' },
  { id: 'contract', label: 'Contract' },
  { id: 'part-time', label: 'Part-time' },
  { id: 'student', label: 'Student' },
]

type DirectoryCols = {
  name: string
  employeeNumber: string
  idNumber: string
  department: string
}
const EMPTY_COLS: DirectoryCols = { name: '', employeeNumber: '', idNumber: '', department: '' }

function colsActive(c: DirectoryCols): boolean {
  return !!(c.name || c.employeeNumber || c.idNumber || c.department)
}

// ─── Local types ──────────────────────────────────────────────────────────────

type Tab = 'employees' | 'teams' | 'leave' | 'pending'

type Branch = { id: string; name: string }

type LeaveBalance = {
  employeeId: string
  employeeName: string
  leaveType: string
  annualDays: number
  usedDays: number
  remaining: number
  lastRequestDate: string | null
}

type UpcomingLeave = {
  id: string
  employee_id: string
  leave_type: string
  start_date: string
  end_date: string
  total_days: number | null
  status: string
  employees: { name: string; surname: string } | null
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
  requests: Pick<LeaveRequest, 'employee_id' | 'leave_type' | 'total_days' | 'start_date'>[],
  leaveSettings: LeaveSettingsMap
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
        usedDays:    req.total_days,
        lastDate:    req.start_date,
      })
    } else {
      existing.usedDays += req.total_days
      if (!existing.lastDate || req.start_date > existing.lastDate) {
        existing.lastDate = req.start_date
      }
    }
  }

  return Array.from(groups.values())
    .map(g => {
      const annualDays = getCompanyAnnualDays(g.leaveType, leaveSettings)
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

function monthBounds(yearMonth: string): { start: string; end: string } {
  const [year, month] = yearMonth.split('-').map(Number)
  const lastDay = new Date(year, month, 0).getDate()
  return {
    start: `${yearMonth}-01`,
    end: `${yearMonth}-${String(lastDay).padStart(2, '0')}`,
  }
}

/** True when [startDate, endDate] overlaps the calendar month (YYYY-MM). */
function overlapsMonth(startDate: string, endDate: string | null | undefined, yearMonth: string): boolean {
  const { start, end } = monthBounds(yearMonth)
  const rangeEnd = endDate || startDate
  return startDate <= end && rangeEnd >= start
}

function monthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

function shiftYearMonth(yearMonth: string, delta: number) {
  const [year, month] = yearMonth.split('-').map(Number)
  const next = new Date(year, month - 1 + delta, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeesPage() {
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <EmployeesPageInner />
    </Suspense>
  )
}

function EmployeesPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // ── Core ──────────────────────────────────────────────────────────────────
  const [companyId,      setCompanyId]      = useState<string | null>(null)
  const [myEmployeeId,   setMyEmployeeId]   = useState<string | null>(null)
  const [myAccessLevel,  setMyAccessLevel]  = useState<AccessLevel | null>(null)
  const [scopedIds,      setScopedIds]      = useState<Set<string> | null>(null)
  const [leaveSettings,  setLeaveSettings]  = useState<LeaveSettingsMap>({})
  const [tab,            setTab]            = useState<Tab>('employees')
  const [error,          setError]          = useState<string | null>(null)

  // Deep-link from Workforce Action Centre: /dashboard/employees?tab=pending
  useEffect(() => {
    const raw = searchParams.get('tab')
    if (raw === 'pending' || raw === 'leave' || raw === 'teams' || raw === 'employees') {
      setTab(raw)
    }
  }, [searchParams])

  // ── Tab 1 — Employees ─────────────────────────────────────────────────────
  const [employees,     setEmployees]     = useState<Employee[]>([])
  const [directoryTotal, setDirectoryTotal] = useState(0)
  const [page,          setPage]          = useState(0)
  const [branches,      setBranches]      = useState<Branch[]>([])
  const [empLoading,    setEmpLoading]    = useState(true)
  const [search,        setSearch]        = useState('')
  const [filterRole,    setFilterRole]    = useState<AccessLevel | ''>('')
  const [filterStatus,  setFilterStatus]  = useState<'active' | 'inactive' | ''>('')
  const [filterBranch,  setFilterBranch]  = useState('')
  const [filterEmpType, setFilterEmpType] = useState('')
  const [cols,          setCols]          = useState<DirectoryCols>(EMPTY_COLS)
  const [colsDebounced, setColsDebounced] = useState<DirectoryCols>(EMPTY_COLS)

  // ── Tab 2 — Teams ─────────────────────────────────────────────────────────
  const [teams,          setTeams]          = useState<WorkTeam[]>([])
  const [teamsLoading,   setTeamsLoading]   = useState(false)
  const [teamsLoaded,    setTeamsLoaded]    = useState(false)
  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [newTeamName,    setNewTeamName]    = useState('')
  const [teamBusy,       setTeamBusy]       = useState(false)
  const [teamSearch,     setTeamSearch]     = useState('')
  const [teamStatus,     setTeamStatus]     = useState<'active' | 'inactive' | ''>('')
  const [teamNameCol,    setTeamNameCol]    = useState('')

  // ── Tab 3 — Leave ─────────────────────────────────────────────────────────
  const [leaveBalances,   setLeaveBalances]   = useState<LeaveBalance[]>([])
  const [pendingLeave,    setPendingLeave]    = useState<LeaveRequest[]>([])
  const [leaveLoading,    setLeaveLoading]    = useState(false)
  const [leaveLoaded,     setLeaveLoaded]     = useState(false)
  const [leaveSearch,     setLeaveSearch]     = useState('')
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('')
  const [leavePendingName, setLeavePendingName] = useState('')
  const [leavePendingType, setLeavePendingType] = useState('')
  const [leaveUpcomingName, setLeaveUpcomingName] = useState('')
  const [leaveUpcomingType, setLeaveUpcomingType] = useState('')
  const [leaveUpcomingStatus, setLeaveUpcomingStatus] = useState<'approved' | 'pending' | ''>('')
  const [leaveSubTab,     setLeaveSubTab]     = useState<'pending' | 'upcoming' | 'balances'>('pending')
  const [leaveMonth,      setLeaveMonth]      = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [upcomingLeave,   setUpcomingLeave]   = useState<UpcomingLeave[]>([])
  const [upcomingLoading, setUpcomingLoading] = useState(false)
  const upcomingRequestRef = useRef(0)
  const [leaveActionBusy, setLeaveActionBusy] = useState<string | null>(null)

  // ── Tab 4 — Pending ───────────────────────────────────────────────────────
  const [pending,        setPending]        = useState<PendingEmployee[]>([])
  const [pendingLoading, setPendingLoading] = useState(false)
  const [pendingLoaded,  setPendingLoaded]  = useState(false)
  const [pendingBusy,    setPendingBusy]    = useState<string | null>(null)
  const [pendingSearch,  setPendingSearch]  = useState('')
  const [pendingNameCol, setPendingNameCol] = useState('')
  const [pendingEmailCol, setPendingEmailCol] = useState('')

  // ── Init & lazy loading ───────────────────────────────────────────────────
  useEffect(() => { init() }, [])

  useEffect(() => {
    if (!companyId) return
    if (tab === 'teams'   && !teamsLoaded)   loadTeams()
    if (tab === 'leave'   && !leaveLoaded)   loadLeave()
    if (tab === 'pending' && !pendingLoaded) loadPending()
  }, [tab, companyId])

  // Debounce global search while typing.
  const [searchDebounced, setSearchDebounced] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(search.trim()), 200)
    return () => clearTimeout(timer)
  }, [search])

  // Debounce column filters; keep previous reference when unchanged so load is not re-fired.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next: DirectoryCols = {
        name: cols.name.trim(),
        employeeNumber: cols.employeeNumber.trim(),
        idNumber: cols.idNumber.trim(),
        department: cols.department.trim(),
      }
      setColsDebounced(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }, 200)
    return () => clearTimeout(timer)
  }, [cols])

  useEffect(() => {
    setPage(0)
  }, [searchDebounced, colsDebounced, filterRole, filterStatus, filterBranch, filterEmpType])

  const directoryRequestRef = useRef(0)
  useEffect(() => {
    if (!companyId) return
    void loadDirectory()
  }, [companyId, page, searchDebounced, colsDebounced, filterRole, filterStatus, filterBranch, filterEmpType])

  async function loadDirectory() {
    if (!companyId) return
    // Only the latest request may update the list (filters now load without a delay).
    const requestId = ++directoryRequestRef.current
    setEmpLoading(true)
    const supabase = createClient()
    const result = await listEmployeeDirectory(supabase, companyId, {
      search: searchDebounced,
      role: filterRole,
      status: filterStatus,
      employmentType: filterEmpType,
      branchId: filterBranch || null,
      name: colsDebounced.name,
      employeeNumber: colsDebounced.employeeNumber,
      idNumber: colsDebounced.idNumber,
      department: colsDebounced.department,
      limit: DIRECTORY_PAGE_SIZE,
      offset: page * DIRECTORY_PAGE_SIZE,
    })
    if (requestId !== directoryRequestRef.current) return
    if (!result.ok) {
      setError(result.message)
      setEmployees([])
      setDirectoryTotal(0)
    } else {
      setEmployees(result.data.rows)
      setDirectoryTotal(result.data.total)
    }
    setEmpLoading(false)
  }

  function resetDirectoryFilters() {
    setSearch('')
    setCols(EMPTY_COLS)
    setFilterRole('')
    setFilterStatus('')
    setFilterBranch('')
    setFilterEmpType('')
    setPage(0)
  }

  const directoryFiltersActive =
    !!search || colsActive(cols) || !!filterRole || !!filterStatus || !!filterBranch || !!filterEmpType

  const statusTabValue = filterStatus || 'all'
  const branchOptions = branches.map(b => ({ id: b.id, label: b.name }))

  async function init() {
    const supabase = createClient()
    const member   = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setEmpLoading(false); return }

    setCompanyId(member.companyId)
    setMyEmployeeId(member.employeeId)

    const [branchRes, scopeRes, settingsRes] = await Promise.all([
      listBranches(supabase, member.companyId),
      loadScopedEmployeeIds(supabase, member.companyId, member.employeeId),
      loadLeaveSettings(supabase, member.companyId),
    ])

    if (!scopeRes.ok) { setError(scopeRes.message); setEmpLoading(false); return }

    setMyAccessLevel(normalizeAccessLevel(scopeRes.viewer.access_level) as AccessLevel)
    setScopedIds(scopeRes.seesAll ? null : scopeRes.ids)
    if (settingsRes.ok) setLeaveSettings(settingsRes.data)
    setBranches(
      branchRes.ok
        ? branchRes.data.map(b => ({ id: b.id, name: b.name }))
        : []
    )
  }

  // ── Tab 2 ─────────────────────────────────────────────────────────────────
  async function loadTeams() {
    if (!companyId || !myEmployeeId) return
    setTeamsLoading(true)
    const supabase = createClient()
    const teamsRes = await listWorkTeams(supabase, companyId)
    if (!teamsRes.ok) {
      setError(teamsRes.message)
      setTeamsLoading(false)
      return
    }
    let rows = teamsRes.data
    if (scopedIds) {
      rows = rows.filter(
        t => t.leader_employee_id === myEmployeeId || (t.member_ids ?? []).includes(myEmployeeId)
      )
    }
    setTeams(rows.map(t => withMemberCount(t as WorkTeamRow)) as WorkTeam[])
    setTeamsLoaded(true)
    setTeamsLoading(false)
  }

  async function createTeam() {
    if (!newTeamName.trim() || !companyId) return
    setTeamBusy(true)
    const supabase = createClient()
    const created = await createWorkTeam(supabase, {
      companyId,
      name: newTeamName,
    })
    if (!created.ok) setError(created.message)
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
        .select('employee_id, leave_type, total_days, start_date')
        .eq('company_id', companyId)
        .eq('status', 'approved')
        .gte('start_date', yearStart)
        .order('start_date', { ascending: false }),
      supabase
        .from('leave_requests')
        .select('*, employees(name, surname, employee_number)')
        .eq('company_id', companyId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
    ])

    const approved = (data ?? []) as Pick<LeaveRequest, 'employee_id' | 'leave_type' | 'total_days' | 'start_date'>[]
    const pending = (pendingData ?? []) as LeaveRequest[]
    const inScope = (employeeId: string) => !scopedIds || scopedIds.has(employeeId)
    const people = myEmployeeId
      ? await listEmployeesScoped(supabase, companyId, myEmployeeId)
      : { ok: true as const, data: [] as Employee[] }
    if (!people.ok) {
      setError(people.message)
      setLeaveLoading(false)
      return
    }

    setLeaveBalances(
      buildLeaveBalances(people.data, approved.filter(r => inScope(r.employee_id)), leaveSettings)
    )
    setPendingLeave(pending.filter(r => inScope(r.employee_id)))
    setLeaveLoaded(true)
    setLeaveLoading(false)
    void loadUpcoming(leaveMonth)
  }

  async function loadUpcoming(yearMonth: string) {
    if (!companyId) return
    const request = ++upcomingRequestRef.current
    setUpcomingLoading(true)
    const supabase = createClient()
    const { start, end } = monthBounds(yearMonth)
    const { data, error: loadError } = await supabase
      .from('leave_requests')
      .select('id, employee_id, leave_type, start_date, end_date, total_days, status, employees(name, surname)')
      .eq('company_id', companyId)
      .in('status', ['approved', 'pending'])
      .lte('start_date', end)
      .gte('end_date', start)
      .order('start_date', { ascending: true })
    if (request !== upcomingRequestRef.current) return
    if (loadError) {
      setError(loadError.message)
      setUpcomingLeave([])
      setUpcomingLoading(false)
      return
    }
    const inScope = (employeeId: string) => !scopedIds || scopedIds.has(employeeId)
    const rows = (data ?? []).map(row => {
      const linked = Array.isArray(row.employees) ? row.employees[0] : row.employees
      return {
        id: row.id,
        employee_id: row.employee_id,
        leave_type: row.leave_type,
        start_date: row.start_date,
        end_date: row.end_date,
        total_days: row.total_days,
        status: row.status,
        employees: linked ?? null,
      }
    })
    if (request !== upcomingRequestRef.current) return
    setUpcomingLeave(rows.filter(row => inScope(row.employee_id)))
    setUpcomingLoading(false)
  }

  function changeLeaveMonth(delta: number) {
    const next = shiftYearMonth(leaveMonth, delta)
    setLeaveMonth(next)
    void loadUpcoming(next)
  }

  async function decideLeave(requestId: string, decision: 'approved' | 'declined') {
    if (!companyId) return
    setLeaveActionBusy(requestId)
    setError(null)
    const supabase = createClient()
    const result = await decideLeaveRequest(supabase, {
      companyId,
      leaveRequestId: requestId,
      decision,
    })
    setLeaveActionBusy(null)
    if (!result.ok) {
      setError(formatLeaveDecideError(result.message))
      return
    }
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
    setError(null)
    const supabase = createClient()
    const { error: rpcErr } = await supabase.rpc('approve_pending_employee', {
      p_employee_id: employeeId,
    })
    setPendingBusy(null)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    setPendingLoaded(false)
    await loadPending()
  }

  async function rejectPending(employeeId: string) {
    setPendingBusy(employeeId)
    setError(null)
    const supabase = createClient()
    const { error: rpcErr } = await supabase.rpc('reject_pending_employee', {
      p_employee_id: employeeId,
    })
    setPendingBusy(null)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    setPendingLoaded(false)
    await loadPending()
  }

  async function approveAll() {
    if (!pending.length) return
    setPendingBusy('all')
    setError(null)
    const supabase = createClient()
    const failures: string[] = []
    for (const emp of pending) {
      const { error: rpcErr } = await supabase.rpc('approve_pending_employee', {
        p_employee_id: emp.id,
      })
      if (rpcErr) failures.push(rpcErr.message)
    }
    setPendingBusy(null)
    if (failures.length) {
      setError(failures[0])
    }
    setPendingLoaded(false)
    await loadPending()
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  // Owner / HR / managers with leave.approve — managers see scoped queue only
  const canSeeLeave = myAccessLevel !== null &&
    ['owner', 'admin', 'hr', 'manager'].includes(normalizeAccessLevel(myAccessLevel))
  const canSetGeofence = canSeeLeave

  async function toggleGeofence(emp: Employee, event: { stopPropagation: () => void }) {
    event.stopPropagation()
    if (!companyId || !canSetGeofence) return
    const next = emp.enforce_branch_geofence === false
    setEmployees(rows => rows.map(row => row.id === emp.id ? { ...row, enforce_branch_geofence: next } : row))
    const supabase = createClient()
    const saved = await setEmployeeBranchGeofence(supabase, companyId, emp.id, next)
    if (!saved.ok) {
      setEmployees(rows => rows.map(row => row.id === emp.id ? { ...row, enforce_branch_geofence: !next } : row))
      setError(saved.message)
    }
  }

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

  const filteredEmployees = employees
  const pageStart = directoryTotal === 0 ? 0 : page * DIRECTORY_PAGE_SIZE + 1
  const pageEnd = Math.min(directoryTotal, (page + 1) * DIRECTORY_PAGE_SIZE)

  const leaveTypes = Array.from(new Set(leaveBalances.map(b => b.leaveType))).sort()
  const leaveTypeOptions = leaveTypes.map(lt => ({ id: lt, label: lt.replace(/_/g, ' ') }))
  const pendingLeaveTypes = Array.from(new Set(pendingLeave.map(r => r.leave_type))).sort()
  const pendingLeaveTypeOptions = pendingLeaveTypes.map(lt => ({ id: lt, label: lt.replace(/_/g, ' ') }))
  const upcomingLeaveTypes = Array.from(new Set(upcomingLeave.map(r => r.leave_type))).sort()
  const upcomingLeaveTypeOptions = upcomingLeaveTypes.map(lt => ({ id: lt, label: lt.replace(/_/g, ' ') }))

  const filteredTeams = teams.filter(team => {
    if (teamStatus === 'active' && !team.is_active) return false
    if (teamStatus === 'inactive' && team.is_active) return false
    if (!matchText(team.name, teamSearch) && !matchText(team.description, teamSearch)) return false
    if (!matchText(team.name, teamNameCol)) return false
    return true
  })
  const teamFiltersActive = !!teamSearch || !!teamNameCol || !!teamStatus

  const filteredLeave = leaveBalances.filter(b => {
    if (leaveTypeFilter && b.leaveType !== leaveTypeFilter) return false
    if (!matchText(b.employeeName, leaveSearch)) return false
    return true
  })

  const pendingInMonth = pendingLeave.filter(req =>
    overlapsMonth(req.start_date, req.end_date, leaveMonth)
  )

  const filteredPendingLeave = pendingInMonth.filter(req => {
    const emp = req.employees as { name?: string; surname?: string } | undefined
    const name = emp ? `${emp.name ?? ''} ${emp.surname ?? ''}`.trim() : 'Employee'
    if (!matchText(name, leavePendingName)) return false
    if (leavePendingType && req.leave_type !== leavePendingType) return false
    if (leaveUpcomingStatus && req.status !== leaveUpcomingStatus) return false
    return true
  })

  const filteredUpcomingLeave = upcomingLeave.filter(row => {
    const name = row.employees
      ? `${row.employees.name} ${row.employees.surname}`.trim()
      : 'Employee'
    if (!matchText(name, leaveUpcomingName)) return false
    if (leaveUpcomingType && row.leave_type !== leaveUpcomingType) return false
    if (leaveUpcomingStatus && row.status !== leaveUpcomingStatus) return false
    return true
  })

  const filteredPendingRegs = pending.filter(emp => {
    const name = `${emp.name} ${emp.surname}`
    if (!matchText(name, pendingSearch) && !matchText(emp.email, pendingSearch)) return false
    if (!matchText(name, pendingNameCol)) return false
    if (!matchText(emp.email, pendingEmailCol)) return false
    return true
  })
  const pendingFiltersActive = !!pendingSearch || !!pendingNameCol || !!pendingEmailCol

  const leaveViewCounts = {
    pending: pendingLeave.length,
    upcoming: upcomingLeave.length,
  }
  const leaveStatusSource =
    leaveSubTab === 'upcoming' ? upcomingLeave
    : leaveSubTab === 'pending' ? pendingInMonth
    : []
  const leaveStatusCounts = {
    all: leaveStatusSource.length,
    approved: leaveStatusSource.filter(r => r.status === 'approved').length,
    pending: leaveStatusSource.filter(r => r.status === 'pending').length,
  }
  const leaveFiltersActive =
    leaveSubTab === 'upcoming'
      ? !!(leaveUpcomingName || leaveUpcomingType || leaveUpcomingStatus)
      : leaveSubTab === 'pending'
        ? !!(leavePendingName || leavePendingType || leaveUpcomingStatus)
        : !!(leaveSearch || leaveTypeFilter)

  function resetLeaveFilters() {
    if (leaveSubTab === 'upcoming') {
      setLeaveUpcomingName('')
      setLeaveUpcomingType('')
      setLeaveUpcomingStatus('')
      return
    }
    if (leaveSubTab === 'pending') {
      setLeavePendingName('')
      setLeavePendingType('')
      setLeaveUpcomingStatus('')
      return
    }
    setLeaveSearch('')
    setLeaveTypeFilter('')
  }

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
          <p className="text-[13px] text-text-secondary mt-0.5">{empLoading && directoryTotal === 0 ? 'Loading…' : `${directoryTotal} total`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/employees/import" className="btn-secondary">
            <span className="material-icons">upload_file</span>
            Import
          </Link>
          <Link href="/dashboard/employees/new" className="btn-primary">
            <span className="material-icons">person_add</span>
            Add Employee
          </Link>
        </div>
      </div>

      {/* Tab bar — tabs appear once your role is known, so Leave doesn't pop in and shift the others */}
      <div className="flex gap-1 mb-5 border-b border-divider min-h-8">
        {(myAccessLevel !== null || error) && TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`h-8 px-3 text-[12px] font-medium border-b-2 -mb-px transition-colors ${
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
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-1.5 h-8 px-2 bg-surface border border-border rounded-sm flex-1 min-w-[180px]">
              <span className="material-icons text-text-disabled text-[16px]">search</span>
              <input
                type="search"
                placeholder="Search name, employee no., ID, department…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 min-w-0 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
              />
            </div>
            <ResetFiltersButton
              disabled={!directoryFiltersActive}
              onReset={resetDirectoryFilters}
            />
            <StatusFilterTabs
              tabs={STATUS_TABS}
              value={statusTabValue}
              counts={{}}
              onChange={id => setFilterStatus(id === 'all' ? '' : id as 'active' | 'inactive')}
            />
          </div>

          <div className="bg-surface rounded-lg border border-divider overflow-hidden">
            <ResponsiveDataView
              table={
                <table className="w-full" style={{ minWidth: 720 }}>
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className={`${MONEY_TH} text-left`}>
                        <TextHeaderFilter
                          label="Employee"
                          value={cols.name}
                          onChange={v => setCols(c => ({ ...c, name: v }))}
                          placeholder="Name…"
                        />
                      </th>
                      <th style={{ width: 110 }} className={`${MONEY_TH} text-left`}>
                        <TextHeaderFilter
                          label="Emp. no."
                          value={cols.employeeNumber}
                          onChange={v => setCols(c => ({ ...c, employeeNumber: v }))}
                          placeholder="Number…"
                        />
                      </th>
                      <th style={{ width: 120 }} className={`${MONEY_TH} text-left`}>
                        <TextHeaderFilter
                          label="ID number"
                          value={cols.idNumber}
                          onChange={v => setCols(c => ({ ...c, idNumber: v }))}
                          placeholder="ID…"
                        />
                      </th>
                      <th style={{ width: 110 }} className={`${MONEY_TH} text-left`}>
                        <StatusHeaderFilter
                          label="Role"
                          options={ROLE_OPTIONS}
                          selected={filterRole ? [filterRole] : []}
                          onChange={next => setFilterRole((next[next.length - 1] as AccessLevel | undefined) ?? '')}
                        />
                      </th>
                      <th style={{ width: 120 }} className={`${MONEY_TH} text-left`}>
                        <TextHeaderFilter
                          label="Department"
                          value={cols.department}
                          onChange={v => setCols(c => ({ ...c, department: v }))}
                          placeholder="Department…"
                        />
                      </th>
                      <th style={{ width: 110 }} className={`${MONEY_TH} text-left`}>
                        <StatusHeaderFilter
                          label="Type"
                          options={EMP_TYPE_OPTIONS}
                          selected={filterEmpType ? [filterEmpType] : []}
                          onChange={next => setFilterEmpType(next[next.length - 1] ?? '')}
                        />
                      </th>
                      {branchOptions.length > 0 && (
                        <th style={{ width: 120 }} className={`${MONEY_TH} text-left`}>
                          <StatusHeaderFilter
                            label="Branch"
                            options={branchOptions}
                            selected={filterBranch ? [filterBranch] : []}
                            onChange={next => setFilterBranch(next[next.length - 1] ?? '')}
                          />
                        </th>
                      )}
                      <th style={{ width: 80 }} className={`${MONEY_TH} text-left`}>Status</th>
                      <th style={{ width: 80 }} className={`${MONEY_TH} text-center`}>Geofence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {empLoading ? (
                      <tr>
                        <td colSpan={branchOptions.length > 0 ? 9 : 8} className="py-12 text-center text-[12px] text-text-disabled">
                          Loading…
                        </td>
                      </tr>
                    ) : filteredEmployees.length === 0 ? (
                      <tr>
                        <td colSpan={branchOptions.length > 0 ? 9 : 8} className="py-12 text-center">
                          <span className="material-icons text-[40px] text-text-disabled block mb-2">people_outline</span>
                          <p className="text-[13px] text-text-secondary">
                            {directoryFiltersActive ? 'No employees match your filters.' : 'No employees found'}
                          </p>
                          {!directoryFiltersActive && (
                            <Link href="/dashboard/employees/new" className="mt-2 inline-block text-primary text-[12px] hover:underline">
                              + Add your first employee
                            </Link>
                          )}
                        </td>
                      </tr>
                    ) : (
                      filteredEmployees.map(emp => {
                        const badge = ACCESS_BADGES[normalizeAccessLevel(emp.access_level)]
                        const branchLabel =
                          branches.find(b => b.id === emp.branch_id)?.name
                          || emp.branch
                          || '—'
                        const typeLabel = (emp.employment_type || 'permanent').replace(/_/g, '-')
                        return (
                          <tr
                            key={emp.id}
                            className="border-b border-divider last:border-0 hover:bg-background transition-colors cursor-pointer"
                            onClick={() => router.push(`/dashboard/employees/${emp.id}`)}
                          >
                            <td className={MONEY_TD}>
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                  <span className="text-primary text-[11px] font-semibold">
                                    {getInitials(`${emp.name} ${emp.surname}`)}
                                  </span>
                                </div>
                                <div className="min-w-0">
                                  <p className="font-medium text-text-primary truncate">{emp.name} {emp.surname}</p>
                                  {emp.position && (
                                    <p className="text-[11px] text-text-secondary truncate">{emp.position}</p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className={`${MONEY_TD} text-text-secondary font-mono`}>
                              {emp.employee_number?.trim() || '—'}
                            </td>
                            <td className={`${MONEY_TD} text-text-secondary font-mono`}>
                              {emp.id_number?.trim() || '—'}
                            </td>
                            <td className={MONEY_TD}>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.cls}`}>
                                {badge.label}
                              </span>
                            </td>
                            <td className={`${MONEY_TD} text-text-secondary`}>
                              {emp.department ?? '—'}
                            </td>
                            <td className={`${MONEY_TD} text-text-secondary capitalize`}>
                              {typeLabel}
                            </td>
                            {branchOptions.length > 0 && (
                              <td className={`${MONEY_TD} text-text-secondary truncate`} style={{ maxWidth: 120 }}>
                                {branchLabel}
                              </td>
                            )}
                            <td className={MONEY_TD}>
                              <span className={`flex items-center gap-1 text-[11px] font-medium w-fit ${
                                emp.is_active ? 'text-success' : 'text-text-disabled'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  emp.is_active ? 'bg-success' : 'bg-text-disabled'
                                }`} />
                                {emp.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className={`${MONEY_TD} text-center`}>
                              <button
                                type="button"
                                disabled={!canSetGeofence}
                                onClick={event => { void toggleGeofence(emp, event) }}
                                className={`h-7 px-2.5 rounded-md text-[11px] font-semibold ${
                                  emp.enforce_branch_geofence === false
                                    ? 'bg-surface-elevated text-text-secondary border border-divider'
                                    : 'bg-primary/10 text-primary'
                                } disabled:opacity-60`}
                              >
                                {emp.enforce_branch_geofence === false ? 'Off' : 'On'}
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              }
              mobile={
                empLoading ? (
                  <p className="py-10 text-center text-[12px] text-text-disabled">Loading…</p>
                ) : filteredEmployees.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-[13px] text-text-secondary">
                      {directoryFiltersActive ? 'No employees match your filters.' : 'No employees found'}
                    </p>
                  </div>
                ) : (
                  <>
                    {filteredEmployees.map(emp => {
                      const badge = ACCESS_BADGES[normalizeAccessLevel(emp.access_level)]
                      return (
                        <DataCard
                          key={emp.id}
                          onClick={() => router.push(`/dashboard/employees/${emp.id}`)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <span className="text-primary text-[13px] font-semibold">
                                {getInitials(`${emp.name} ${emp.surname}`)}
                              </span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <DataCardTitle>{emp.name} {emp.surname}</DataCardTitle>
                              <DataCardMeta>
                                {emp.position || '—'}
                              </DataCardMeta>
                            </div>
                            <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium shrink-0 ${badge.cls}`}>
                              {badge.label}
                            </span>
                          </div>
                          <DataCardRow label="Employee no." value={emp.employee_number?.trim() || '—'} />
                          <DataCardRow label="ID number" value={emp.id_number?.trim() || '—'} />
                          <DataCardRow label="Dept" value={emp.department ?? '—'} />
                          <DataCardRow
                            label="Status"
                            value={emp.is_active ? 'Active' : 'Inactive'}
                          />
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[12px] text-text-secondary">Geofence</span>
                            <button
                              type="button"
                              disabled={!canSetGeofence}
                              onClick={event => { void toggleGeofence(emp, event) }}
                              className={`h-7 px-3 rounded-md text-[11px] font-semibold ${
                                emp.enforce_branch_geofence === false
                                  ? 'bg-surface-elevated text-text-secondary border border-divider'
                                  : 'bg-primary/10 text-primary'
                              } disabled:opacity-60`}
                            >
                              {emp.enforce_branch_geofence === false ? 'Off' : 'On'}
                            </button>
                          </div>
                        </DataCard>
                      )
                    })}
                  </>
                )
              }
            />
            {directoryTotal > 0 && (
              <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-divider">
                <p className="text-[12px] text-text-secondary">
                  {pageStart}–{pageEnd} of {directoryTotal}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page === 0 || empLoading}
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    className="h-8 px-2.5 rounded-md border border-border text-[12px] font-medium text-text-primary disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={pageEnd >= directoryTotal || empLoading}
                    onClick={() => setPage(p => p + 1)}
                    className="h-8 px-2.5 rounded-md border border-border text-[12px] font-medium text-text-primary disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
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
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-1.5 h-8 px-2 bg-surface border border-border rounded-sm flex-1 min-w-[180px]">
              <span className="material-icons text-text-disabled text-[16px]">search</span>
              <input
                type="search"
                placeholder="Search teams…"
                value={teamSearch}
                onChange={e => setTeamSearch(e.target.value)}
                className="flex-1 min-w-0 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
              />
            </div>
            <ResetFiltersButton
              disabled={!teamFiltersActive}
              onReset={() => { setTeamSearch(''); setTeamNameCol(''); setTeamStatus('') }}
            />
            <StatusFilterTabs
              tabs={TEAM_STATUS_TABS}
              value={teamStatus || 'all'}
              counts={{
                all: teams.length,
                active: teams.filter(t => t.is_active).length,
                inactive: teams.filter(t => !t.is_active).length,
              }}
              onChange={id => setTeamStatus(id === 'all' ? '' : id as 'active' | 'inactive')}
            />
            <button
              type="button"
              onClick={() => setShowCreateTeam(true)}
              className="h-8 px-2.5 text-[12px] rounded-md bg-primary text-white font-semibold hover:bg-primary-dark whitespace-nowrap"
            >
              + Create Team
            </button>
          </div>

          <ModalShell
            open={showCreateTeam}
            onClose={() => { setShowCreateTeam(false); setNewTeamName('') }}
            title="New Team"
            footer={
              <>
                <button
                  type="button"
                  onClick={() => { setShowCreateTeam(false); setNewTeamName('') }}
                  className="btn-outlined btn-md"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={createTeam}
                  disabled={!newTeamName.trim() || teamBusy}
                  className="btn-primary btn-md disabled:opacity-50"
                >
                  {teamBusy ? 'Creating…' : 'Create'}
                </button>
              </>
            }
          >
            <input
              type="text"
              placeholder="Team name…"
              value={newTeamName}
              autoFocus
              onChange={e => setNewTeamName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createTeam()}
              className="w-full h-11 px-3 bg-background border border-border rounded-md text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </ModalShell>

          <div className="bg-surface rounded-lg border border-divider overflow-hidden">
            <ResponsiveDataView
              table={
                <table className="w-full" style={{ minWidth: 520 }}>
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className={`${MONEY_TH} text-left`}>
                        <TextHeaderFilter
                          label="Team"
                          value={teamNameCol}
                          onChange={setTeamNameCol}
                          placeholder="Team name…"
                        />
                      </th>
                      <th style={{ width: 110 }} className={`${MONEY_TH} text-left`}>Members</th>
                      <th style={{ width: 90 }} className={`${MONEY_TH} text-left`}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamsLoading ? (
                      <tr>
                        <td colSpan={3} className="py-12 text-center text-[12px] text-text-disabled">Loading…</td>
                      </tr>
                    ) : filteredTeams.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-12 text-center text-[13px] text-text-secondary">
                          {teams.length === 0
                            ? 'No teams yet. Create one to get started.'
                            : 'No teams match your filters.'}
                        </td>
                      </tr>
                    ) : (
                      filteredTeams.map(team => (
                        <tr
                          key={team.id}
                          className="border-b border-divider last:border-0 hover:bg-background transition-colors cursor-pointer"
                          onClick={() => router.push(`/dashboard/work-teams/${team.id}`)}
                        >
                          <td className={MONEY_TD}>
                            <p className="font-medium text-text-primary truncate">{team.name}</p>
                            {team.description && (
                              <p className="text-[11px] text-text-secondary truncate">{team.description}</p>
                            )}
                          </td>
                          <td className={`${MONEY_TD} text-text-secondary`}>
                            {team.member_count} {team.member_count === 1 ? 'member' : 'members'}
                          </td>
                          <td className={MONEY_TD}>
                            <span className={`flex items-center gap-1 text-[11px] font-medium w-fit ${
                              team.is_active ? 'text-success' : 'text-text-disabled'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                team.is_active ? 'bg-success' : 'bg-text-disabled'
                              }`} />
                              {team.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              }
              mobile={
                teamsLoading ? (
                  <p className="py-10 text-center text-[12px] text-text-disabled">Loading…</p>
                ) : filteredTeams.length === 0 ? (
                  <p className="py-10 text-center text-[13px] text-text-secondary">
                    {teams.length === 0 ? 'No teams yet.' : 'No teams match your filters.'}
                  </p>
                ) : (
                  <>
                    {filteredTeams.map(team => (
                      <DataCard
                        key={team.id}
                        onClick={() => router.push(`/dashboard/work-teams/${team.id}`)}
                      >
                        <DataCardTitle>{team.name}</DataCardTitle>
                        {team.description && <DataCardMeta>{team.description}</DataCardMeta>}
                        <DataCardRow
                          label="Members"
                          value={`${team.member_count} ${team.member_count === 1 ? 'member' : 'members'}`}
                        />
                        <DataCardRow label="Status" value={team.is_active ? 'Active' : 'Inactive'} />
                      </DataCard>
                    ))}
                  </>
                )
              }
            />
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* Tab 3 — Leave (admin-gated)                                          */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'leave' && (
        <>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <StatusFilterTabs
              tabs={LEAVE_VIEW_TABS}
              value={leaveSubTab}
              counts={leaveViewCounts}
              onChange={id => setLeaveSubTab(id as 'pending' | 'upcoming' | 'balances')}
            />
            <div className="flex items-center gap-1 ml-auto">
              <button
                type="button"
                onClick={() => changeLeaveMonth(-1)}
                className="h-8 w-8 rounded-md border border-border bg-surface text-text-primary"
                aria-label="Previous month"
              >
                <span className="material-icons text-[18px]">chevron_left</span>
              </button>
              <span className="min-w-[120px] text-center text-[12px] font-semibold text-text-primary">
                {monthLabel(leaveMonth)}
              </span>
              <button
                type="button"
                onClick={() => changeLeaveMonth(1)}
                className="h-8 w-8 rounded-md border border-border bg-surface text-text-primary"
                aria-label="Next month"
              >
                <span className="material-icons text-[18px]">chevron_right</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <ResetFiltersButton
              disabled={!leaveFiltersActive}
              onReset={resetLeaveFilters}
            />
            <StatusFilterTabs
              tabs={UPCOMING_STATUS_TABS}
              value={leaveUpcomingStatus || 'all'}
              counts={leaveStatusCounts}
              onChange={id => setLeaveUpcomingStatus(id === 'all' ? '' : id as 'approved' | 'pending')}
            />
          </div>

          {leaveSubTab === 'upcoming' ? (
            <div className="bg-surface rounded-lg border border-divider overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full" style={{ minWidth: 720 }}>
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className={`${MONEY_TH} text-left`}>
                        <TextHeaderFilter label="Employee" value={leaveUpcomingName} onChange={setLeaveUpcomingName} placeholder="Employee…" />
                      </th>
                      <th style={{ width: 130 }} className={`${MONEY_TH} text-left`}>
                        <StatusHeaderFilter
                          label="Leave type"
                          options={upcomingLeaveTypeOptions}
                          selected={leaveUpcomingType ? [leaveUpcomingType] : []}
                          onChange={next => setLeaveUpcomingType(next[next.length - 1] ?? '')}
                        />
                      </th>
                      <th style={{ width: 100 }} className={`${MONEY_TH} text-left`}>From</th>
                      <th style={{ width: 100 }} className={`${MONEY_TH} text-left`}>To</th>
                      <th style={{ width: 60 }} className={`${MONEY_TH} text-right`}>Days</th>
                      <th style={{ width: 90 }} className={`${MONEY_TH} text-left`}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingLoading ? (
                      <tr><td colSpan={6} className="py-12 text-center text-[12px] text-text-disabled">Loading…</td></tr>
                    ) : filteredUpcomingLeave.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-[13px] text-text-secondary">
                          {upcomingLeave.length === 0
                            ? `No leave in ${monthLabel(leaveMonth)}`
                            : 'No leave matches your filters.'}
                        </td>
                      </tr>
                    ) : (
                      filteredUpcomingLeave.map(row => {
                        const name = row.employees
                          ? `${row.employees.name} ${row.employees.surname}`.trim()
                          : 'Employee'
                        const approved = row.status === 'approved'
                        return (
                          <tr key={row.id} className="border-b border-divider last:border-0 hover:bg-background">
                            <td className={MONEY_TD}>
                              <Link href={`/dashboard/employees/${row.employee_id}?tab=leave`} className="font-medium text-text-primary hover:text-primary hover:underline">
                                {name}
                              </Link>
                            </td>
                            <td className={`${MONEY_TD} text-text-secondary capitalize`}>
                              {row.leave_type.replace(/_/g, ' ')}
                            </td>
                            <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>{fmtDate(row.start_date)}</td>
                            <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>{row.end_date ? fmtDate(row.end_date) : '—'}</td>
                            <td className={`${MONEY_TD} text-text-secondary text-right tabular-nums`}>{row.total_days ?? '—'}</td>
                            <td className={MONEY_TD}>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                approved ? 'bg-success-dark text-success' : 'bg-warning-dark text-warning'
                              }`}>
                                {approved ? 'Approved' : 'Pending'}
                              </span>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : leaveSubTab === 'pending' ? (
            <div className="bg-surface rounded-lg border border-divider overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full" style={{ minWidth: 760 }}>
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className={`${MONEY_TH} text-left`}>
                        <TextHeaderFilter label="Employee" value={leavePendingName} onChange={setLeavePendingName} placeholder="Employee…" />
                      </th>
                      <th style={{ width: 130 }} className={`${MONEY_TH} text-left`}>
                        <StatusHeaderFilter
                          label="Leave type"
                          options={pendingLeaveTypeOptions}
                          selected={leavePendingType ? [leavePendingType] : []}
                          onChange={next => setLeavePendingType(next[next.length - 1] ?? '')}
                        />
                      </th>
                      <th style={{ width: 100 }} className={`${MONEY_TH} text-left`}>From</th>
                      <th style={{ width: 100 }} className={`${MONEY_TH} text-left`}>To</th>
                      <th style={{ width: 60 }} className={`${MONEY_TH} text-right`}>Days</th>
                      <th style={{ width: 150 }} className={`${MONEY_TH} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaveLoading ? (
                      <tr><td colSpan={6} className="py-12 text-center text-[12px] text-text-disabled">Loading…</td></tr>
                    ) : filteredPendingLeave.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-[13px] text-text-secondary">
                          {pendingLeave.length === 0
                            ? 'No pending leave requests'
                            : pendingInMonth.length === 0
                              ? `No pending leave in ${monthLabel(leaveMonth)}`
                              : 'No leave matches your filters.'}
                        </td>
                      </tr>
                    ) : (
                      filteredPendingLeave.map(req => {
                        const emp = req.employees as { name: string; surname: string } | undefined
                        const name = emp ? `${emp.name} ${emp.surname}` : 'Employee'
                        return (
                          <tr key={req.id} className="border-b border-divider last:border-0 hover:bg-background">
                            <td className={MONEY_TD}>
                              <Link href={`/dashboard/employees/${req.employee_id}?tab=leave`} className="font-medium text-text-primary hover:text-primary hover:underline">
                                {name}
                              </Link>
                            </td>
                            <td className={`${MONEY_TD} text-text-secondary capitalize`}>
                              {req.leave_type.replace(/_/g, ' ')}
                            </td>
                            <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>{fmtDate(req.start_date)}</td>
                            <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>{req.end_date ? fmtDate(req.end_date) : '—'}</td>
                            <td className={`${MONEY_TD} text-text-secondary text-right tabular-nums`}>{req.total_days ?? '—'}</td>
                            <td className={`${MONEY_TD} text-right`}>
                              <div className="inline-flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => decideLeave(req.id, 'declined')}
                                  disabled={leaveActionBusy === req.id}
                                  className="h-7 px-2 rounded-md text-[11px] font-medium bg-error-dark text-error hover:bg-red-100 disabled:opacity-50"
                                >
                                  {leaveActionBusy === req.id ? '…' : 'Decline'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => decideLeave(req.id, 'approved')}
                                  disabled={leaveActionBusy === req.id}
                                  className="h-7 px-2 rounded-md text-[11px] font-medium bg-success-dark text-success hover:bg-green-100 disabled:opacity-50"
                                >
                                  {leaveActionBusy === req.id ? '…' : 'Approve'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-surface rounded-lg border border-divider overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full" style={{ minWidth: 720 }}>
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className={`${MONEY_TH} text-left`}>
                        <TextHeaderFilter label="Employee" value={leaveSearch} onChange={setLeaveSearch} placeholder="Employee…" />
                      </th>
                      <th style={{ width: 130 }} className={`${MONEY_TH} text-left`}>
                        <StatusHeaderFilter
                          label="Leave type"
                          options={leaveTypeOptions}
                          selected={leaveTypeFilter ? [leaveTypeFilter] : []}
                          onChange={next => setLeaveTypeFilter(next[next.length - 1] ?? '')}
                        />
                      </th>
                      <th style={{ width: 90 }} className={`${MONEY_TH} text-right`}>Annual</th>
                      <th style={{ width: 70 }} className={`${MONEY_TH} text-right`}>Used</th>
                      <th style={{ width: 90 }} className={`${MONEY_TH} text-right`}>Remaining</th>
                      <th style={{ width: 110 }} className={`${MONEY_TH} text-left`}>Last request</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaveLoading ? (
                      <tr><td colSpan={6} className="py-12 text-center text-[12px] text-text-disabled">Loading…</td></tr>
                    ) : filteredLeave.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-[13px] text-text-secondary">
                          No approved leave records for this year
                        </td>
                      </tr>
                    ) : (
                      filteredLeave.map((b, i) => (
                        <tr key={`${b.employeeId}-${b.leaveType}-${i}`} className="border-b border-divider last:border-0 hover:bg-background">
                          <td className={MONEY_TD}>
                            <Link href={`/dashboard/employees/${b.employeeId}?tab=leave`} className="font-medium text-text-primary hover:text-primary hover:underline">
                              {b.employeeName}
                            </Link>
                          </td>
                          <td className={`${MONEY_TD} text-text-secondary capitalize`}>
                            {b.leaveType.replace(/_/g, ' ')}
                          </td>
                          <td className={`${MONEY_TD} text-text-secondary text-right tabular-nums`}>{b.annualDays}</td>
                          <td className={`${MONEY_TD} text-text-secondary text-right tabular-nums`}>{b.usedDays}</td>
                          <td className={`${MONEY_TD} text-right tabular-nums`}>
                            <span className={`font-semibold ${
                              b.remaining <= 0 ? 'text-error' : b.remaining <= 3 ? 'text-warning' : 'text-success'
                            }`}>
                              {b.remaining}
                            </span>
                          </td>
                          <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>
                            {b.lastRequestDate ? fmtDate(b.lastRequestDate) : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* Tab 4 — Pending Registrations                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'pending' && (
        <>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-1.5 h-8 px-2 bg-surface border border-border rounded-sm flex-1 min-w-[180px]">
              <span className="material-icons text-text-disabled text-[16px]">search</span>
              <input
                type="search"
                placeholder="Search name or email…"
                value={pendingSearch}
                onChange={e => setPendingSearch(e.target.value)}
                className="flex-1 min-w-0 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
              />
            </div>
            <ResetFiltersButton
              disabled={!pendingFiltersActive}
              onReset={() => { setPendingSearch(''); setPendingNameCol(''); setPendingEmailCol('') }}
            />
            {!pendingLoading && pending.length > 0 && (
              <button
                type="button"
                onClick={approveAll}
                disabled={pendingBusy !== null}
                className="h-8 px-2.5 rounded-md bg-success/10 text-success text-[12px] font-semibold hover:bg-success/20 disabled:opacity-50 border border-success/30"
              >
                {pendingBusy === 'all' ? 'Approving…' : `Approve All (${pending.length})`}
              </button>
            )}
          </div>

          {error && error !== 'not_linked' && <ErrorWithUpgrade message={error} className="mb-3" />}
          <div className="bg-surface rounded-lg border border-divider overflow-hidden">
            <table className="w-full" style={{ minWidth: 640 }}>
              <thead>
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className={`${MONEY_TH} text-left`}>
                    <TextHeaderFilter label="Employee" value={pendingNameCol} onChange={setPendingNameCol} placeholder="Name…" />
                  </th>
                  <th style={{ width: 220 }} className={`${MONEY_TH} text-left`}>
                    <TextHeaderFilter label="Email" value={pendingEmailCol} onChange={setPendingEmailCol} placeholder="Email…" />
                  </th>
                  <th style={{ width: 110 }} className={`${MONEY_TH} text-left`}>Submitted</th>
                  <th style={{ width: 150 }} className={`${MONEY_TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingLoading ? (
                  <tr><td colSpan={4} className="py-12 text-center text-[12px] text-text-disabled">Loading…</td></tr>
                ) : filteredPendingRegs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-[13px] text-text-secondary">
                      {pending.length === 0 ? 'No pending registrations' : 'No registrations match your filters.'}
                    </td>
                  </tr>
                ) : (
                  filteredPendingRegs.map(emp => {
                    const isBusy = pendingBusy === emp.id || pendingBusy === 'all'
                    return (
                      <tr key={emp.id} className="border-b border-divider last:border-0 hover:bg-background">
                        <td className={`${MONEY_TD} font-medium text-text-primary`}>
                          {emp.name} {emp.surname}
                        </td>
                        <td className={`${MONEY_TD} text-text-secondary`}>{emp.email ?? '—'}</td>
                        <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>{fmtDate(emp.created_at)}</td>
                        <td className={`${MONEY_TD} text-right`}>
                          <div className="inline-flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => approvePending(emp.id)}
                              disabled={pendingBusy !== null}
                              className="h-7 px-2 rounded-md bg-success/10 text-success text-[11px] font-semibold hover:bg-success/20 disabled:opacity-50"
                            >
                              {isBusy ? '…' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              onClick={() => rejectPending(emp.id)}
                              disabled={pendingBusy !== null}
                              className="h-7 px-2 rounded-md bg-error/10 text-error text-[11px] font-semibold hover:bg-error/20 disabled:opacity-50"
                            >
                              {isBusy ? '…' : 'Reject'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

    </div>
  )
}
