/** Browser event so Sidebar refreshes flags after Settings → Modules save. */

import type { EnabledModules } from '@/lib/company-modules'

export const MODULES_UPDATED_EVENT = 'kaisync:modules-updated'

export type ModulesUpdatedDetail = {
  companyId: string
  enabledModules: EnabledModules
}

export function notifyModulesUpdated(companyId: string, enabledModules: EnabledModules) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<ModulesUpdatedDetail>(MODULES_UPDATED_EVENT, {
      detail: { companyId, enabledModules },
    }),
  )
}
