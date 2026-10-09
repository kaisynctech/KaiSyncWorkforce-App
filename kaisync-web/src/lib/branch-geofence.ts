/**
 * Mirrors KaiFlow.Timesheets.Services.BranchGeofenceService
 */

export type DispatchSettings = Record<string, unknown> | null | undefined

export type BranchRow = {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  /** Per-branch clock-in radius when set (preferred over company default). */
  radius_meters?: number | null
  is_active?: boolean | null
}

export type BranchGeofenceResult = {
  allowed: boolean
  message: string
  distanceMeters?: number
  allowedRadiusMeters?: number
  branchName?: string
}

export type BranchGeofenceStatus = {
  enforcementActive: boolean
  isWithinRadius: boolean
  displayMessage: string
  distanceMeters?: number
  allowedRadiusMeters?: number
  branchName?: string
}

export function getDispatchFlag(settings: DispatchSettings, key: string, defaultValue = false): boolean {
  if (!settings || !(key in settings) || settings[key] == null) return defaultValue
  const value = settings[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return defaultValue
}

export function getDispatchNumber(settings: DispatchSettings, key: string, defaultValue: number): number {
  if (!settings || !(key in settings) || settings[key] == null) return defaultValue
  const value = settings[key]
  if (typeof value === 'number') return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : defaultValue
}

/** Normalize branch geofence radius */
export function normalizeBranchRadius(raw: number): number {
  if (raw <= 350) return 200
  if (raw <= 750) return 500
  return 1000
}

export function enforceBranchSignInRadius(settings: DispatchSettings): boolean {
  return getDispatchFlag(settings, 'enforce_branch_sign_in_radius', false)
}

/** Company enforcement is the master switch. A person can be opted out and still record a location. */
export function employeeMustUseBranchGeofence(
  settings: DispatchSettings,
  enforceForEmployee: boolean | null | undefined,
): boolean {
  if (!enforceBranchSignInRadius(settings)) return false
  return enforceForEmployee !== false
}

export function branchSignInRadiusMeters(settings: DispatchSettings): number {
  const raw = getDispatchNumber(settings, 'branch_sign_in_radius_m', 100)
  // Honour small explicit radii (50–150m). Legacy configs still bucket to 200/500/1000.
  if (raw >= 50 && raw <= 150) return Math.round(raw)
  return normalizeBranchRadius(raw)
}

/** Prefer the assigned branch radius when present. */
export function resolveBranchSignInRadiusMeters(
  settings: DispatchSettings,
  branch: BranchRow | null | undefined,
): number {
  const fromBranch = branch?.radius_meters
  if (typeof fromBranch === 'number' && Number.isFinite(fromBranch) && fromBranch > 0) {
    return fromBranch
  }
  return branchSignInRadiusMeters(settings)
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function findBranchById(branches: BranchRow[], branchId: string): BranchRow | undefined {
  return branches.find((b) => (b.is_active !== false) && b.id === branchId)
}

function findBranchByName(branches: BranchRow[], branchName: string): BranchRow | undefined {
  const target = branchName.trim().toLowerCase()
  return branches.find(
    (b) => (b.is_active !== false) && (b.name ?? '').trim().toLowerCase() === target,
  )
}

function branchCandidates(
  branches: BranchRow[],
  branchIds: string[] | null | undefined,
  employeeBranchId: string | null | undefined,
  employeeBranch: string | null | undefined,
): BranchRow[] {
  const fromList = [...new Set((branchIds ?? []).map(id => id.trim()).filter(Boolean))]
  const ids = fromList.length
    ? fromList
    : (employeeBranchId?.trim() ? [employeeBranchId.trim()] : [])
  const found = ids
    .map(id => findBranchById(branches, id))
    .filter((branch): branch is BranchRow => Boolean(branch))
  if (found.length > 0) return found
  const byName = employeeBranch?.trim() ? findBranchByName(branches, employeeBranch) : undefined
  return byName ? [byName] : []
}

function radiusForBranch(
  settings: DispatchSettings | undefined,
  branch: BranchRow,
  fallbackRadius: number,
): number {
  if (settings) return resolveBranchSignInRadiusMeters(settings, branch)
  return fallbackRadius
}

export function validateBranchClockIn(params: {
  enforce: boolean
  employeeBranch: string | null | undefined
  /** Canonical FK — preferred over employeeBranch name */
  employeeBranchId?: string | null
  /** Home branch plus any extra branches. Clock-in succeeds at any of them. */
  branchIds?: string[] | null
  settings?: DispatchSettings
  branches: BranchRow[]
  radiusMeters: number
  latitude: number | null
  longitude: number | null
}): BranchGeofenceResult {
  const { enforce, employeeBranch, employeeBranchId, branchIds, settings, branches, radiusMeters, latitude, longitude } = params
  if (!enforce) return { allowed: true, message: '' }

  const assigned = branchCandidates(branches, branchIds, employeeBranchId, employeeBranch)
  if (assigned.length === 0) {
    const branchName = employeeBranch?.trim() || ''
    if (!branchName) return { allowed: true, message: '' }
    return {
      allowed: false,
      message: `Branch "${branchName}" does not have a sign-in location yet. Ask HR to set the branch address in Settings.`,
      branchName,
    }
  }

  if (latitude == null || longitude == null) {
    return {
      allowed: false,
      message: 'Location is required for branch sign-in. Enable location services and try again.',
      branchName: assigned.map(b => b.name).filter(Boolean).join(', ') || undefined,
    }
  }

  let closest: BranchGeofenceResult | null = null
  for (const branch of assigned) {
    const branchName = branch.name?.trim() || 'assigned'
    if (branch.latitude == null || branch.longitude == null) {
      const missing: BranchGeofenceResult = {
        allowed: false,
        message: `Branch "${branchName}" does not have a sign-in location yet. Ask HR to set the branch address in Settings.`,
        branchName,
      }
      if (!closest) closest = missing
      continue
    }
    const allowedRadius = radiusForBranch(settings, branch, radiusMeters)
    const distanceM = haversineMeters(latitude, longitude, branch.latitude, branch.longitude)
    if (distanceM <= allowedRadius) {
      return {
        allowed: true,
        message: '',
        distanceMeters: distanceM,
        allowedRadiusMeters: allowedRadius,
        branchName,
      }
    }
    const outside: BranchGeofenceResult = {
      allowed: false,
      message: `You are ${distanceM.toFixed(0)}m away from your branch sign-in location (${branchName}). Move within ${allowedRadius.toFixed(0)}m to clock in.`,
      distanceMeters: distanceM,
      allowedRadiusMeters: allowedRadius,
      branchName,
    }
    if (!closest || (closest.distanceMeters == null) || distanceM < closest.distanceMeters) {
      closest = outside
    }
  }

  return closest ?? { allowed: false, message: 'Cannot clock in at your assigned branches.' }
}

export function getBranchGeofenceStatus(params: {
  enforce: boolean
  employeeBranch: string | null | undefined
  /** Canonical FK — preferred over employeeBranch name */
  employeeBranchId?: string | null
  /** Home branch plus any extra branches. */
  branchIds?: string[] | null
  settings?: DispatchSettings
  branches: BranchRow[]
  radiusMeters: number
  latitude: number | null
  longitude: number | null
}): BranchGeofenceStatus {
  const result = validateBranchClockIn(params)
  if (!params.enforce) {
    return { enforcementActive: false, isWithinRadius: true, displayMessage: '' }
  }
  const assigned = branchCandidates(params.branches, params.branchIds, params.employeeBranchId, params.employeeBranch)
  if (assigned.length === 0 && !params.employeeBranch?.trim()) {
    return { enforcementActive: false, isWithinRadius: true, displayMessage: '' }
  }
  if (result.allowed && result.branchName && result.distanceMeters != null && result.allowedRadiusMeters != null) {
    return {
      enforcementActive: true,
      isWithinRadius: true,
      distanceMeters: result.distanceMeters,
      allowedRadiusMeters: result.allowedRadiusMeters,
      branchName: result.branchName,
      displayMessage: `Within ${result.branchName} sign-in area (${result.distanceMeters.toFixed(0)}m / ${result.allowedRadiusMeters.toFixed(0)}m)`,
    }
  }
  return {
    enforcementActive: true,
    isWithinRadius: false,
    distanceMeters: result.distanceMeters,
    allowedRadiusMeters: result.allowedRadiusMeters,
    branchName: result.branchName,
    displayMessage: result.message || 'Outside your branch sign-in area.',
  }
}
