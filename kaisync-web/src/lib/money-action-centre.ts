/**
 * Money Action Centre — shared loaders + deep-link open handlers.
 * Surfaces money items previously filtered out of Operations (and Quotes/Invoices strips).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ClientActionItem,
  ContractorActionItem,
  ProjectActionItem,
} from '@/types/database'
import { can, PERM, type PermissionSet } from '@/lib/permissions'
import type { HrNavFlags } from '@/lib/company-modules'

export type MoneyActionDomain = 'invoices' | 'quotes' | 'approvals' | 'suppliers'

export type MoneyActionItem = {
  key: string
  domain: MoneyActionDomain
  action_type: string
  title: string
  summary: string
  created_at: string | null
  ref_id: string
  entity_id: string
}

export const MONEY_ACTION_TABS: { id: MoneyActionDomain; label: string }[] = [
  { id: 'invoices', label: 'Invoices' },
  { id: 'quotes', label: 'Quotes' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'suppliers', label: 'Suppliers' },
]

export const MONEY_ACTION_TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  invoice_overdue: { bg: '#FEE2E2', fg: '#991B1B' },
  invoice_outstanding: { bg: '#FEF3C7', fg: '#92400E' },
  quotation_pending: { bg: '#DBEAFE', fg: '#1E40AF' },
  quote_pending: { bg: '#DBEAFE', fg: '#1E40AF' },
  supplier_approval: { bg: '#FEF3C7', fg: '#92400E' },
  payout_pending: { bg: '#FEF3C7', fg: '#92400E' },
  payout_approved: { bg: '#DBEAFE', fg: '#1E40AF' },
  payment_hold: { bg: '#FEF3C7', fg: '#92400E' },
  compliance_hold: { bg: '#FEE2E2', fg: '#991B1B' },
  banking_pending: { bg: '#E5E7EB', fg: '#374151' },
}

export function moneyActionColor(actionType: string) {
  return MONEY_ACTION_TYPE_COLORS[actionType] ?? { bg: '#E5E7EB', fg: '#374151' }
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

export function visibleMoneyActionDomains(
  flags: HrNavFlags,
  perms: PermissionSet | null,
): MoneyActionDomain[] {
  const out: MoneyActionDomain[] = []
  // Commercial Money module + the same entity view perms the source RPCs/pages require.
  if (flags.commercial && (can(perms, PERM.clientsView) || can(perms, PERM.projectsView))) {
    out.push('invoices')
  }
  if (flags.commercial && (can(perms, PERM.contractorsView) || can(perms, PERM.projectsView))) {
    out.push('quotes')
  }
  if (flags.finance || flags.commercial) out.push('approvals')
  if ((flags.commercial || flags.suppliers) && can(perms, PERM.suppliersView)) out.push('suppliers')
  return out
}

export async function loadMoneyActionItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  companyId: string,
  domains: MoneyActionDomain[],
): Promise<Record<MoneyActionDomain, MoneyActionItem[]>> {
  const empty: Record<MoneyActionDomain, MoneyActionItem[]> = {
    invoices: [],
    quotes: [],
    approvals: [],
    suppliers: [],
  }
  if (domains.length === 0) return empty

  const tasks: Promise<void>[] = []

  if (domains.includes('invoices')) {
    tasks.push((async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rpc = supabase.rpc as any
        const [clientRes, projectRes] = await Promise.all([
          rpc('hr_get_client_action_items', { p_company_id: companyId }),
          rpc('hr_get_project_action_items', { p_company_id: companyId }),
        ])

        const fromClients = parseRpcList<ClientActionItem>(clientRes?.data)
          .filter(item => item.action_type?.startsWith('invoice_'))
          .map(item => ({
            key: `invoices:client:${item.action_type}:${item.ref_id}`,
            domain: 'invoices' as const,
            action_type: item.action_type,
            title: item.client_name || 'Client',
            summary: item.summary,
            created_at: item.created_at ?? null,
            ref_id: item.ref_id,
            entity_id: item.client_id,
          }))

        // Ops excluded project invoice_overdue — surface it here (money invoice route).
        const fromProjects = parseRpcList<ProjectActionItem>(projectRes?.data)
          .filter(item => item.action_type === 'invoice_overdue')
          .map(item => ({
            key: `invoices:project:${item.action_type}:${item.ref_id}`,
            domain: 'invoices' as const,
            action_type: item.action_type,
            title: item.project_title || 'Project',
            summary: item.summary,
            created_at: item.created_at ?? null,
            ref_id: item.ref_id,
            entity_id: item.project_id,
          }))

        empty.invoices = [...fromClients, ...fromProjects]
      } catch (err) {
        console.error('money AC invoices load failed', err)
      }
    })())
  }

  if (domains.includes('quotes')) {
    tasks.push((async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rpc = supabase.rpc as any
        const [contractorRes, projectRes] = await Promise.all([
          rpc('hr_get_contractor_action_items', { p_company_id: companyId }),
          rpc('hr_get_project_action_items', { p_company_id: companyId }),
        ])

        const fromContractors = parseRpcList<ContractorActionItem>(contractorRes?.data)
          .filter(item => item.action_type === 'quote_pending')
          .map(item => ({
            key: `quotes:contractor:${item.ref_id}`,
            domain: 'quotes' as const,
            action_type: 'quote_pending',
            title: item.contractor_name || 'Contractor',
            summary: item.summary,
            created_at: item.created_at ?? null,
            ref_id: item.ref_id,
            entity_id: item.contractor_id,
          }))

        const fromProjects = parseRpcList<ProjectActionItem>(projectRes?.data)
          .filter(item => item.action_type === 'quotation_pending')
          .map(item => ({
            key: `quotes:project:${item.ref_id}`,
            domain: 'quotes' as const,
            action_type: 'quotation_pending',
            title: item.project_title || 'Project',
            summary: item.summary,
            created_at: item.created_at ?? null,
            ref_id: item.ref_id,
            entity_id: item.project_id,
          }))

        empty.quotes = [...fromContractors, ...fromProjects]
      } catch (err) {
        console.error('money AC quotes load failed', err)
      }
    })())
  }

  if (domains.includes('approvals')) {
    tasks.push((async () => {
      try {
        // Same queries as /dashboard/finance/approvals (verified existing behaviour).
        // contractor_payouts uses total_amount (not amount).
        const [siRes, poRes] = await Promise.all([
          supabase
            .from('supplier_invoices')
            .select('id, invoice_number, approval_status, total_amount, created_at, contractors!supplier_invoices_supplier_id_fkey(name)')
            .eq('company_id', companyId)
            .eq('approval_status', 'pending')
            .order('created_at', { ascending: false })
            .limit(40),
          supabase
            .from('contractor_payouts')
            .select('id, payout_status, approval_status, total_amount, created_at, contractors(name)')
            .eq('company_id', companyId)
            .in('payout_status', ['pending', 'approved'])
            .order('created_at', { ascending: false })
            .limit(40),
        ])

        if (siRes.error) console.error('money AC supplier invoices', siRes.error.message)
        if (poRes.error) console.error('money AC contractor payouts', poRes.error.message)

        const bills: MoneyActionItem[] = (siRes.data ?? []).map(row => {
          const contractor = row.contractors as { name?: string } | null
          return {
            key: `approvals:si:${row.id}`,
            domain: 'approvals',
            action_type: 'supplier_approval',
            title: contractor?.name || 'Supplier',
            summary: `Supplier invoice ${row.invoice_number ?? String(row.id).slice(0, 8)} awaiting approval`,
            created_at: (row.created_at as string | null) ?? null,
            ref_id: row.id as string,
            entity_id: row.id as string,
          }
        })

        const payouts: MoneyActionItem[] = (poRes.data ?? [])
          .filter(row => {
            const approval = row.approval_status as string | null
            const payout = row.payout_status as string | null
            return approval === 'pending' || payout === 'pending' || payout === 'approved'
          })
          .map(row => {
            const contractor = row.contractors as { name?: string } | null
            const status = (row.payout_status as string) || 'pending'
            const total = row.total_amount
            return {
              key: `approvals:payout:${row.id}`,
              domain: 'approvals',
              action_type: status === 'approved' ? 'payout_approved' : 'payout_pending',
              title: contractor?.name || 'Contractor',
              summary: `Payout ${status}${total != null ? ` · R ${Number(total).toLocaleString('en-ZA')}` : ''}`,
              created_at: (row.created_at as string | null) ?? null,
              ref_id: row.id as string,
              entity_id: row.id as string,
            }
          })

        empty.approvals = [...bills, ...payouts]
      } catch (err) {
        console.error('money AC approvals load failed', err)
      }
    })())
  }

  if (domains.includes('suppliers')) {
    tasks.push((async () => {
      try {
        const { data, error } = await supabase
          .from('contractors')
          .select('id, name, is_active, payment_hold, compliance_hold, banking_verified, bank_name, bank_account')
          .eq('company_id', companyId)
          .or('partner_kind.eq.supplier,partner_kind.eq.both')
          .order('name')
          .limit(300)
        if (error) {
          console.error('money AC suppliers', error.message)
          return
        }

        const actions: MoneyActionItem[] = []
        for (const s of data ?? []) {
          const name = (s.name as string) || 'Supplier'
          const id = s.id as string
          if (s.payment_hold) {
            actions.push({
              key: `suppliers:${id}-pay`,
              domain: 'suppliers',
              action_type: 'payment_hold',
              title: name,
              summary: 'Payouts blocked for this supplier',
              created_at: null,
              ref_id: `${id}-pay`,
              entity_id: id,
            })
          }
          if (s.compliance_hold) {
            actions.push({
              key: `suppliers:${id}-comp`,
              domain: 'suppliers',
              action_type: 'compliance_hold',
              title: name,
              summary: 'Compliance incomplete — review documents',
              created_at: null,
              ref_id: `${id}-comp`,
              entity_id: id,
            })
          }
          if (!s.banking_verified && s.bank_name && s.bank_account) {
            actions.push({
              key: `suppliers:${id}-bank`,
              domain: 'suppliers',
              action_type: 'banking_pending',
              title: name,
              summary: 'Bank details on file but not verified',
              created_at: null,
              ref_id: `${id}-bank`,
              entity_id: id,
            })
          }
        }
        empty.suppliers = actions.slice(0, 25)
      } catch (err) {
        console.error('money AC suppliers load failed', err)
      }
    })())
  }

  await Promise.all(tasks)
  return empty
}

export async function openMoneyActionItem(
  item: MoneyActionItem,
  router: { push: (href: string) => void },
): Promise<void> {
  if (item.domain === 'invoices') {
    router.push(`/dashboard/money/invoices/${item.ref_id}`)
    return
  }

  if (item.domain === 'quotes') {
    if (item.action_type === 'quote_pending') {
      router.push(
        `/dashboard/contractors/${item.entity_id}?tab=Quotes&focusType=quote_pending&focus=${encodeURIComponent(item.ref_id)}`,
      )
      return
    }
    if (item.action_type === 'quotation_pending') {
      router.push(`/dashboard/projects/${item.entity_id}?tab=quotation`)
      return
    }
    return
  }

  if (item.domain === 'approvals') {
    if (item.action_type === 'supplier_approval') {
      router.push(`/dashboard/finance/supplier-invoices/${item.entity_id}`)
      return
    }
    // Payouts are worked on the Approvals hub.
    router.push('/dashboard/finance/approvals')
    return
  }

  if (item.domain === 'suppliers') {
    router.push(`/dashboard/suppliers/${item.entity_id}`)
  }
}
