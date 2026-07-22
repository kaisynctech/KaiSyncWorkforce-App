/**
 * Mirrors KaiFlow.Timesheets.Helpers.CompanyModules
 * Keys align with companies.enabled_modules JSONB.
 */

export const CompanyModuleKeys = {
  Ticketing: 'ticketing',
  Clients: 'clients',
  Inventory: 'inventory',
  Suppliers: 'suppliers',
  Attendance: 'attendance',
  Reports: 'reports',
  Scheduling: 'scheduling',
  Payroll: 'payroll',
  Paperless: 'paperless',
  Incidents: 'incidents',
  Employees: 'employees',
  Contractors: 'contractors',
  PropertyManagement: 'property_management',
  AssetCompliance: 'asset_compliance',
  MyPa: 'my_pa',
  Leave: 'leave',
  Messaging: 'messaging',
  Settings: 'settings',
  LegacyProperties: 'properties',
} as const

export type CompanyModuleKey = (typeof CompanyModuleKeys)[keyof typeof CompanyModuleKeys]

const DEFAULT_IF_MISSING: Record<string, boolean> = {
  [CompanyModuleKeys.Paperless]: false,
}

export type EnabledModules = Record<string, boolean> | null | undefined

export function isModuleEnabled(
  enabledModules: EnabledModules,
  key: string,
  defaultIfMissing?: boolean,
): boolean {
  const defaultVal = defaultIfMissing ?? DEFAULT_IF_MISSING[key] ?? true

  if (!enabledModules || Object.keys(enabledModules).length === 0) {
    return defaultVal
  }

  if (key === CompanyModuleKeys.PropertyManagement) {
    if (key in enabledModules) return Boolean(enabledModules[key])
    if (CompanyModuleKeys.LegacyProperties in enabledModules) {
      return Boolean(enabledModules[CompanyModuleKeys.LegacyProperties])
    }
    return defaultVal
  }

  if (key === CompanyModuleKeys.Suppliers) {
    if (CompanyModuleKeys.Suppliers in enabledModules) {
      return Boolean(enabledModules[CompanyModuleKeys.Suppliers])
    }
    if (CompanyModuleKeys.Inventory in enabledModules) {
      return Boolean(enabledModules[CompanyModuleKeys.Inventory])
    }
    return defaultVal
  }

  if (key in enabledModules) return Boolean(enabledModules[key])
  return defaultVal
}

/** Incidents module with legacy paperless fallback (MAUI IsIncidentsEnabled). */
export function isIncidentsEnabled(enabledModules: EnabledModules): boolean {
  if (isModuleEnabled(enabledModules, CompanyModuleKeys.Incidents)) return true
  // Legacy: some tenants only had paperless for incident-like forms
  return isModuleEnabled(enabledModules, CompanyModuleKeys.Paperless, false)
}

export type EmployeeModuleFlags = {
  attendance: boolean
  leave: boolean
  jobs: boolean
  scheduling: boolean
  incidents: boolean
  myPa: boolean
  paperless: boolean
  payroll: boolean
  contractors: boolean
  messaging: boolean
}

export function resolveEmployeeModuleFlags(enabledModules: EnabledModules): EmployeeModuleFlags {
  return {
    attendance: isModuleEnabled(enabledModules, CompanyModuleKeys.Attendance),
    leave: isModuleEnabled(enabledModules, CompanyModuleKeys.Leave),
    jobs: isModuleEnabled(enabledModules, CompanyModuleKeys.Ticketing),
    scheduling: isModuleEnabled(enabledModules, CompanyModuleKeys.Scheduling),
    incidents: isIncidentsEnabled(enabledModules),
    myPa: isModuleEnabled(enabledModules, CompanyModuleKeys.MyPa),
    paperless: isModuleEnabled(enabledModules, CompanyModuleKeys.Paperless, false),
    payroll: isModuleEnabled(enabledModules, CompanyModuleKeys.Payroll),
    contractors: isModuleEnabled(enabledModules, CompanyModuleKeys.Contractors),
    messaging: isModuleEnabled(enabledModules, CompanyModuleKeys.Messaging),
  }
}

export const ALL_MODULES_ENABLED: EmployeeModuleFlags = {
  attendance: true,
  leave: true,
  jobs: true,
  scheduling: true,
  incidents: true,
  myPa: true,
  paperless: true,
  payroll: true,
  contractors: true,
  messaging: true,
}
