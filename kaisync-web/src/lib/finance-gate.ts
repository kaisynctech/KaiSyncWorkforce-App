import type { SupabaseClient } from '@supabase/supabase-js'
import { CompanyModuleKeys, isModuleEnabled, type EnabledModules } from '@/lib/company-modules'
import { isFeatureEnabled, loadSaasFeatures, type SaasFeatureMap } from '@/lib/saas-features'

/** Finance: the Money module plus the plan's finance feature. */
export async function canAccessFinance(
  supabase: SupabaseClient,
  companyId: string,
  enabledModules: EnabledModules,
): Promise<boolean> {
  if (!isModuleEnabled(enabledModules, CompanyModuleKeys.Money)) return false
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
    isModuleEnabled(enabledModules, CompanyModuleKeys.Money) &&
    (isFeatureEnabled(features, 'module.finance') || isFeatureEnabled(features, 'finance_module'))
  return { finance, features }
}
