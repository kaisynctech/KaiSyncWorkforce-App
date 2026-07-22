/**
 * Mirrors KaiFlow.Timesheets.Services.BranchGeofenceService
 */

export type DispatchSettings = Record<string, unknown> | null | undefined

export type BranchRow = {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
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

/** MAUI Company.NormalizeBranchRadius */
export function normalizeBranchRadius(raw: number): number {
  if (raw <= 350) return 200
  if (raw <= 750) return 500
  return 1000
}

export function enforceBranchSignInRadius(settings: DispatchSettings): boolean {
  return getDispatchFlag(settings, 'enforce_branch_sign_in_radius', false)
}

export function branchSignInRadiusMeters(settings: DispatchSettings): number {
  return normalizeBranchRadius(getDispatchNumber(settings, 'branch_sign_in_radius_m', 500))
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

function findBranch(branches: BranchRow[], branchName: string): BranchRow | undefined {
  const target = branchName.trim().toLowerCase()
  return branches.find(
    (b) => (b.is_active !== false) && b.name.trim().toLowerCase() === target,
  )
}

export function validateBranchClockIn(params: {
  enforce: boolean
  employeeBranch: string | null | undefined
  branches: BranchRow[]
  radiusMeters: number
  latitude: number | null
  longitude: number | null
}): BranchGeofenceResult {
  const { enforce, employeeBranch, branches, radiusMeters, latitude, longitude } = params
  if (!enforce) return { allowed: true, message: '' }

  const branchName = employeeBranch?.trim() ?? ''
  if (!branchName) return { allowed: true, message: '' }

  const branch = findBranch(branches, branchName)
  if (branch?.latitude == null || branch?.longitude == null) {
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
      branchName,
    }
  }

  const distanceM = haversineMeters(latitude, longitude, branch.latitude, branch.longitude)
  if (distanceM > radiusMeters) {
    return {
      allowed: false,
      message: `You are ${distanceM.toFixed(0)}m away from your branch sign-in location (${branchName}). Move within ${radiusMeters.toFixed(0)}m to clock in.`,
      distanceMeters: distanceM,
      allowedRadiusMeters: radiusMeters,
      branchName,
    }
  }

  return { allowed: true, message: '', distanceMeters: distanceM, allowedRadiusMeters: radiusMeters, branchName }
}

export function getBranchGeofenceStatus(params: {
  enforce: boolean
  employeeBranch: string | null | undefined
  branches: BranchRow[]
  radiusMeters: number
  latitude: number | null
  longitude: number | null
}): BranchGeofenceStatus {
  const { enforce, employeeBranch, branches, radiusMeters, latitude, longitude } = params
  if (!enforce) {
    return { enforcementActive: false, isWithinRadius: true, displayMessage: '' }
  }

  const branchName = employeeBranch?.trim() ?? ''
  if (!branchName) {
    return { enforcementActive: false, isWithinRadius: true, displayMessage: '' }
  }

  const branch = findBranch(branches, branchName)
  if (branch?.latitude == null || branch?.longitude == null) {
    return {
      enforcementActive: true,
      isWithinRadius: false,
      allowedRadiusMeters: radiusMeters,
      branchName,
      displayMessage: `Branch "${branchName}" needs a location in HR Settings before you can clock in.`,
    }
  }

  if (latitude == null || longitude == null) {
    return {
      enforcementActive: true,
      isWithinRadius: false,
      allowedRadiusMeters: radiusMeters,
      branchName,
      displayMessage: 'Turn on location to verify you are at your branch.',
    }
  }

  const distanceM = haversineMeters(latitude, longitude, branch.latitude, branch.longitude)
  const within = distanceM <= radiusMeters
  return {
    enforcementActive: true,
    isWithinRadius: within,
    distanceMeters: distanceM,
    allowedRadiusMeters: radiusMeters,
    branchName,
    displayMessage: within
      ? `Within ${branchName} sign-in area (${distanceM.toFixed(0)}m / ${radiusMeters.toFixed(0)}m)`
      : `Outside ${branchName} sign-in area (${distanceM.toFixed(0)}m away — must be within ${radiusMeters.toFixed(0)}m)`,
  }
}
