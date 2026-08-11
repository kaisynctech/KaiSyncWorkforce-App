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

export type ModuleSpec = {
  key: string
  title: string
  description: string
  defaultIfMissing: boolean
}

/** Full key catalogue (used for defaults / persistence). Not shown as individual Settings toggles. */
export const COMPANY_MODULE_SPECS: ModuleSpec[] = [
  { key: CompanyModuleKeys.Ticketing, title: 'Jobs & Projects', description: 'Field jobs and CRM projects.', defaultIfMissing: true },
  { key: CompanyModuleKeys.Clients, title: 'Clients', description: 'Client register, details, linked projects and payments.', defaultIfMissing: true },
  { key: CompanyModuleKeys.Inventory, title: 'Inventory', description: 'Inventory register, stock and usage allocation.', defaultIfMissing: true },
  { key: CompanyModuleKeys.Suppliers, title: 'Suppliers', description: 'Supplier register, procurement links, and inventory sourcing.', defaultIfMissing: true },
  { key: CompanyModuleKeys.Attendance, title: 'Attendance', description: 'Clock-ins, sessions, and attendance history.', defaultIfMissing: true },
  { key: CompanyModuleKeys.Reports, title: 'Reports', description: 'Operational, executive, and compliance reporting.', defaultIfMissing: true },
  { key: CompanyModuleKeys.Scheduling, title: 'Scheduling', description: 'Recurring shift templates and assignments.', defaultIfMissing: true },
  { key: CompanyModuleKeys.Payroll, title: 'Payments', description: 'Salary, hourly rates, payment approvals.', defaultIfMissing: true },
  { key: CompanyModuleKeys.Incidents, title: 'Incidents', description: 'Incident reporting, tracking, and resolution.', defaultIfMissing: true },
  { key: CompanyModuleKeys.Paperless, title: 'Paperless Forms', description: 'Custom forms and digital signatures.', defaultIfMissing: false },
  { key: CompanyModuleKeys.Employees, title: 'Employees', description: 'Employee records, assignments, and access controls.', defaultIfMissing: true },
  { key: CompanyModuleKeys.Contractors, title: 'Contractors', description: 'External service providers with their own scorecard.', defaultIfMissing: true },
  { key: CompanyModuleKeys.PropertyManagement, title: 'Property Management', description: 'Sites, units, residents, and per-unit reporting.', defaultIfMissing: true },
  { key: CompanyModuleKeys.AssetCompliance, title: 'Asset Compliance', description: 'Inspection schedules and certificate expiry tracking.', defaultIfMissing: true },
  { key: CompanyModuleKeys.MyPa, title: 'My PA', description: 'Personal assistant tasks, reminders, and follow-ups.', defaultIfMissing: true },
  { key: CompanyModuleKeys.Leave, title: 'Leave', description: 'Employee leave applications, approvals, and payroll-ready export.', defaultIfMissing: true },
  { key: CompanyModuleKeys.Messaging, title: 'Messaging', description: 'In-app team messaging between employees and management.', defaultIfMissing: true },
  { key: CompanyModuleKeys.Settings, title: 'Settings', description: 'Company profile, module controls, and system preferences.', defaultIfMissing: true },
]

/**
 * Settings → Modules toggles — main product areas (sidebar groups), not every sub-feature.
 * Turning a main module on/off updates all related `enabled_modules` keys together.
 */
export type MainModuleSpec = {
  id: string
  title: string
  /** Keys written together when this main module is toggled. */
  keys: string[]
  /** Key used to decide current on/off state. */
  leadKey: string
  defaultIfMissing: boolean
}

export const MAIN_MODULE_SPECS: MainModuleSpec[] = [
  {
    id: 'workforce',
    title: 'Workforce',
    leadKey: CompanyModuleKeys.Employees,
    keys: [
      CompanyModuleKeys.Employees,
      CompanyModuleKeys.Leave,
      CompanyModuleKeys.Attendance,
      CompanyModuleKeys.Scheduling,
      CompanyModuleKeys.Payroll,
    ],
    defaultIfMissing: true,
  },
  {
    id: 'operations',
    title: 'Jobs & Projects',
    leadKey: CompanyModuleKeys.Ticketing,
    keys: [CompanyModuleKeys.Ticketing],
    defaultIfMissing: true,
  },
  {
    id: 'clients',
    title: 'Clients',
    leadKey: CompanyModuleKeys.Clients,
    keys: [CompanyModuleKeys.Clients],
    defaultIfMissing: true,
  },
  {
    id: 'contractors',
    title: 'Contractors',
    leadKey: CompanyModuleKeys.Contractors,
    keys: [CompanyModuleKeys.Contractors],
    defaultIfMissing: true,
  },
  {
    id: 'supply',
    title: 'Supply & Assets',
    leadKey: CompanyModuleKeys.Inventory,
    keys: [
      CompanyModuleKeys.Inventory,
      CompanyModuleKeys.Suppliers,
      CompanyModuleKeys.AssetCompliance,
    ],
    defaultIfMissing: true,
  },
  {
    id: 'properties',
    title: 'Property Management',
    leadKey: CompanyModuleKeys.PropertyManagement,
    keys: [CompanyModuleKeys.PropertyManagement],
    defaultIfMissing: true,
  },
  {
    id: 'incidents',
    title: 'Incidents',
    leadKey: CompanyModuleKeys.Incidents,
    keys: [CompanyModuleKeys.Incidents],
    defaultIfMissing: true,
  },
  {
    id: 'reports',
    title: 'Reports',
    leadKey: CompanyModuleKeys.Reports,
    keys: [CompanyModuleKeys.Reports],
    defaultIfMissing: true,
  },
  {
    id: 'my_pa',
    title: 'My PA',
    leadKey: CompanyModuleKeys.MyPa,
    keys: [CompanyModuleKeys.MyPa],
    defaultIfMissing: true,
  },
  {
    id: 'messaging',
    title: 'Messaging',
    leadKey: CompanyModuleKeys.Messaging,
    keys: [CompanyModuleKeys.Messaging],
    defaultIfMissing: true,
  },
  {
    id: 'paperless',
    title: 'Paperless Forms',
    leadKey: CompanyModuleKeys.Paperless,
    keys: [CompanyModuleKeys.Paperless],
    defaultIfMissing: false,
  },
]

export function isMainModuleEnabled(
  enabledModules: EnabledModules,
  spec: MainModuleSpec,
): boolean {
  return isModuleEnabled(enabledModules, spec.leadKey, spec.defaultIfMissing)
}

/** Build enabled_modules patch for a main-module toggle. */
export function mainModuleUpdates(spec: MainModuleSpec, enabled: boolean): Record<string, boolean> {
  const updates: Record<string, boolean> = {}
  for (const key of spec.keys) updates[key] = enabled
  // Settings module stays available so admins can always reopen Modules.
  updates[CompanyModuleKeys.Settings] = true
  return updates
}

export function isModuleEnabled(
  enabledModules: EnabledModules,
  key: string,
  defaultIfMissing?: boolean,
): boolean {
  const specDefault = COMPANY_MODULE_SPECS.find(s => s.key === key)?.defaultIfMissing
  const defaultVal = defaultIfMissing ?? DEFAULT_IF_MISSING[key] ?? specDefault ?? true

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

/** HR sidebar visibility flags — module-only (permissions deferred). */
export type HrNavFlags = {
  employees: boolean
  leave: boolean
  attendance: boolean
  jobs: boolean
  projects: boolean
  payroll: boolean
  contractors: boolean
  clients: boolean
  inventory: boolean
  suppliers: boolean
  assets: boolean
  properties: boolean
  incidents: boolean
  reports: boolean
  scheduling: boolean
  myPa: boolean
  workTeams: boolean
  messaging: boolean
  settings: boolean
  compliancePacks: boolean
  timeTemplates: boolean
  teamPunch: boolean
  residents: boolean
  finance: boolean
}

export function resolveHrNavFlags(enabledModules: EnabledModules, financeEntitled = false): HrNavFlags {
  const employees = isModuleEnabled(enabledModules, CompanyModuleKeys.Employees)
  const jobs = isModuleEnabled(enabledModules, CompanyModuleKeys.Ticketing)
  const inventory = isModuleEnabled(enabledModules, CompanyModuleKeys.Inventory)
  const properties = isModuleEnabled(enabledModules, CompanyModuleKeys.PropertyManagement)
  const contractors = isModuleEnabled(enabledModules, CompanyModuleKeys.Contractors)
  const attendance = isModuleEnabled(enabledModules, CompanyModuleKeys.Attendance)
  const scheduling = isModuleEnabled(enabledModules, CompanyModuleKeys.Scheduling)
  const payroll = isModuleEnabled(enabledModules, CompanyModuleKeys.Payroll)

  return {
    employees,
    leave: isModuleEnabled(enabledModules, CompanyModuleKeys.Leave),
    attendance,
    jobs,
    projects: jobs,
    payroll,
    contractors,
    clients: isModuleEnabled(enabledModules, CompanyModuleKeys.Clients),
    inventory,
    suppliers: isModuleEnabled(enabledModules, CompanyModuleKeys.Suppliers),
    assets: isModuleEnabled(enabledModules, CompanyModuleKeys.AssetCompliance),
    properties,
    incidents: isIncidentsEnabled(enabledModules),
    reports: isModuleEnabled(enabledModules, CompanyModuleKeys.Reports),
    scheduling,
    myPa: isModuleEnabled(enabledModules, CompanyModuleKeys.MyPa),
    workTeams: employees,
    messaging: isModuleEnabled(enabledModules, CompanyModuleKeys.Messaging),
    settings: isModuleEnabled(enabledModules, CompanyModuleKeys.Settings),
    compliancePacks: contractors,
    timeTemplates: scheduling || employees,
    teamPunch: attendance,
    residents: properties,
    // MAUI: SaaS module.finance + payroll tenant module
    finance: financeEntitled && payroll,
  }
}

export function buildEnabledModulesMap(
  current: EnabledModules,
  updates: Record<string, boolean>,
): Record<string, boolean> {
  const next: Record<string, boolean> = { ...(current ?? {}) }
  for (const spec of COMPANY_MODULE_SPECS) {
    if (!(spec.key in next)) next[spec.key] = spec.defaultIfMissing
  }
  return { ...next, ...updates }
}
