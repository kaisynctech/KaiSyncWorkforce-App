import type { SupabaseClient } from '@supabase/supabase-js'
import { CompanyModuleKeys, isModuleEnabled, type EnabledModules } from '@/lib/company-modules'
import { isFeatureEnabled, loadSaasFeatures, type SaasFeatureMap } from '@/lib/saas-features'

/** MAUI: ShowFinanceNav = module.finance SaaS + payroll tenant module. */
export async function canAccessFinance(
  supabase: SupabaseClient,
  companyId: string,
  enabledModules: EnabledModules,
): Promise<boolean> {
  if (!isModuleEnabled(enabledModules, CompanyModuleKeys.Payroll)) return false
  const features = await loadSaasFeatures(supabase, companyId)
  return isFeatureEnabled(features, 'module.finance') || isFeatureEnabled(features, 'finance_module')
}

export async function resolveFinanceNavFlag(
  supabase: SupabaseClient,
  companyId: string,
  enabledModules: EnabledModules,
): Promise<{ finance: boolean; features: SaasFeatureMap }> {
  const features = await loadSaasFeatures(supabase, companyId)
  const finance =
    isModuleEnabled(enabledModules, CompanyModuleKeys.Payroll) &&
    (isFeatureEnabled(features, 'module.finance') || isFeatureEnabled(features, 'finance_module'))
  return { finance, features }
}
