'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { CompanyModuleKeys, isModuleEnabled } from '@/lib/company-modules'
import { loadCompanyWorkspace } from '@/lib/employee-workspace'
import {
  buildIcsCalendar,
  downloadIcsFile,
  nextSnoozeUntil,
  normalizePaStatus,
  parsePaSettingsRpc,
  paTasksToIcsEntries,
  spawnNextDueAt,
} from '@/lib/pa-helpers'

interface PATask {
  id: string
  title: string
  description: string | null
  status: 'todo' | 'in_progress' | 'done' | 'snoozed' | 'cancelled'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  due_date: string | null
  due_at: string | null
  remind_at: string | null
  snoozed_until: string | null
  linked_type: string | null
  linked_id?: string | null
  linked_label: string | null
  meeting_with: string | null
  meeting_at: string | null
  completed_at: string | null
  quick_capture: string | null
  notes: string | null
  source_type: string | null
  recurrence_pattern?: string | null
}

const PRIORITY_STRIP: Record<string, string> = {
  low:    'bg-text-disabled',
  medium: 'bg-primary',
  high:   'bg-warning',
  urgent: 'bg-error',
}
const PRIORITY_BADGE: Record<string, string> = {
  low:    'bg-surface-elevated text-text-disabled',
  medium: 'bg-primary/10 text-primary',
  high:   'bg-warning/10 text-warning',
  urgent: 'bg-error/10 text-error',
}

type MainTab = 'today' | 'tasks' | 'calendar' | 'search'
type TaskFilter = 'all' | 'todo' | 'in_progress' | 'overdue' | 'done'

function fmtDue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date(); today.setHours(0,0,0,0)
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return 'Due today'
  if (diff === 1) return 'Due tomorrow'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  return `Due ${d.toLocaleDateString('en-ZA', { weekday: 'short', day: '2-digit', month: 'short' })}`
}

function isOverdue(t: PATask): boolean {
  return t.status !== 'done' && !!t.due_at && new Date(t.due_at) < new Date()
}

function isToday(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

async function spawnRecurringNext(
  task: PATask,
  companyId: string,
  empId: string,
  token: string | null,
) {
  const nextDue = spawnNextDueAt(task.due_at, task.recurrence_pattern)
  if (!nextDue) return
  const supabase = createClient()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.rpc as any)('employee_insert_pa_task', {
      p_company_id: companyId,
      p_employee_id: empId,
      p_title: task.title,
      p_due_at: nextDue,
      p_priority: task.priority,
      p_source_type: 'manual',
      p_notes: task.notes,
      p_remind_at: null,
      p_linked_type: task.linked_type,
      p_linked_id: task.linked_id ?? null,
      p_linked_label: task.linked_label,
      p_recurrence_pattern: task.recurrence_pattern ?? null,
      p_meeting_with: task.meeting_with,
      p_meeting_at: task.meeting_at,
      p_meeting_minutes: null,
      p_meeting_follow_up: null,
      p_session_token: token,
    })
  } catch (e) { console.error(e) }
}

function TaskRow({ task, empId, companyId, token, onRefresh }: {
  task: PATask; empId: string; companyId: string; token: string | null; onRefresh: () => void
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const overdue = isOverdue(task)

  async function complete() {
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)('employee_update_pa_task_status', {
        p_company_id:    companyId,
        p_employee_id:   empId,
        p_task_id:       task.id,
        p_status:        'done',
        p_snoozed_until: null,
        p_session_token: token,
      })
      if (error) throw error
      await spawnRecurringNext(task, companyId, empId, token)
      onRefresh()
    } catch (e) { console.error(e) }
  }

  async function start() {
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)('employee_update_pa_task_status', {
        p_company_id:    companyId,
        p_employee_id:   empId,
        p_task_id:       task.id,
        p_status:        'in_progress',
        p_snoozed_until: null,
        p_session_token: token,
      })
      if (error) throw error
      onRefresh()
    } catch (e) { console.error(e) }
  }

  async function snooze(option: string) {
    setSnoozeOpen(false)
    const sunoozedUntil = nextSnoozeUntil(option)
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)('employee_update_pa_task_status', {
        p_company_id:    companyId,
        p_employee_id:   empId,
        p_task_id:       task.id,
        p_status:        'snoozed',
        p_snoozed_until: sunoozedUntil,
        p_session_token: token,
      })
      if (error) throw error
      onRefresh()
    } catch (e) { console.error(e) }
  }

  async function del() {
    if (!confirm(`Delete '${task.title}'?`)) return
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)('employee_delete_pa_task', {
        p_company_id:    companyId,
        p_employee_id:   empId,
        p_task_id:       task.id,
        p_session_token: token,
      })
      if (error) throw error
      onRefresh()
    } catch (e) { console.error(e) }
  }

  return (
    <div className={`flex items-stretch border border-divider rounded-xl overflow-hidden bg-surface ${overdue ? 'border-error/40' : ''}`}>
      <div className={`w-1 shrink-0 ${PRIORITY_STRIP[task.priority] ?? 'bg-text-disabled'}`} />
      <div className="flex-1 px-3 py-3 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/dashboard/employee/pa/${task.id}`}
            className="text-[14px] font-semibold text-text-primary hover:underline flex-1 min-w-0 truncate">
            {task.title}
          </Link>
          <span className={`text-[10px] font-bold px-2 py-[2px] rounded-full capitalize shrink-0 ${PRIORITY_BADGE[task.priority]}`}>
            {task.priority}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {task.due_at && (
            <span className={`text-[11px] font-medium ${overdue ? 'text-error' : 'text-text-disabled'}`}>
              {fmtDue(task.due_at)}
            </span>
          )}
          {task.linked_label && (
            <span className="text-[11px] text-text-disabled truncate">{task.linked_label}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 pr-2">
        {task.status === 'todo' && (
          <button onClick={start} title="Start" className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors">
            <span className="material-icons text-[18px] text-primary">play_arrow</span>
          </button>
        )}
        <button onClick={complete} title="Complete" className="p-1.5 rounded-lg hover:bg-success/10 transition-colors">
          <span className="material-icons text-[18px] text-success">check_circle</span>
        </button>
        <div className="relative">
          <button onClick={() => setSnoozeOpen(v => !v)} title="Snooze" className="p-1.5 rounded-lg hover:bg-warning/10 transition-colors">
            <span className="material-icons text-[18px] text-warning">snooze</span>
          </button>
          {snoozeOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-divider rounded-xl shadow-xl min-w-[160px]">
              {[['later_today','Later today'],['tomorrow','Tomorrow 9am'],['next_monday','Next Monday'],['2_hours','In 2 hours']].map(([key, label]) => (
                <button key={key} onClick={() => snooze(key)}
                  className="block w-full text-left px-4 py-2.5 text-[13px] text-text-primary hover:bg-surface-elevated transition-colors">
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={del} title="Delete" className="p-1.5 rounded-lg hover:bg-error/10 transition-colors">
          <span className="material-icons text-[18px] text-error">delete</span>
        </button>
      </div>
    </div>
  )
}

// ── Calendar grid ────────────────────────────────────────────────────────────

function CalendarGrid({ tasks, mode, month, setMonth }: {
  tasks: PATask[]; mode: 'month' | 'week'; month: Date; setMonth: (d: Date) => void
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const today = new Date(); today.setHours(0,0,0,0)

  function dotsFor(dateStr: string): string[] {
    return tasks
      .filter(t => isToday_str(t.due_at, dateStr) || isToday_str(t.meeting_at, dateStr))
      .map(t => PRIORITY_STRIP[t.priority] ?? 'bg-text-disabled')
      .slice(0, 4)
  }

  function isToday_str(iso: string | null, dateStr: string): boolean {
    if (!iso) return false
    return iso.startsWith(dateStr)
  }

  function moveMonth(delta: number) {
    const d = new Date(month)
    d.setMonth(d.getMonth() + delta)
    setMonth(d)
  }

  function moveWeek(delta: number) {
    const d = new Date(month)
    d.setDate(d.getDate() + delta * 7)
    setMonth(d)
  }

  const headerLabel = mode === 'month'
    ? month.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
    : (() => {
        const day = month.getDay()
        const diff = day === 0 ? -6 : 1 - day
        const ws = new Date(month); ws.setDate(ws.getDate() + diff); ws.setHours(0,0,0,0)
        const we = new Date(ws); we.setDate(we.getDate() + 6)
        return `${ws.toLocaleDateString('en-ZA',{day:'2-digit',month:'short'})} – ${we.toLocaleDateString('en-ZA',{day:'2-digit',month:'short'})}`
      })()

  function buildCells(): Array<{ dateStr: string; inMonth: boolean }> {
    if (mode === 'week') {
      const day = month.getDay()
      const diff = day === 0 ? -6 : 1 - day
      const ws = new Date(month); ws.setDate(ws.getDate() + diff); ws.setHours(0,0,0,0)
      return Array.from({length:7}, (_,i) => {
        const d = new Date(ws); d.setDate(d.getDate() + i)
        return { dateStr: d.toISOString().split('T')[0], inMonth: true }
      })
    }
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const startDay = first.getDay() === 0 ? 6 : first.getDay() - 1
    const cells: Array<{ dateStr: string; inMonth: boolean }> = []
    for (let i = startDay; i > 0; i--) {
      const d = new Date(first); d.setDate(d.getDate() - i)
      cells.push({ dateStr: d.toISOString().split('T')[0], inMonth: false })
    }
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
    for (let i = 1; i <= last.getDate(); i++) {
      const d = new Date(month.getFullYear(), month.getMonth(), i)
      cells.push({ dateStr: d.toISOString().split('T')[0], inMonth: true })
    }
    while (cells.length % 7 !== 0) {
      const d = new Date(last); d.setDate(last.getDate() + (cells.length - (last.getDate() + startDay - 1)))
      cells.push({ dateStr: d.toISOString().split('T')[0], inMonth: false })
    }
    return cells
  }

  const cells = buildCells()
  const selectedTasks = selectedDay ? tasks.filter(t =>
    isToday_str(t.due_at, selectedDay) || isToday_str(t.meeting_at, selectedDay) || isToday_str(t.remind_at, selectedDay)
  ) : []

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => mode === 'month' ? moveMonth(-1) : moveWeek(-1)} className="text-text-secondary hover:text-text-primary">
          <span className="material-icons">chevron_left</span>
        </button>
        <p className="text-[14px] font-semibold text-text-primary">{headerLabel}</p>
        <button onClick={() => mode === 'month' ? moveMonth(1) : moveWeek(1)} className="text-text-secondary hover:text-text-primary">
          <span className="material-icons">chevron_right</span>
        </button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {['M','T','W','T','F','S','S'].map((d,i) => (
          <div key={i} className="text-center text-[11px] font-semibold text-text-disabled py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {cells.map(({ dateStr, inMonth }) => {
          const dots = dotsFor(dateStr)
          const isT = dateStr === today.toISOString().split('T')[0]
          const isSel = dateStr === selectedDay
          return (
            <button key={dateStr} onClick={() => setSelectedDay(s => s === dateStr ? null : dateStr)}
              className={`flex flex-col items-center py-1.5 rounded-lg transition-colors ${
                isSel ? 'bg-primary/20' : 'hover:bg-surface-elevated'
              }`}>
              <span className={`text-[12px] w-6 h-6 flex items-center justify-center rounded-full font-medium ${
                isT ? 'bg-primary text-white' : inMonth ? 'text-text-primary' : 'text-text-disabled'
              }`}>{parseInt(dateStr.split('-')[2], 10)}</span>
              <div className="flex gap-[2px] mt-0.5 h-[6px]">
                {dots.map((c,i) => <span key={i} className={`w-1.5 h-1.5 rounded-full ${c}`} />)}
              </div>
            </button>
          )
        })}
      </div>
      {selectedDay && selectedTasks.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">
            {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-ZA', { weekday:'long', day:'2-digit', month:'long' })}
          </p>
          {selectedTasks.map(t => (
            <Link key={t.id} href={`/dashboard/employee/pa/${t.id}`}
              className="flex items-center gap-3 bg-surface border border-divider rounded-xl px-3 py-2.5">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_STRIP[t.priority]}`} />
              <p className="flex-1 text-[13px] text-text-primary truncate">{t.title}</p>
              {t.due_at && <p className="text-[11px] text-text-disabled shrink-0">{new Date(t.due_at).toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit',hour12:true})}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default function MyPAPage() {
  const pathname = usePathname()
  const router = useRouter()
  const isHrShell = pathname.startsWith('/dashboard/pa')
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) { setAllowed(false); return }
      const company = await loadCompanyWorkspace(supabase, member.companyId)
      const ok = isModuleEnabled(company?.enabled_modules, CompanyModuleKeys.MyPa)
      if (!ok) {
        router.replace(isHrShell ? '/dashboard/overview' : '/dashboard/employee/overview')
        setAllowed(false)
        return
      }
      setAllowed(true)
    })()
  }, [isHrShell, router])
  const [tasks,      setTasks]      = useState<PATask[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [mainTab,    setMainTab]    = useState<MainTab>('today')
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const [focusMode,  setFocusMode]  = useState(false)
  const [calMode,    setCalMode]    = useState<'month' | 'week'>('month')
  const [calDate,    setCalDate]    = useState(new Date())
  const [search,     setSearch]     = useState('')
  const [quickTitle, setQuickTitle] = useState('')
  const [quickOpen,  setQuickOpen]  = useState(false)
  const [empId,      setEmpId]      = useState<string | null>(null)
  const [companyId,  setCompanyId]  = useState<string | null>(null)
  const [token,      setToken]      = useState<string | null>(null)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (allowed !== true) return
    void init()
  }, [allowed])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setEmpId(member.employeeId)
    setCompanyId(member.companyId)

    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    setToken(tok)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)

    try {
      await rpc('sync_operational_pa_tasks', {
        p_company_id: member.companyId,
        p_scope_employee_id: member.employeeId,
        p_session_token: tok,
      }).catch(() => {})
    } catch { /* non-fatal */ }

    try {
      await rpc('enqueue_pa_task_notifications', {
        p_company_id: member.companyId,
        p_session_token: tok,
      }).catch(() => {})
    } catch { /* non-fatal */ }

    try {
      const { data: settingsData } = await rpc('employee_get_pa_settings', {
        p_company_id: member.companyId,
        p_employee_id: member.employeeId,
        p_session_token: tok,
      })
      setFocusMode(Boolean(parsePaSettingsRpc(settingsData).focus_mode_enabled))
    } catch { /* non-fatal */ }

    try {
      const { data, error: rpcErr } = await rpc('employee_get_pa_tasks', {
        p_company_id:    member.companyId,
        p_employee_id:   member.employeeId,
        p_session_token: tok,
      })
      if (rpcErr) throw rpcErr
      setTasks(((data as PATask[]) ?? []).map(t => ({
        ...t,
        status: normalizePaStatus(t.status),
      })))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks.')
    }
    setLoading(false)
  }

  async function toggleFocusMode() {
    const next = !focusMode
    setFocusMode(next)
    if (!empId || !companyId) return
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('upsert_employee_pa_settings', {
        p_employee_id: empId,
        p_company_id: companyId,
        p_focus_mode_enabled: next,
        p_session_token: token,
      })
    } catch { /* non-fatal */ }
  }

  function exportCalendarIcs() {
    const from = calMode === 'week'
      ? (() => {
          const d = new Date(calDate)
          const day = d.getDay()
          const diff = day === 0 ? -6 : 1 - day
          d.setDate(d.getDate() + diff)
          d.setHours(0, 0, 0, 0)
          return d
        })()
      : new Date(calDate.getFullYear(), calDate.getMonth(), 1)
    const to = calMode === 'week'
      ? (() => { const d = new Date(from); d.setDate(d.getDate() + 6); d.setHours(23, 59, 59, 999); return d })()
      : new Date(calDate.getFullYear(), calDate.getMonth() + 1, 0, 23, 59, 59, 999)
    const entries = paTasksToIcsEntries(tasks, from, to)
    if (entries.length === 0) {
      alert('No events in this period.')
      return
    }
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12)
    downloadIcsFile(buildIcsCalendar(entries), `my-pa-${stamp}.ics`)
  }

  async function completeInline(t: PATask) {
    if (!empId || !companyId) return
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('employee_update_pa_task_status', {
        p_company_id: companyId, p_employee_id: empId,
        p_task_id: t.id, p_status: 'done', p_snoozed_until: null, p_session_token: token,
      })
      await spawnRecurringNext(t, companyId, empId, token)
      await init()
    } catch (e) { console.error(e) }
  }

  async function startInline(t: PATask) {
    if (!empId || !companyId) return
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('employee_update_pa_task_status', {
        p_company_id: companyId, p_employee_id: empId,
        p_task_id: t.id, p_status: 'in_progress', p_snoozed_until: null, p_session_token: token,
      })
      await init()
    } catch (e) { console.error(e) }
  }

  async function addQuick() {
    if (!quickTitle.trim() || !empId || !companyId) return
    const supabase = createClient()
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1); tomorrow.setMinutes(0,0,0)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('employee_insert_pa_task', {
        p_company_id:    companyId,
        p_employee_id:   empId,
        p_title:         quickTitle.trim(),
        p_due_at:        tomorrow.toISOString(),
        p_priority:      'medium',
        p_source_type:   'manual',
        p_notes: null, p_remind_at: null, p_linked_type: null, p_linked_id: null,
        p_linked_label: null, p_recurrence_pattern: null, p_meeting_with: null,
        p_meeting_at: null, p_meeting_minutes: null, p_meeting_follow_up: null,
        p_session_token: token,
      })
    } catch (e) { console.error(e) }
    setQuickTitle(''); setQuickOpen(false)
    await init()
  }

  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]

  const openCount      = tasks.filter(t => ['todo','in_progress'].includes(t.status)).length
  const overdueCount   = tasks.filter(isOverdue).length
  const dueTodayCount  = tasks.filter(t => t.status !== 'done' && t.due_at?.startsWith(todayStr)).length
  const doneTodayCount = tasks.filter(t => t.status === 'done' && t.completed_at?.startsWith(todayStr)).length

  const todayTasks = tasks.filter(t =>
    t.due_at?.startsWith(todayStr) || t.meeting_at?.startsWith(todayStr) || t.remind_at?.startsWith(todayStr)
  )
  const upcomingReminders = tasks.filter(t =>
    t.status !== 'done' && !!t.remind_at &&
    new Date(t.remind_at) > now && new Date(t.remind_at) < new Date(now.getTime() + 7*86400000)
  ).sort((a, b) => new Date(a.remind_at!).getTime() - new Date(b.remind_at!).getTime())

  const filteredTasks = useMemo(() => {
    let list = tasks
    if (taskFilter === 'todo')        list = list.filter(t => t.status === 'todo')
    else if (taskFilter === 'in_progress') list = list.filter(t => t.status === 'in_progress')
    else if (taskFilter === 'overdue')     list = list.filter(isOverdue)
    else if (taskFilter === 'done')        list = list.filter(t => t.status === 'done')
    if (focusMode) list = list.filter(t =>
      isOverdue(t) || t.due_at?.startsWith(todayStr) || ['high','urgent'].includes(t.priority)
    )
    return list
  }, [tasks, taskFilter, focusMode, todayStr])

  const searchResults = useMemo(() => {
    if (!search.trim()) return []
    const q = search.toLowerCase()
    return tasks.filter(t =>
      [t.title, t.description, t.notes, t.quick_capture, t.linked_label, t.meeting_with].some(f => f?.toLowerCase().includes(q))
    )
  }, [tasks, search])

  if (allowed === null || (allowed && loading)) {
    return (
      <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
    )
  }
  if (allowed === false) return null

  const rowProps = { empId: empId!, companyId: companyId!, token, onRefresh: init }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center justify-between">
          <h1 className="text-[18px] font-semibold text-text-primary">My PA</h1>
          <div className="flex gap-2">
            <button onClick={() => setQuickOpen(v => !v)}
              className="text-[12px] font-semibold px-3 py-2 rounded-lg bg-surface-elevated border border-divider text-text-primary hover:border-primary transition-colors">
              Quick add
            </button>
            <Link href="/dashboard/employee/pa/new"
              className="flex items-center gap-1 bg-primary text-white text-[13px] font-semibold px-3 py-2 rounded-lg hover:bg-primary-dark transition-colors">
              <span className="material-icons text-[16px]">add</span>Task
            </Link>
          </div>
        </div>
        {quickOpen && (
          <div className="flex gap-2 mt-3">
            <input className="input flex-1 text-[13px]" placeholder="What do you need to do?"
              value={quickTitle} onChange={e => setQuickTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addQuick()} autoFocus />
            <button onClick={addQuick} className="bg-primary text-white font-semibold text-[13px] px-4 rounded-lg hover:bg-primary-dark">
              Add
            </button>
          </div>
        )}
        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          {(['today','tasks','calendar','search'] as MainTab[]).map(t => (
            <button key={t} onClick={() => setMainTab(t)}
              className={`flex-1 text-[12px] font-semibold py-1.5 rounded-lg capitalize transition-colors ${
                mainTab === t ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface-elevated'
              }`}>{t}</button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-xl px-4 py-3 bg-error-dark border border-error/30">
          <p className="text-[13px] text-error font-semibold">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* ── TODAY ── */}
        {mainTab === 'today' && (
          <div className="p-4 space-y-4">
            <p className="text-[15px] font-semibold text-text-primary">
              {now.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            {/* KPI strip */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Open', value: openCount, color: 'text-primary' },
                { label: 'Overdue', value: overdueCount, color: 'text-error' },
                { label: 'Due Today', value: dueTodayCount, color: 'text-warning' },
                { label: 'Done Today', value: doneTodayCount, color: 'text-success' },
              ].map(k => (
                <div key={k.label} className="bg-surface border border-divider rounded-xl p-3 text-center">
                  <p className={`text-[22px] font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-text-disabled mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            {/* Today's agenda */}
            {todayTasks.length > 0 && (
              <div>
                <p className="section-label mb-2">Today's Agenda</p>
                <div className="space-y-2">
                  {todayTasks.map(t => <TaskRow key={t.id} task={t} {...rowProps} />)}
                </div>
              </div>
            )}
            {todayTasks.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-text-secondary">
                <span className="material-icons text-[36px] text-text-disabled">today</span>
                <p className="text-[14px]">Nothing scheduled for today.</p>
              </div>
            )}
            {/* Upcoming reminders */}
            {upcomingReminders.length > 0 && (
              <div>
                <p className="section-label mb-2">Upcoming Reminders</p>
                <div className="space-y-2">
                  {upcomingReminders.map(t => (
                    <Link key={t.id} href={`/dashboard/employee/pa/${t.id}`}
                      className="flex items-center gap-3 bg-surface border border-divider rounded-xl px-3 py-2.5">
                      <span className="material-icons text-warning text-[18px]">alarm</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-text-primary truncate">{t.title}</p>
                        <p className="text-[11px] text-text-disabled">
                          {new Date(t.remind_at!).toLocaleDateString('en-ZA', { weekday:'short', day:'2-digit', month:'short' })} at {new Date(t.remind_at!).toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit',hour12:true})}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TASKS ── */}
        {mainTab === 'tasks' && (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex gap-1.5 flex-wrap">
                {(['all','todo','in_progress','overdue','done'] as TaskFilter[]).map(f => (
                  <button key={f} onClick={() => setTaskFilter(f)}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize transition-colors ${
                      taskFilter === f ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary border border-divider'
                    }`}>{f.replace(/_/g,' ')}</button>
                ))}
              </div>
              <button onClick={() => void toggleFocusMode()}
                className={`text-[11px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                  focusMode ? 'bg-warning text-white' : 'bg-surface-elevated text-text-secondary border border-divider'
                }`}>
                {focusMode ? 'Focus ON' : 'Focus mode'}
              </button>
            </div>
            {focusMode && (
              <p className="text-[11px] text-text-disabled italic">On — showing only overdue, due-today and high-priority work.</p>
            )}
            {filteredTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-secondary">
                <span className="material-icons text-[48px] text-text-disabled">task_alt</span>
                <p className="text-[14px]">No tasks.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-divider bg-surface-elevated">
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Title</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Priority</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Status</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Due</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Linked</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-divider">
                    {filteredTasks.map(t => {
                      const overdue = isOverdue(t)
                      return (
                        <tr key={t.id} className={`hover:bg-surface-elevated transition-colors ${overdue ? 'bg-error/5' : ''}`}>
                          <td className="px-4 py-3">
                            <Link href={`/dashboard/employee/pa/${t.id}`}
                              className={`text-[13px] font-semibold hover:underline ${overdue ? 'text-error' : 'text-primary'}`}>
                              {t.title}
                            </Link>
                            {t.notes && (
                              <p className="text-[11px] text-text-disabled mt-0.5 line-clamp-1">{t.notes}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`text-[10px] font-bold px-2 py-[2px] rounded-full capitalize ${PRIORITY_BADGE[t.priority] ?? 'bg-surface-elevated text-text-disabled'}`}>
                              {t.priority}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-[11px] text-text-secondary capitalize">
                              {t.status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {t.due_at ? (
                              <span className={`text-[12px] font-medium ${overdue ? 'text-error' : 'text-text-secondary'}`}>
                                {fmtDue(t.due_at)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-4 py-3 text-[12px] text-text-disabled">
                            {t.linked_label ?? '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 justify-end">
                              {t.status === 'todo' && (
                                <button onClick={() => void startInline(t)} title="Start" className="p-1 rounded hover:bg-primary/10">
                                  <span className="material-icons text-[16px] text-primary">play_arrow</span>
                                </button>
                              )}
                              <button onClick={() => void completeInline(t)} title="Complete" className="p-1 rounded hover:bg-success/10">
                                <span className="material-icons text-[16px] text-success">check_circle</span>
                              </button>
                              <button onClick={async () => {
                                if (!confirm(`Delete '${t.title}'?`)) return
                                const supabase = createClient()
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                await (supabase.rpc as any)('employee_delete_pa_task', {
                                  p_company_id: companyId!, p_employee_id: empId!,
                                  p_task_id: t.id, p_session_token: token,
                                })
                                init()
                              }} title="Delete" className="p-1 rounded hover:bg-error/10">
                                <span className="material-icons text-[16px] text-error">delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── CALENDAR ── */}
        {mainTab === 'calendar' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex gap-2">
                {(['month','week'] as const).map(m => (
                  <button key={m} onClick={() => setCalMode(m)}
                    className={`text-[12px] font-semibold px-3 py-1.5 rounded-full capitalize transition-colors ${
                      calMode === m ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary border border-divider'
                    }`}>{m}</button>
                ))}
              </div>
              <button
                type="button"
                onClick={exportCalendarIcs}
                className="text-[12px] font-semibold text-primary border border-primary/30 px-3 py-1.5 rounded-lg hover:bg-primary/10 transition-colors"
              >
                Export .ics
              </button>
            </div>
            <CalendarGrid tasks={tasks} mode={calMode} month={calDate} setMonth={setCalDate} />
          </div>
        )}

        {/* ── SEARCH ── */}
        {mainTab === 'search' && (
          <div className="p-4 space-y-3">
            <input className="input" type="text" placeholder="Search tasks…"
              value={search} onChange={e => setSearch(e.target.value)} autoFocus />
            {search.trim() && searchResults.length === 0 && (
              <p className="text-center text-[14px] text-text-secondary py-8">No results</p>
            )}
            {searchResults.length > 0 && (
              <div className="space-y-2">
                {searchResults.map(t => <TaskRow key={t.id} task={t} {...rowProps} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
