import type { BranchRow, DispatchSettings } from '@/lib/branch-geofence'

const KEY = 'kf_clock_pack'

export type PackedLastPunch = {
  id: string
  type: 'in' | 'out'
  date_time: string
  job_id: string | null
  notes: string | null
}

/** Enough of the last online visit to clock in with no signal. */
export type ClockPack = {
  employeeId: string
  companyId: string
  attendance: boolean
  enforceGeofence: boolean
  branchName: string | null
  branchId: string | null
  branchIds: string[]
  branches: BranchRow[]
  dispatchSettings: DispatchSettings
  lastPunch: PackedLastPunch | null
  savedAt: string
}

export function loadClockPack(employeeId: string, companyId: string): ClockPack | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const pack = JSON.parse(raw) as ClockPack
    if (pack.employeeId !== employeeId || pack.companyId !== companyId) return null
    if (!Array.isArray(pack.branches) || !Array.isArray(pack.branchIds)) return null
    return pack
  } catch {
    return null
  }
}

export function saveClockPack(pack: Omit<ClockPack, 'savedAt'>): void {
  if (typeof window === 'undefined') return
  const next: ClockPack = { ...pack, savedAt: new Date().toISOString() }
  localStorage.setItem(KEY, JSON.stringify(next))
}
