/**
 * Mirrors MAUI FeatureAccessService — plan + company feature overrides.
 * Anti-lockout: if subscription cannot be loaded, features are permitted.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type SaasFeatureMap = Record<string, boolean>

let cache: { companyId: string; features: SaasFeatureMap; loadedAt: number } | null = null

function nestedBool(root: Record<string, unknown> | null | undefined, section: string, key: string): boolean | null {
  if (!root) return null
  const sec = root[section]
  if (!sec || typeof sec !== 'object') return null
  const val = (sec as Record<string, unknown>)[key]
  if (typeof val === 'boolean') return val
  return null
}

function resolveFromPlanFeatures(featuresJson: Record<string, unknown> | null, featureCode: string): boolean {
  if (!featuresJson || Object.keys(featuresJson).length === 0) return true

  if (featureCode.startsWith('module.')) {
    const modKey = featureCode.slice('module.'.length)
    const modVal = nestedBool(featuresJson, 'modules', modKey)
    if (modVal != null) return modVal
  }

  const featVal = nestedBool(featuresJson, 'features', featureCode)
  if (featVal != null) return featVal

  // Seed plans use features.finance_module while code uses module.finance
  if (featureCode === 'module.finance') {
    const alias = nestedBool(featuresJson, 'features', 'finance_module')
    if (alias != null) return alias
  }
  if (featureCode === 'finance_module') {
    const alias = nestedBool(featuresJson, 'modules', 'finance')
    if (alias != null) return alias
  }

  return true
}

export async function loadSaasFeatures(
  supabase: SupabaseClient,
  companyId: string,
): Promise<SaasFeatureMap> {
  if (cache && cache.companyId === companyId && Date.now() - cache.loadedAt < 60_000) {
    return cache.features
  }

  const features: SaasFeatureMap = {}

  try {
    const { data: sub } = await supabase.rpc('saas_get_company_subscription', {
      p_company_id: companyId,
    })

    const row = (Array.isArray(sub) ? sub[0] : sub) as Record<string, unknown> | null
    if (row) {
      const status = String(row.subscription_status ?? row.status ?? 'active').toLowerCase()
      const isActive = !['cancelled', 'expired', 'suspended'].includes(status)
      const planFeatures = (row.features_json ?? {}) as Record<string, unknown>

      // Encode common codes from plan
      for (const code of ['module.finance', 'finance_module', 'module.payroll', 'module.reports']) {
        features[code] = isActive ? resolveFromPlanFeatures(planFeatures, code) : false
      }
      // Store permissive defaults for unknown codes when active
      features.__active = isActive
      features.__loaded = true
    } else {
      // No subscription → legacy permissive
      features.__active = true
      features.__loaded = true
      features.__permissive = true
    }

    const { data: overrides } = await supabase
      .from('saas_company_features')
      .select('feature_code, is_enabled, expires_at')
      .eq('company_id', companyId)

    for (const ov of overrides ?? []) {
      const code = String(ov.feature_code)
      if (ov.expires_at && new Date(String(ov.expires_at)) < new Date()) continue
      features[code] = Boolean(ov.is_enabled)
    }
  } catch {
    features.__active = true
    features.__loaded = false
    features.__permissive = true
  }

  cache = { companyId, features, loadedAt: Date.now() }
  return features
}

export function isFeatureEnabled(features: SaasFeatureMap, featureCode: string): boolean {
  if (features.__permissive) return true
  if (featureCode in features) return Boolean(features[featureCode])

  // Alias module.finance ↔ finance_module
  if (featureCode === 'module.finance' && 'finance_module' in features) {
    return Boolean(features.finance_module)
  }
  if (featureCode === 'finance_module' && 'module.finance' in features) {
    return Boolean(features['module.finance'])
  }

  // Unlisted feature on an active plan → allow (MAUI ResolveFromPlanFeatures default true)
  if (features.__active) return true
  return false
}

export function clearSaasFeatureCache() {
  cache = null
}
