/**
 * Clock-in trail: every clock-in / clock-out tap and how it ended, written to app_events (screen "clock") through
 * employee_log_app_event, so the office and support can see exactly what happened on a worker's phone.
 *
 * Never blocks or slows a clock-in: every call is fire-and-forget and swallows its own errors. With no signal the
 * steps are kept on the phone (kf_clock_trail) and sent with the next sync.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const TRAIL_KEY = 'kf_clock_trail'
const MAX_KEPT = 100

export type ClockStep =
  | 'tap'                 // the worker pressed Clock in / Clock out
  | 'sent'                // saved on the server
  | 'already_clocked_in'  // server kept the earlier clock-in (no new one)
  | 'saved_on_phone'      // no signal / network error: saved on the phone to send later
  | 'blocked_leave'
  | 'blocked_absent'
  | 'blocked_location'    // outside the branch sign-in area
  | 'location_failed'     // could not read the phone's location (clock-in still continues)
  | 'failed'              // server refused it (reason in error)
  | 'replay_sent'         // a phone-saved clock-in was sent later
  | 'replay_failed'       // a phone-saved clock-in could not be sent yet

export type ClockWho = { companyId: string; employeeId: string; sessionToken: string | null }

type TrailItem = {
  company_id: string
  employee_id: string
  action: ClockStep
  level: 'info' | 'warning' | 'error'
  error_text: string | null
  meta: Record<string, unknown>
  at: string
}

const LEVEL: Record<ClockStep, TrailItem['level']> = {
  tap: 'info', sent: 'info', already_clocked_in: 'info', saved_on_phone: 'warning', replay_sent: 'info',
  blocked_leave: 'warning', blocked_absent: 'warning', blocked_location: 'warning', location_failed: 'warning',
  failed: 'error', replay_failed: 'error',
}

function readTrail(): TrailItem[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(TRAIL_KEY) : null
    const list = raw ? (JSON.parse(raw) as TrailItem[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeTrail(list: TrailItem[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (list.length === 0) localStorage.removeItem(TRAIL_KEY)
    else localStorage.setItem(TRAIL_KEY, JSON.stringify(list.slice(-MAX_KEPT)))
  } catch {
    // Storage full or blocked: the trail is best effort.
  }
}

/** Steps still waiting on this phone (for tests and support). */
export function pendingClockTrail(): number {
  return readTrail().length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (s: SupabaseClient, fn: string, args: Record<string, unknown>) => (s.rpc as any)(fn, args) as PromiseLike<{ error: { message: string } | null }>

async function send(s: SupabaseClient, item: TrailItem, sessionToken: string | null): Promise<boolean> {
  try {
    const { error } = await rpc(s, 'employee_log_app_event', {
      p_company_id: item.company_id,
      p_employee_id: item.employee_id,
      p_screen: 'clock',
      p_action: item.action,
      p_level: item.level,
      p_error_text: item.error_text,
      // employee_id and the phone's own time go in meta: app_events has no employee column.
      p_meta: { ...item.meta, employee_id: item.employee_id, phone_time: item.at },
      p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null,
      p_app_version: process.env.NEXT_PUBLIC_BUILD_ID || null,
      p_session_token: sessionToken,
    })
    return !error
  } catch {
    return false
  }
}

/**
 * Record one step. Sent straight away when online; otherwise kept on the phone and sent with the next sync.
 * Fire-and-forget: callers use `void logClockStep(...)`.
 */
export async function logClockStep(
  s: SupabaseClient,
  who: ClockWho,
  action: ClockStep,
  meta: Record<string, unknown> = {},
  errorText: string | null = null,
): Promise<void> {
  const item: TrailItem = {
    company_id: who.companyId,
    employee_id: who.employeeId,
    action,
    level: LEVEL[action],
    error_text: errorText ? errorText.slice(0, 500) : null,
    meta: { ...meta, online: typeof navigator !== 'undefined' ? navigator.onLine : null },
    at: new Date().toISOString(),
  }
  const online = typeof navigator === 'undefined' || navigator.onLine
  if (online && (await send(s, item, who.sessionToken))) return
  writeTrail([...readTrail(), item])
}

/**
 * Send this worker's kept steps (oldest first). Other workers' steps on a shared phone stay until they sign in.
 * Stops at the first failure so the order is kept.
 */
export async function flushClockTrail(s: SupabaseClient, employeeId: string, sessionToken: string | null): Promise<number> {
  const all = readTrail()
  const mine = all.filter(i => i.employee_id === employeeId)
  let sent = 0
  for (const item of mine) {
    if (!(await send(s, item, sessionToken))) break
    sent += 1
  }
  if (sent > 0) {
    const key = (i: TrailItem) => `${i.employee_id}|${i.at}|${i.action}`
    const done = new Set(mine.slice(0, sent).map(key))
    writeTrail(readTrail().filter(i => !done.has(key(i))))
  }
  return sent
}
