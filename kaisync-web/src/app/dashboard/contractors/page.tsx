'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  ResponsiveDataView,
  DataCard,
  DataCardTitle,
  DataCardMeta,
  DataCardRow,
} from '@/components/ui/ResponsiveDataView'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  escapeIlike,
  pageRange,
  totalPages,
} from '@/lib/list-pagination'
import type { Contractor, ContractorActionItem } from '@/types/database'
import { LinkedBadge, LinkedOnlyToggle } from '@/components/LinkedBadge'
import { activeLinkedRecordIds } from '@/lib/company-links'
import * as XLSX from 'xlsx'
import { localISODate } from '@/lib/utils'
import { StatusFilterTabs, TAB_ALL, MONEY_TH, MONEY_TD } from '@/components/ui/StatusFilterTabs'
import { TextHeaderFilter, ResetFiltersButton, statusTab } from '@/components/ui/MoneyListFilters'

type FilterValue = 'active' | 'inactive' | 'all'

/** Tab ids are the existing `filter` state values ('all' comes from TAB_ALL). */
const STATUS_TABS = [
  statusTab('active', 'Active', ['active'], 'green'),
  statusTab('inactive', 'Inactive', ['inactive'], 'slate'),
  TAB_ALL,
]

/** Server-side column filters (ilike, ANDed with search / status / linked-only). */
type Cols = { name: string; code: string; contact: string; phone: string; email: string }
const EMPTY_COLS: Cols = { name: '', code: '', contact: '', phone: '', email: '' }

function colsActive(c: Cols): boolean {
  return !!(c.name || c.code || c.contact || c.phone || c.email)
}

/** Maps column filter state to contractors table columns (all verified in the existing select/export). */
function colFilterPairs(c: Cols): Array<[string, string]> {
  const pairs: Array<[string, string]> = [
    ['name', c.name],
    ['contractor_code', c.code],
    ['contact_person', c.contact],
    ['phone', c.phone],
    ['email', c.email],
  ]
  return pairs.filter(([, v]) => v !== '')
}

const ACTION_TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  quote_pending:     { bg: '#DBEAFE', fg: '#1E40AF' },
  banking_pending:   { bg: '#FEF3C7', fg: '#92400E' },
  document_pending:  { bg: '#E5E7EB', fg: '#374151' },
  document_expiring: { bg: '#FEE2E2', fg: '#991B1B' },
  compliance:        { bg: '#FEE2E2', fg: '#991B1B' },
  payment:           { bg: '#FEF3C7', fg: '#92400E' },
  review:            { bg: '#DBEAFE', fg: '#1E40AF' },
}

function getDefaultColor() { return { bg: '#E5E7EB', fg: '#374151' } }

function getBankingBadge(c: Contractor) {
  return c.banking_verified
    ? { bg: '#DCFCE7', fg: '#166534', label: 'Verified' }
    : c.bank_name && c.bank_account
      ? { bg: '#FEF3C7', fg: '#92400E', label: 'Pending' }
      : { bg: '#1E293B', fg: '#94A3B8', label: 'None' }
}

function getStatusBadge(c: Contractor) {
  return c.is_active
    ? { bg: '#DCFCE7', fg: '#166534', label: 'Active' }
    : { bg: '#1E293B', fg: '#94A3B8', label: 'Inactive' }
}

export default function ContractorsPage() {
  const router = useRouter()
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [actionItems, setActionItems] = useState<ContractorActionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [filter, setFilter] = useState<FilterValue>('active')
  const [error, setError] = useState<string | null>(null)
  const [xeroLinked,    setXeroLinked]    = useState<Set<string>>(new Set())
  const [xeroConnected, setXeroConnected] = useState(false)
  const [xeroPushing,   setXeroPushing]   = useState<string | null>(null)
  const [companyId,     setCompanyId]     = useState<string | null>(null)
  const [sessionToken,  setSessionToken]  = useState<string | null>(null)
  const [xeroImporting, setXeroImporting] = useState(false)
  const [xeroMsg,       setXeroMsg]       = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [activeCount, setActiveCount] = useState<number | null>(null)
  const [searchDebounced, setSearchDebounced] = useState('')
  const [cols, setCols] = useState<Cols>(EMPTY_COLS)
  const [colsDebounced, setColsDebounced] = useState<Cols>(EMPTY_COLS)
  const [linkedOnly, setLinkedOnly] = useState(false)
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [total, setTotal] = useState(0)

  const canCreate = can(perms, PERM.contractorsCreate)
  const canEdit = can(perms, PERM.contractorsEdit)

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchText.trim()), 300)
    return () => clearTimeout(t)
  }, [searchText])

  useEffect(() => {
    const t = setTimeout(() => {
      const next: Cols = {
        name: cols.name.trim(),
        code: cols.code.trim(),
        contact: cols.contact.trim(),
        phone: cols.phone.trim(),
        email: cols.email.trim(),
      }
      // Keep the previous reference when nothing changed so load() is not re-triggered.
      setColsDebounced(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }, 300)
    return () => clearTimeout(t)
  }, [cols])

  useEffect(() => { setPage(1) }, [searchDebounced, colsDebounced, filter, pageSize, linkedOnly])

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }

    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

    const today = localISODate()
    const contractorScope = () =>
      supabase
        .from('contractors')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', member.companyId)
        .or('partner_kind.eq.contractor,partner_kind.eq.both,partner_kind.is.null')

    const { from, to } = pageRange(page, pageSize)
    let listQuery = supabase
      .from('contractors')
      .select('*', { count: 'exact' })
      .eq('company_id', member.companyId)
      .or('partner_kind.eq.contractor,partner_kind.eq.both,partner_kind.is.null')
      .order('name')

    if (filter === 'active') listQuery = listQuery.eq('is_active', true)
    if (filter === 'inactive') listQuery = listQuery.eq('is_active', false)
    // Joined to another KaiSync company through Linked companies (active links only).
    const linkedSet = await activeLinkedRecordIds(supabase, member.companyId, 'customer')
    setLinkedIds(linkedSet)
    if (linkedOnly) listQuery = listQuery.in('id', linkedSet.size ? [...linkedSet] : ['00000000-0000-0000-0000-000000000000'])
    if (searchDebounced) {
      const q = escapeIlike(searchDebounced)
      listQuery = listQuery.or(`name.ilike.%${q}%,contact_person.ilike.%${q}%,contractor_code.ilike.%${q}%`)
    }
    for (const [col, value] of colFilterPairs(colsDebounced)) {
      listQuery = listQuery.ilike(col, `%${escapeIlike(value)}%`)
    }

    const [cRes, aRes, snapRes, activeRes] = await Promise.all([
      listQuery.range(from, to),
      supabase.rpc('hr_get_contractor_action_items', { p_company_id: member.companyId }),
      supabase.rpc('hr_get_contractors_snapshot', {
        p_company_id: member.companyId,
        p_from: today,
        p_to: today,
      }),
      contractorScope().eq('is_active', true),
    ])

    if (cRes.error) {
      setError(cRes.error.message)
      setContractors([])
      setTotal(0)
      setLoading(false)
      return
    }

    setContractors((cRes.data ?? []) as Contractor[])
    setTotal(cRes.count ?? 0)

    const actionRaw = aRes.data
    const actionList = Array.isArray(actionRaw)
      ? actionRaw
      : typeof actionRaw === 'string'
        ? JSON.parse(actionRaw)
        : []
    setActionItems((actionList ?? []) as ContractorActionItem[])

    const snap = (snapRes.data ?? {}) as { active?: number }
    setActiveCount(activeRes.count ?? Number(snap.active ?? 0))

    const cId = member.companyId
    setCompanyId(cId)
    const { data: xStatus } = await (supabase.rpc as any)('get_xero_connection_status', { p_company_id: cId })
    setXeroConnected(xStatus?.connected ?? false)
    if (xStatus?.connected) {
      const { data: linkedIds } = await (supabase.rpc as any)('get_xero_linked_records', { p_company_id: cId, p_record_type: 'contractor' })
      setXeroLinked(new Set((linkedIds ?? []) as string[]))
    }
    const { data: { session } } = await supabase.auth.getSession()
    setSessionToken(session?.access_token ?? null)
    setLoading(false)
  }, [page, pageSize, filter, searchDebounced, colsDebounced, linkedOnly])

  useEffect(() => { void load() }, [load])

  const filtered = contractors

  async function exportCsv() {
    if (!companyId) return
    const supabase = createClient()
    let query = supabase
      .from('contractors')
      .select('name, contractor_code, partner_kind, contact_person, phone, email, is_active, payment_hold, compliance_hold')
      .eq('company_id', companyId)
      .or('partner_kind.eq.contractor,partner_kind.eq.both,partner_kind.is.null')
      .order('name')
      .limit(5000)
    if (filter === 'active') query = query.eq('is_active', true)
    if (filter === 'inactive') query = query.eq('is_active', false)
    if (searchDebounced) {
      const q = escapeIlike(searchDebounced)
      query = query.or(`name.ilike.%${q}%,contact_person.ilike.%${q}%,contractor_code.ilike.%${q}%`)
    }
    for (const [col, value] of colFilterPairs(colsDebounced)) {
      query = query.ilike(col, `%${escapeIlike(value)}%`)
    }
    const { data, error: qErr } = await query
    if (qErr) { setError(qErr.message); return }
    const rows = (data ?? []).map(c => ({
      Name: c.name,
      Code: c.contractor_code ?? '',
      Kind: c.partner_kind ?? 'contractor',
      Contact: c.contact_person ?? '',
      Phone: c.phone ?? '',
      Email: c.email ?? '',
      Active: c.is_active === false ? 'No' : 'Yes',
      'Payment hold': c.payment_hold ? 'Yes' : 'No',
      'Compliance hold': c.compliance_hold ? 'Yes' : 'No',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Contractors')
    XLSX.writeFile(wb, `contractors_export_${localISODate()}.xlsx`)
  }

  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

  async function pushToXero(e: React.MouseEvent, contractorId: string) {
    e.stopPropagation()
    if (!canEdit || !companyId || !sessionToken || xeroPushing) return
    setXeroPushing(contractorId)
    setXeroMsg(null)
    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, record_id: contractorId, record_type: 'contractor' }),
      })
      const data = await resp.json().catch(() => ({} as { ok?: boolean; error?: string }))
      if (data.ok) setXeroLinked(prev => new Set([...prev, contractorId]))
      else setXeroMsg(data.error ?? `Xero push failed (${resp.status})`)
    } catch {
      setXeroMsg('Xero push failed — network or server error')
    } finally {
      setXeroPushing(null)
    }
  }

  async function syncAllToXero() {
    if (!canEdit || !companyId || !sessionToken) return
    setXeroPushing('__all__')
    setXeroMsg(null)
    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      })
      const data = await resp.json().catch(() => ({} as { ok?: boolean; error?: string; synced?: number }))
      if (data.ok) {
        setXeroMsg(`Synced to Xero${data.synced != null ? `: ${data.synced} contact(s)` : ''}.`)
        await load()
      } else {
        setXeroMsg(data.error ?? `Xero sync failed (${resp.status})`)
      }
    } catch {
      setXeroMsg('Xero sync failed — network or server error')
    } finally {
      setXeroPushing(null)
    }
  }

  async function importFromXero() {
    if (!canEdit || !companyId || !sessionToken) return
    setXeroImporting(true)
    setXeroMsg(null)
    try {
      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id: companyId, direction: 'pull' }),
        }
      )
      const data = await resp.json()
      if (data.ok) {
        setXeroMsg(`Imported from Xero: ${data.created} new record${data.created !== 1 ? 's' : ''} created, ${data.matched} existing linked.`)
        await load()
      } else {
        setXeroMsg(data.error ?? 'Import failed')
      }
    } catch {
      setXeroMsg('Unexpected error during import')
    } finally {
      setXeroImporting(false)
    }
  }

  const centreItems = actionItems.filter(item => item.action_type !== 'quote_pending')

  if (error === 'not_linked') return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
        <p className="text-[13px] text-text-secondary">
          Your account is not linked to an active employee record.<br/>
          Please contact your administrator.
        </p>
      </div>
    </div>
  )

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-3 pt-3 pb-2 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-[16px] font-bold text-text-primary">Contractors</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => void load()} className="h-8 px-2.5 text-[12px] rounded-lg border border-border text-text-secondary hover:text-text-primary transition-colors">Refresh</button>
            {canEdit && xeroConnected && (
              <button
                type="button"
                onClick={syncAllToXero}
                disabled={!!xeroPushing}
                className="h-8 px-2.5 text-[12px] rounded-lg border border-[#13B5EA] text-[#13B5EA] hover:bg-[#13B5EA]/10 disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                {xeroPushing === '__all__' ? 'Syncing…' : 'Sync All to Xero'}
              </button>
            )}
            {canEdit && xeroConnected && (
              <button
                type="button"
                onClick={importFromXero}
                disabled={xeroImporting}
                className="h-8 px-2.5 text-[12px] rounded-lg border border-[#13B5EA] text-[#13B5EA] font-medium hover:bg-[#13B5EA]/10 disabled:opacity-50 transition-colors"
              >
                {xeroImporting ? 'Importing…' : '↓ Import from Xero'}
              </button>
            )}
            <button type="button" onClick={() => void exportCsv()} className="h-8 px-2.5 text-[12px] rounded-lg border border-border text-text-primary font-medium hover:bg-surface-elevated transition-colors">
              Export
            </button>
            {canCreate && (
              <button type="button" onClick={() => router.push('/dashboard/contractors/import')} className="h-8 px-2.5 text-[12px] rounded-lg border border-border text-text-primary font-medium hover:bg-surface-elevated transition-colors">
                Import
              </button>
            )}
            {canCreate && (
              <button type="button" onClick={() => router.push('/dashboard/contractors/new')} className="btn-primary h-8 px-2.5 text-[12px] whitespace-nowrap">
                + Add Contractor
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <LinkedOnlyToggle value={linkedOnly} onChange={setLinkedOnly} />
          <div className="flex items-center gap-1.5 h-8 px-2 bg-surface border border-border rounded-sm flex-1 min-w-[180px]">
            <span className="material-icons text-text-disabled text-[16px]">search</span>
            <input
              type="search"
              placeholder="Search name, contact, or code"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="flex-1 min-w-0 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
            />
          </div>
          <ResetFiltersButton
            disabled={!colsActive(cols) && !searchText}
            onReset={() => { setCols(EMPTY_COLS); setSearchText('') }}
          />
          <StatusFilterTabs
            tabs={STATUS_TABS}
            value={filter}
            counts={activeCount != null ? { active: activeCount } : {}}
            onChange={id => setFilter(id as FilterValue)}
          />
        </div>
      </div>

      {xeroMsg && (
        <p className={`mx-4 mb-2 text-[12px] px-3 py-2 rounded ${
          xeroMsg.includes('Imported') || xeroMsg.includes('Synced')
            ? 'bg-green-900/30 text-green-300'
            : 'bg-red-900/30 text-red-300'
        }`}>
          {xeroMsg}
          <button onClick={() => setXeroMsg(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </p>
      )}

      {/* Action Centre */}
      <div className="mx-3 mb-2 bg-surface rounded-lg border border-divider overflow-hidden shrink-0">
        <div className={`flex items-center gap-2 px-3 py-1.5 ${centreItems.length > 0 ? 'border-b border-divider' : ''}`}>
          <span className="material-icons text-primary text-[16px]">bolt</span>
          <span className="font-semibold text-[11px] text-primary uppercase tracking-wider">Action Centre</span>
          <span className="text-text-secondary text-[11px] ml-1">
            {centreItems.length > 0 ? `${centreItems.length} pending` : 'Up to date'}
          </span>
          {centreItems.length > 0 && (() => {
            const banking  = centreItems.filter(i => i.action_type === 'banking_pending').length
            const expiring = centreItems.filter(i => i.action_type === 'document_expiring').length
            return (
              <div className="flex items-center gap-1 ml-1">
                {banking  > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF3C7] text-[#92400E]">{banking}B</span>}
                {expiring > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEE2E2] text-[#991B1B]">{expiring}D</span>}
              </div>
            )
          })()}
          <button onClick={load} className="ml-auto text-text-secondary text-[11px] h-6 px-2 hover:text-text-primary transition-colors">
            ↻ Refresh
          </button>
        </div>
        {centreItems.length > 0 && (
          <div className="max-h-[88px] overflow-y-auto">
            {centreItems.map(item => {
              const colors = ACTION_TYPE_COLORS[item.action_type] ?? getDefaultColor()
              return (
                <div key={`${item.action_type}-${item.ref_id}`}
                  className="flex flex-col sm:grid sm:items-center gap-1 px-3 py-1.5 border-t border-divider first:border-t-0"
                  style={{ gridTemplateColumns: '110px 1fr 90px 70px' }}>
                  <span className="rounded-[5px] px-[6px] py-[3px] text-[10px] font-medium w-fit"
                    style={{ backgroundColor: colors.bg, color: colors.fg }}>
                    {item.action_type.replace(/_/g, ' ')}
                  </span>
                  <div className="overflow-hidden min-w-0">
                    <p className="text-text-primary text-[12px] font-medium truncate">{item.contractor_name ?? '—'}</p>
                    <p className="text-text-secondary text-[11px] truncate">{item.summary}</p>
                  </div>
                  <div className="flex items-center justify-between sm:contents gap-2">
                    <p className="text-text-secondary text-[11px] sm:text-right">{fmtDate(item.created_at)}</p>
                    <button
                      type="button"
                      onClick={() => {
                        const tab =
                          item.action_type === 'banking_pending' ? 'Payments'
                            : item.action_type.startsWith('document_') ? 'Compliance'
                              : item.action_type === 'quote_pending' ? 'Quotes'
                                : 'Information'
                        const params = new URLSearchParams({
                          tab,
                          focus: item.ref_id,
                          focusType: item.action_type,
                        })
                        router.push(`/dashboard/contractors/${item.contractor_id}?${params.toString()}`)
                      }}
                      className="text-primary text-[12px] h-7 sm:h-6 px-2 sm:text-right hover:opacity-70 transition-opacity"
                    >
                      Open →
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Contractors table */}
      <div className="flex-1 min-h-0 overflow-auto mx-3 mb-1 bg-surface border border-divider rounded-lg">
        <ResponsiveDataView
          table={
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th style={{ width: 185 }} className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Company" value={cols.name} onChange={v => setCols(c => ({ ...c, name: v }))} placeholder="Company name…" />
                </th>
                <th style={{ width: 90 }} className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Code" value={cols.code} onChange={v => setCols(c => ({ ...c, code: v }))} placeholder="Code…" />
                </th>
                <th style={{ width: 130 }} className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Contact" value={cols.contact} onChange={v => setCols(c => ({ ...c, contact: v }))} placeholder="Contact person…" />
                </th>
                <th style={{ width: 120 }} className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Phone" value={cols.phone} onChange={v => setCols(c => ({ ...c, phone: v }))} placeholder="Phone…" />
                </th>
                <th style={{ width: 160 }} className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Email" value={cols.email} onChange={v => setCols(c => ({ ...c, email: v }))} placeholder="Email…" />
                </th>
                <th style={{ width: 70 }}  className={`${MONEY_TH} text-center`}>Rating</th>
                <th style={{ width: 85 }}  className={`${MONEY_TH} text-center`}>Banking</th>
                <th style={{ width: 80 }}  className={`${MONEY_TH} text-center`}>Payment</th>
                <th style={{ width: 100 }} className={`${MONEY_TH} text-center`}>Compliance</th>
                <th style={{ width: 80 }}  className={`${MONEY_TH} text-right`}>Status</th>
                {xeroConnected && (
                  <th style={{ width: 80 }} className={`${MONEY_TH} text-center`}>Xero</th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={xeroConnected ? 11 : 10} className="py-12 text-center text-[13px] text-text-disabled">Loading…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={xeroConnected ? 11 : 10} className="py-12 text-center text-[13px] text-text-secondary">
                    {total === 0 && !searchDebounced && !colsActive(colsDebounced) && !linkedOnly && filter === 'all'
                      ? 'No contractors yet. Click + Add to register one.'
                      : 'No contractors match your filters.'}
                  </td>
                </tr>
              ) : (
                filtered.map(c => {
                  const banking = getBankingBadge(c)
                  const status = getStatusBadge(c)
                  const payment = c.payment_hold
                    ? { bg: '#FEE2E2', fg: '#991B1B', label: 'Hold' }
                    : { bg: '#DCFCE7', fg: '#166534', label: 'Clear' }
                  const compliance = c.compliance_hold
                    ? { bg: '#FEE2E2', fg: '#991B1B', label: 'Hold' }
                    : c.compliance_pack_id
                      ? { bg: '#DCFCE7', fg: '#166534', label: 'Pack' }
                      : { bg: '#1E293B', fg: '#94A3B8', label: 'No Pack' }

                  return (
                    <tr
                      key={c.id}
                      onClick={() => router.push(`/dashboard/contractors/${c.id}`)}
                      className="bg-surface hover:bg-background cursor-pointer border-b border-divider last:border-0 transition-colors"
                    >
                      <td className={`${MONEY_TD} text-text-primary font-medium`}>
                        <span className="flex items-center gap-1 min-w-0" style={{ maxWidth: 205 }}><span className="truncate">{c.name}</span><LinkedBadge linked={linkedIds.has(c.id)} /></span>
                      </td>
                      <td className={`${MONEY_TD} text-text-secondary font-mono`}>{c.contractor_code ?? '—'}</td>
                      <td className={`${MONEY_TD} text-text-secondary`}>
                        <span className="block truncate" style={{ maxWidth: 130 }}>{c.contact_person ?? '—'}</span>
                      </td>
                      <td className={`${MONEY_TD} text-text-secondary`}>{c.phone ?? '—'}</td>
                      <td className={`${MONEY_TD} text-text-secondary`}>
                        <span className="block truncate" style={{ maxWidth: 160 }}>{c.email ?? '—'}</span>
                      </td>
                      <td className={`${MONEY_TD} text-center text-text-secondary`}>
                        ★ {(c.rating ?? 0).toFixed(1)}
                      </td>
                      <td className={`${MONEY_TD} text-center`}><StatusBadge {...banking} /></td>
                      <td className={`${MONEY_TD} text-center`}><StatusBadge {...payment} /></td>
                      <td className={`${MONEY_TD} text-center`}><StatusBadge {...compliance} /></td>
                      <td className={`${MONEY_TD} text-right`}><StatusBadge {...status} /></td>
                      {xeroConnected && (
                        <td className={`${MONEY_TD} text-center`} onClick={e => e.stopPropagation()}>
                          {xeroLinked.has(c.id) ? (
                            <span className="text-green-400 text-[18px]" title="Synced to Xero">✓</span>
                          ) : canEdit ? (
                            <button
                              onClick={e => pushToXero(e, c.id)}
                              disabled={xeroPushing === c.id}
                              className="text-[11px] px-2 py-1 rounded border border-[#13B5EA] text-[#13B5EA] hover:bg-[#13B5EA]/10 disabled:opacity-40 transition-colors whitespace-nowrap"
                            >
                              {xeroPushing === c.id ? '…' : '+ Xero'}
                            </button>
                          ) : (
                            <span className="text-text-disabled text-[11px]">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
          }
          mobile={
            loading ? (
              <p className="py-12 text-center text-[13px] text-text-disabled">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-text-secondary px-4">No contractors yet.</p>
            ) : (
              <>
                {filtered.map(c => {
                  const status = getStatusBadge(c)
                  return (
                    <DataCard key={c.id} onClick={() => router.push(`/dashboard/contractors/${c.id}`)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <DataCardTitle>{c.name} <LinkedBadge linked={linkedIds.has(c.id)} /></DataCardTitle>
                          <DataCardMeta className="font-mono">{c.contractor_code ?? '—'}</DataCardMeta>
                        </div>
                        <StatusBadge {...status} />
                      </div>
                      <DataCardRow label="Contact" value={c.contact_person ?? '—'} />
                      <DataCardRow label="Phone" value={c.phone ?? '—'} />
                      <DataCardRow label="Email" value={c.email ?? '—'} />
                    </DataCard>
                  )
                })}
              </>
            )
          }
        />
      </div>

      <div className="shrink-0 px-3 py-2 flex items-center gap-2">
        <p className="text-[12px] text-text-secondary">
          {total === 0 ? '0 contractors' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
        </p>
        <select
          value={pageSize}
          onChange={e => setPageSize(Number(e.target.value))}
          aria-label="Rows per page"
          className="h-7 px-1.5 rounded border border-border bg-surface text-[12px] text-text-secondary"
        >
          {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <button type="button" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="btn-outlined h-7 px-2.5 text-[12px] disabled:opacity-40">Previous</button>
        <button type="button" disabled={page >= totalPages(total, pageSize)} onClick={() => setPage(p => p + 1)} className="btn-outlined h-7 px-2.5 text-[12px] disabled:opacity-40">Next</button>
      </div>
    </div>
  )
}
