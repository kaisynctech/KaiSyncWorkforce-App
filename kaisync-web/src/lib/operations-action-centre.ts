/**
 * Operations Action Centre — shared loaders + deep-link open handlers.
 * Preserves the same item rules and routes previously used on each list page.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ClientActionItem,
  ContractorActionItem,
  ProjectActionItem,
} from '@/types/database'
import { isWarrantyExpired, isWarrantyExpiringSoon } from '@/lib/supply-assets'
import { can, PERM, type PermissionSet } from '@/lib/permissions'
import type { HrNavFlags } from '@/lib/company-modules'

export type OpsActionDomain = 'clients' | 'projects' | 'contractors' | 'incidents' | 'assets'

export type OpsActionItem = {
  key: string
  domain: OpsActionDomain
  action_type: string
  title: string
  summary: string
  created_at: string | null
  /** RPC ref / document id / incident id / synthetic asset key */
  ref_id: string
  /** Primary entity to open (client, project, contractor, incident, asset) */
  entity_id: string
}

export const OPS_ACTION_TABS: { id: OpsActionDomain; label: string }[] = [
  { id: 'clients', label: 'Clients' },
  { id: 'projects', label: 'Projects' },
  { id: 'contractors', label: 'Contractors' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'assets', label: 'Assets' },
]

export const OPS_ACTION_TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  deal_attention: { bg: '#DBEAFE', fg: '#1E40AF' },
  portal_message: { bg: '#E0E7FF', fg: '#3730A3' },
  deposit_due: { bg: '#FEF3C7', fg: '#92400E' },
  deal_stale: { bg: '#E5E7EB', fg: '#374151' },
  stale_deal: { bg: '#E5E7EB', fg: '#374151' },
  quotation_pending: { bg: '#DBEAFE', fg: '#1E40AF' },
  invoice_overdue: { bg: '#FEE2E2', fg: '#991B1B' },
  invoice_outstanding: { bg: '#FEF3C7', fg: '#92400E' },
  banking_pending: { bg: '#FEF3C7', fg: '#92400E' },
  document_pending: { bg: '#E5E7EB', fg: '#374151' },
  document_expiring: { bg: '#FEE2E2', fg: '#991B1B' },
  quote_pending: { bg: '#DBEAFE', fg: '#1E40AF' },
  warranty_expired: { bg: '#FEE2E2', fg: '#991B1B' },
  warranty_expiring: { bg: '#FEF3C7', fg: '#92400E' },
  out_of_service: { bg: '#FEF3C7', fg: '#92400E' },
  unassigned: { bg: '#E5E7EB', fg: '#374151' },
  critical: { bg: '#FEE2E2', fg: '#991B1B' },
  high: { bg: '#FEF3C7', fg: '#92400E' },
  medium: { bg: '#DBEAFE', fg: '#1E40AF' },
  low: { bg: '#DCFCE7', fg: '#166534' },
}

export function opsActionColor(actionType: string) {
  return OPS_ACTION_TYPE_COLORS[actionType] ?? { bg: '#E5E7EB', fg: '#374151' }
}

function parseRpcList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as T[]) : []
    } catch {
      return []
    }
  }
  return []
}

/** Domains the signed-in HR user may see (module flag + permission). */
export function visibleOpsActionDomains(
  flags: HrNavFlags,
  perms: PermissionSet | null,
): OpsActionDomain[] {
  const out: OpsActionDomain[] = []
  if (flags.clients && can(perms, PERM.clientsView)) out.push('clients')
  if (flags.projects && can(perms, PERM.projectsView)) out.push('projects')
  if (flags.contractors && can(perms, PERM.contractorsView)) out.push('contractors')
  if (flags.incidents && can(perms, PERM.incidentsView)) out.push('incidents')
  if (flags.assets && can(perms, PERM.assetsView)) out.push('assets')
  return out
}

export async function loadOpsActionItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  companyId: string,
  domains: OpsActionDomain[],
): Promise<Record<OpsActionDomain, OpsActionItem[]>> {
  const empty: Record<OpsActionDomain, OpsActionItem[]> = {
    clients: [],
    projects: [],
    contractors: [],
    incidents: [],
    assets: [],
  }
  if (domains.length === 0) return empty

  const tasks: Promise<void>[] = []

  if (domains.includes('clients')) {
    tasks.push((async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('hr_get_client_action_items', {
        p_company_id: companyId,
      })
      if (error) return
      const rows = parseRpcList<ClientActionItem>(data)
        // Same filter as the Clients list Action Centre (Money items stay for Money Phase 2).
        .filter(item => !item.action_type.startsWith('invoice_'))
      empty.clients = rows.map(item => ({
        key: `clients:${item.action_type}:${item.ref_id}`,
        domain: 'clients',
        action_type: item.action_type,
        title: item.client_name ?? '—',
        summary: item.summary,
        created_at: item.created_at ?? null,
        ref_id: item.ref_id,
        entity_id: item.client_id,
      }))
    })())
  }

  if (domains.includes('projects')) {
    tasks.push((async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('hr_get_project_action_items', {
        p_company_id: companyId,
      })
      if (error) return
      const rows = parseRpcList<ProjectActionItem>(data)
        .filter(item => item.action_type !== 'invoice_overdue' && item.action_type !== 'quotation_pending')
      empty.projects = rows.map(item => ({
        key: `projects:${item.action_type}:${item.ref_id}`,
        domain: 'projects',
        action_type: item.action_type,
        title: [item.project_code, item.project_title].filter(Boolean).join(' · ') || '—',
        summary: item.summary,
        created_at: item.created_at ?? null,
        ref_id: item.ref_id,
        entity_id: item.project_id,
      }))
    })())
  }

  if (domains.includes('contractors')) {
    tasks.push((async () => {
      const { data, error } = await supabase.rpc('hr_get_contractor_action_items', {
        p_company_id: companyId,
      })
      if (error) return
      const rows = parseRpcList<ContractorActionItem>(data)
        .filter(item => item.action_type !== 'quote_pending')
      empty.contractors = rows.map(item => ({
        key: `contractors:${item.action_type}:${item.ref_id}`,
        domain: 'contractors',
        action_type: item.action_type,
        title: item.contractor_name ?? '—',
        summary: item.summary,
        created_at: item.created_at ?? null,
        ref_id: item.ref_id,
        entity_id: item.contractor_id,
      }))
    })())
  }

  if (domains.includes('incidents')) {
    tasks.push((async () => {
      const { data, error } = await supabase
        .from('incident_reports')
        .select('id, title, description, severity, status, assignee_id, created_at')
        .eq('company_id', companyId)
        .in('status', ['open', 'investigating'])
        .order('created_at', { ascending: true })
        .limit(40)
      if (error) return
      const items: OpsActionItem[] = []
      for (const row of data ?? []) {
        const sev = (row.severity ?? '').toLowerCase()
        const include = sev === 'critical' || row.assignee_id == null
        if (!include) continue
        items.push({
          key: `incidents:${row.id}`,
          domain: 'incidents',
          action_type: sev || 'open',
          title: (row.title ?? row.description ?? 'Incident') as string,
          summary: String(row.status ?? 'open').replace(/_/g, ' '),
          created_at: row.created_at ?? null,
          ref_id: row.id,
          entity_id: row.id,
        })
        if (items.length >= 12) break
      }
      empty.incidents = items
    })())
  }

  if (domains.includes('assets')) {
    tasks.push((async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, label, status, warranty_expires, assigned_employee_id')
        .eq('company_id', companyId)
        .neq('status', 'retired')
        .order('label')
        .limit(400)
      if (error) return
      const actions: OpsActionItem[] = []
      for (const a of data ?? []) {
        const label = (a.label as string | null)?.trim() || 'Untitled asset'
        const id = a.id as string
        if (isWarrantyExpired(a.warranty_expires as string | null)) {
          actions.push({
            key: `assets:${id}-wexp`,
            domain: 'assets',
            action_type: 'warranty_expired',
            title: label,
            summary: 'Warranty expired — review service / replace coverage',
            created_at: null,
            ref_id: `${id}-wexp`,
            entity_id: id,
          })
        } else if (isWarrantyExpiringSoon(a.warranty_expires as string | null)) {
          actions.push({
            key: `assets:${id}-wsoon`,
            domain: 'assets',
            action_type: 'warranty_expiring',
            title: label,
            summary: 'Warranty expiring within 30 days',
            created_at: null,
            ref_id: `${id}-wsoon`,
            entity_id: id,
          })
        }
        if (a.status === 'out_of_service') {
          actions.push({
            key: `assets:${id}-oos`,
            domain: 'assets',
            action_type: 'out_of_service',
            title: label,
            summary: 'Out of service — unavailable for use',
            created_at: null,
            ref_id: `${id}-oos`,
            entity_id: id,
          })
        }
        if (!a.assigned_employee_id && a.status === 'active') {
          actions.push({
            key: `assets:${id}-un`,
            domain: 'assets',
            action_type: 'unassigned',
            title: label,
            summary: 'Unassigned custody — no employee assigned',
            created_at: null,
            ref_id: `${id}-un`,
            entity_id: id,
          })
        }
      }
      empty.assets = actions.slice(0, 25)
    })())
  }

  await Promise.all(tasks)
  return empty
}

/** Exact deep-links previously used on each list Action Centre. */
export async function openOpsActionItem(
  item: OpsActionItem,
  router: { push: (href: string) => void },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
): Promise<void> {
  if (item.domain === 'clients') {
    if (item.action_type.startsWith('invoice_')) {
      router.push(`/dashboard/money/invoices/${item.ref_id}`)
      return
    }
    if (item.action_type === 'deal_attention') {
      router.push(`/dashboard/projects/${item.ref_id}`)
      return
    }
    if (item.action_type === 'portal_message') {
      const { data: msg } = await supabase
        .from('app_messages')
        .select('thread_id')
        .eq('id', item.ref_id)
        .maybeSingle()
      const threadId = (msg as { thread_id?: string } | null)?.thread_id
      if (threadId) {
        router.push(`/dashboard/messages?threadId=${threadId}`)
        return
      }
      router.push(`/dashboard/clients/${item.entity_id}`)
      return
    }
    router.push(`/dashboard/clients/${item.entity_id}`)
    return
  }

  if (item.domain === 'projects') {
    if (item.action_type === 'invoice_overdue') {
      router.push(`/dashboard/finance/invoices/${item.ref_id}`)
      return
    }
    if (item.action_type === 'quotation_pending') {
      router.push(`/dashboard/projects/${item.entity_id}?tab=quotation`)
      return
    }
    if (item.action_type === 'deposit_due') {
      router.push(`/dashboard/projects/${item.entity_id}?tab=payments`)
      return
    }
    if (item.action_type === 'portal_message') {
      const { data: msg } = await supabase
        .from('app_messages')
        .select('thread_id')
        .eq('id', item.ref_id)
        .maybeSingle()
      const threadId = (msg as { thread_id?: string } | null)?.thread_id
      if (threadId) {
        router.push(`/dashboard/messages?threadId=${threadId}`)
        return
      }
      router.push(`/dashboard/projects/${item.entity_id}`)
      return
    }
    if (item.action_type === 'deal_stale' || item.action_type === 'stale_deal') {
      router.push(`/dashboard/projects/${item.entity_id}?tab=pipeline`)
      return
    }
    router.push(`/dashboard/projects/${item.entity_id}`)
    return
  }

  if (item.domain === 'contractors') {
    const tab =
      item.action_type === 'banking_pending' ? 'Payments'
        : item.action_type.startsWith('document_') ? 'Compliance'
          : item.action_type === 'quote_pending' ? 'Quotes'
            : 'Information'
    router.push(
      `/dashboard/contractors/${item.entity_id}?tab=${encodeURIComponent(tab)}&focus=${encodeURIComponent(item.ref_id)}&focusType=${encodeURIComponent(item.action_type)}`,
    )
    return
  }

  if (item.domain === 'incidents') {
    router.push(`/dashboard/incidents/${item.entity_id}`)
    return
  }

  if (item.domain === 'assets') {
    // Assets has no detail route — open the list editor via query param.
    router.push(`/dashboard/assets?edit=${encodeURIComponent(item.entity_id)}`)
  }
}
