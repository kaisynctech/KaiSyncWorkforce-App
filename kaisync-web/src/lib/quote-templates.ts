/**
 * Quotation templates (quote_templates): what a quotation shows for a kind of work. Each company starts with the
 * template of each business type it picked (lib/business-types.ts) and can change them in Settings → Money.
 * The quotation screen that uses them is piece 7; quotations without a template look as before.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { businessType, type HeaderField, type QuoteFeature } from '@/lib/business-types'

export type TemplateColumn = { key: string; label: string; visible: boolean; team_only: boolean; custom?: boolean }
export type TemplateDefaults = { valid_days: number; payment_terms_days: number; deposit_pct: number | null; margin_pct: number | null }

export type QuoteTemplate = {
  id: string
  company_id: string
  name: string
  business_type: string | null
  is_default: boolean
  features: QuoteFeature[]
  header_fields: HeaderField[]
  columns: TemplateColumn[]
  defaults: TemplateDefaults
  terms: string | null
  archived_at: string | null
}

export const FEATURE_LABEL: Record<QuoteFeature, string> = {
  products: 'Products & stock',
  services: 'Services & labour',
  packages: 'Packages',
  options: 'Options for the client (Good / Better / Best)',
  cost_margin: 'Cost & margin (team only)',
  ask_suppliers: 'Ask suppliers (Buyout)',
  sections: 'Sections / phases',
  contingency: 'Contingency %',
  deposit: 'Deposit',
  versions: 'Versions',
  recurring: 'Monthly / recurring amounts',
  per_person: 'Price per person',
  measurements: 'Measurements (m², m, units)',
}
export const ALL_FEATURES = Object.keys(FEATURE_LABEL) as QuoteFeature[]

export const HEADER_LABEL: Record<HeaderField, string> = {
  vehicle: 'Vehicle / machine',
  client_order_no: 'Client order no.',
  event_date: 'Event date',
  site_address: 'Site address',
  contract_term: 'Contract term',
}
export const ALL_HEADERS = Object.keys(HEADER_LABEL) as HeaderField[]

export const COLUMN_LABEL: Record<string, string> = {
  item: 'Item', part_no: 'Part no.', brand: 'Brand', condition: 'Condition', warranty: 'Warranty',
  unit: 'Unit', qty: 'Qty', days: 'Days', rate: 'Rate', price: 'Price', total: 'Total', cost: 'Cost', margin: 'Margin',
}
const TEAM_ONLY = new Set(['cost', 'margin'])

export const DEFAULT_TERMS = 'Prices are valid until the date shown. Work starts once the quotation is accepted and any deposit is paid.'

/** A template to start from for a business type (not saved yet). */
export function templateFromBusinessType(key: string): Omit<QuoteTemplate, 'id' | 'company_id' | 'is_default' | 'archived_at'> | null {
  const t = businessType(key)
  if (!t) return null
  return {
    name: t.quote.templateName,
    business_type: t.key,
    features: t.quote.features,
    header_fields: t.quote.header,
    columns: t.quote.columns.map(c => ({ key: c, label: COLUMN_LABEL[c] ?? c, visible: true, team_only: TEAM_ONLY.has(c) })),
    defaults: { valid_days: t.quote.validDays, payment_terms_days: 30, deposit_pct: t.quote.depositPct, margin_pct: t.quote.features.includes('cost_margin') ? 20 : null },
    terms: DEFAULT_TERMS,
  }
}

export async function loadTemplates(supabase: SupabaseClient, companyId: string): Promise<QuoteTemplate[]> {
  const { data, error } = await supabase.from('quote_templates')
    .select('id, company_id, name, business_type, is_default, features, header_fields, columns, defaults, terms, archived_at')
    .eq('company_id', companyId).is('archived_at', null).order('is_default', { ascending: false }).order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as QuoteTemplate[]
}

/** Business types are saved through the database step (owner / admin / HR); new types get their starting template. */
export async function saveBusinessTypes(
  supabase: SupabaseClient, companyId: string, types: string[], opts: { markSetup?: boolean } = {},
): Promise<void> {
  const { error } = await supabase.rpc('set_business_types', { p_company_id: companyId, p_types: types, p_mark_setup: !!opts.markSetup })
  if (error) throw new Error(/NOT_ALLOWED/.test(error.message) ? 'Only the owner, admins and HR can change this.' : error.message)
  const existing = await loadTemplates(supabase, companyId)
  const have = new Set(existing.map(t => t.business_type).filter(Boolean))
  const missing = types.filter(k => !have.has(k))
  let hasDefault = existing.some(t => t.is_default)
  for (const k of missing) {
    const base = templateFromBusinessType(k)
    if (!base) continue
    const { error: e } = await supabase.from('quote_templates').insert({ ...base, company_id: companyId, is_default: !hasDefault && k === types[0] })
    if (e) throw new Error(e.message)
    if (!hasDefault && k === types[0]) hasDefault = true
  }
  // The main business's template is the default when none is set yet.
  if (!hasDefault && types[0]) {
    const main = (await loadTemplates(supabase, companyId)).find(t => t.business_type === types[0])
    if (main) await setDefaultTemplate(supabase, companyId, main.id)
  }
}

export async function setDefaultTemplate(supabase: SupabaseClient, companyId: string, id: string) {
  const { error: e1 } = await supabase.from('quote_templates').update({ is_default: false }).eq('company_id', companyId).eq('is_default', true)
  if (e1) throw new Error(e1.message)
  const { error: e2 } = await supabase.from('quote_templates').update({ is_default: true, updated_at: new Date().toISOString() }).eq('id', id).eq('company_id', companyId)
  if (e2) throw new Error(e2.message)
}

export async function saveTemplate(supabase: SupabaseClient, t: QuoteTemplate) {
  const { error } = await supabase.from('quote_templates').update({
    name: t.name.trim() || 'Template', features: t.features, header_fields: t.header_fields, columns: t.columns,
    defaults: t.defaults, terms: t.terms?.trim() || null, updated_at: new Date().toISOString(),
  }).eq('id', t.id).eq('company_id', t.company_id)
  if (error) throw new Error(error.message)
}

export async function archiveTemplate(supabase: SupabaseClient, t: QuoteTemplate) {
  if (t.is_default) throw new Error('Make another template the default first.')
  const { error } = await supabase.from('quote_templates').update({ archived_at: new Date().toISOString() }).eq('id', t.id).eq('company_id', t.company_id)
  if (error) throw new Error(error.message)
}

export async function addBlankTemplate(supabase: SupabaseClient, companyId: string, fromKey: string | null, name: string) {
  const base = (fromKey && templateFromBusinessType(fromKey)) || {
    name, business_type: null, features: ['products', 'services'] as QuoteFeature[], header_fields: [] as HeaderField[],
    columns: ['item', 'qty', 'price', 'total'].map(c => ({ key: c, label: COLUMN_LABEL[c], visible: true, team_only: false })),
    defaults: { valid_days: 14, payment_terms_days: 30, deposit_pct: null, margin_pct: null }, terms: DEFAULT_TERMS,
  }
  const { data, error } = await supabase.from('quote_templates').insert({ ...base, name: name.trim() || base.name, company_id: companyId, is_default: false })
    .select('id').maybeSingle()
  if (error) throw new Error(error.message)
  return (data as { id: string } | null)?.id ?? null
}
