'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { FilterChip } from '@/components/ui/FilterChip'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { isContractorKind } from '@/lib/partner-kinds'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import type { Contractor, ContractorActionItem } from '@/types/database'

type FilterValue = 'active' | 'inactive' | 'all'

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

  const canCreate = can(perms, PERM.contractorsCreate)
  const canEdit = can(perms, PERM.contractorsEdit)

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

    const [cRes, aRes] = await Promise.all([
      supabase.from('contractors').select('*').eq('company_id', member.companyId).order('name'),
      supabase.rpc('hr_get_contractor_action_items', { p_company_id: member.companyId }),
    ])

    if (cRes.error) {
      setError(cRes.error.message)
      setLoading(false)
      return
    }

    const rows = ((cRes.data ?? []) as Contractor[])
      .filter(c => isContractorKind(c.partner_kind) || !c.partner_kind)
    setContractors(rows)

    const actionRaw = aRes.data
    const actionList = Array.isArray(actionRaw)
      ? actionRaw
      : typeof actionRaw === 'string'
        ? JSON.parse(actionRaw)
        : []
    setActionItems((actionList ?? []) as ContractorActionItem[])

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
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = contractors.filter(c => {
    if (filter === 'active' && !c.is_active) return false
    if (filter === 'inactive' && c.is_active) return false
    if (searchText) {
      const q = searchText.toLowerCase()
      return (
        c.name.toLowerCase().includes(q) ||
        (c.contact_person ?? '').toLowerCase().includes(q) ||
        (c.contractor_code ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

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
    <div className="h-full flex flex-col">
      {/* Search bar */}
      <div className="px-4 pt-4 pb-0">
        <input
          type="search"
          placeholder="Search contractors…"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          className="w-full bg-surface border border-border text-text-primary placeholder:text-text-disabled rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        />
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center gap-[6px] mx-4 my-2 flex-wrap">
        <FilterChip label="Active"   active={filter === 'active'}   onClick={() => setFilter('active')} />
        <FilterChip label="Inactive" active={filter === 'inactive'} onClick={() => setFilter('inactive')} />
        <FilterChip label="All"      active={filter === 'all'}      onClick={() => setFilter('all')} />
        <span className="ml-2 text-[12px] text-text-secondary flex-1">{filtered.length} contractors</span>
        <button onClick={load} className="text-[13px] text-primary px-2 hover:opacity-70 transition-opacity">Refresh</button>
        {canEdit && xeroConnected && (
          <button
            onClick={syncAllToXero}
            disabled={!!xeroPushing}
            className="h-8 px-3 text-[13px] rounded-lg border border-[#13B5EA] text-[#13B5EA] hover:bg-[#13B5EA]/10 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            {xeroPushing === '__all__' ? 'Syncing…' : 'Sync All to Xero'}
          </button>
        )}
        {canEdit && xeroConnected && (
          <button
            onClick={importFromXero}
            disabled={xeroImporting}
            className="h-8 px-3 text-[13px] rounded-lg border border-[#13B5EA] text-[#13B5EA] font-medium hover:bg-[#13B5EA]/10 disabled:opacity-50 transition-colors"
          >
            {xeroImporting ? 'Importing…' : '↓ Import from Xero'}
          </button>
        )}
        {canCreate && (
          <button
            onClick={() => router.push('/dashboard/contractors/new')}
            className="h-8 px-3 text-[13px] rounded-lg bg-primary text-white font-semibold hover:bg-primary-dark transition-colors"
          >+ Add</button>
        )}
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
      <div className="mx-4 mb-3 bg-surface rounded-xl border border-divider overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-[10px] border-b border-divider">
          <span className="material-icons text-primary text-[18px]">bolt</span>
          <span className="font-semibold text-[12px] text-primary uppercase tracking-wider">Action Centre</span>
          <span className="text-text-secondary text-[11px] ml-1">
            {actionItems.length > 0 ? `${actionItems.length} pending` : 'Up to date'}
          </span>
          {actionItems.length > 0 && (() => {
            const quotes   = actionItems.filter(i => i.action_type === 'quote_pending').length
            const banking  = actionItems.filter(i => i.action_type === 'banking_pending').length
            const expiring = actionItems.filter(i => i.action_type === 'document_expiring').length
            return (
              <div className="flex items-center gap-1 ml-1">
                {quotes   > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#DBEAFE] text-[#1E40AF]">{quotes}Q</span>}
                {banking  > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF3C7] text-[#92400E]">{banking}B</span>}
                {expiring > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEE2E2] text-[#991B1B]">{expiring}D</span>}
              </div>
            )
          })()}
          <button onClick={load} className="ml-auto text-text-secondary text-[11px] h-8 px-2 hover:text-text-primary transition-colors">
            ↻ Refresh
          </button>
        </div>
        <div className="max-h-[140px] overflow-y-auto">
          {actionItems.length === 0 ? (
            <p className="text-text-secondary text-[12px] px-3 py-2">✓  No pending contractor actions</p>
          ) : (
            actionItems.map(item => {
              const colors = ACTION_TYPE_COLORS[item.action_type] ?? getDefaultColor()
              return (
                <div key={`${item.action_type}-${item.ref_id}`}
                  className="grid items-center gap-x-2 px-3 py-2 border-t border-divider"
                  style={{ gridTemplateColumns: '110px 1fr 90px 70px' }}>
                  <span className="rounded-[5px] px-[6px] py-[3px] text-[10px] font-medium w-fit"
                    style={{ backgroundColor: colors.bg, color: colors.fg }}>
                    {item.action_type.replace(/_/g, ' ')}
                  </span>
                  <div className="overflow-hidden">
                    <p className="text-text-primary text-[12px] font-medium truncate">{item.contractor_name ?? '—'}</p>
                    <p className="text-text-secondary text-[11px] truncate">{item.summary}</p>
                  </div>
                  <p className="text-text-secondary text-[11px] text-right">{fmtDate(item.created_at)}</p>
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
                    className="text-primary text-[11px] h-[30px] text-right hover:opacity-70 transition-opacity"
                  >
                    Open →
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Contractors table */}
      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto mx-4 mb-4 bg-surface rounded-lg border border-divider">
          <table style={{ minWidth: 1100 }} className="w-full text-[13px]">
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th style={{ width: 185 }} className="text-left px-3 py-3 text-[12px] font-medium text-text-secondary">Company</th>
                <th style={{ width: 90 }}  className="text-left px-3 py-3 text-[12px] font-medium text-text-secondary">Code</th>
                <th style={{ width: 130 }} className="text-left px-3 py-3 text-[12px] font-medium text-text-secondary">Contact</th>
                <th style={{ width: 120 }} className="text-left px-3 py-3 text-[12px] font-medium text-text-secondary">Phone</th>
                <th style={{ width: 160 }} className="text-left px-3 py-3 text-[12px] font-medium text-text-secondary">Email</th>
                <th style={{ width: 70 }}  className="text-center px-3 py-3 text-[12px] font-medium text-text-secondary">Rating</th>
                <th style={{ width: 85 }}  className="text-center px-3 py-3 text-[12px] font-medium text-text-secondary">Banking</th>
                <th style={{ width: 80 }}  className="text-center px-3 py-3 text-[12px] font-medium text-text-secondary">Payment</th>
                <th style={{ width: 100 }} className="text-center px-3 py-3 text-[12px] font-medium text-text-secondary">Compliance</th>
                <th style={{ width: 80 }}  className="text-right px-3 py-3 text-[12px] font-medium text-text-secondary">Status</th>
                {xeroConnected && (
                  <th style={{ width: 80 }} className="text-center px-3 py-3 text-[12px] font-medium text-text-secondary">Xero</th>
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
                    No contractors yet. Click + Add to register one.
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
                      <td className="px-3 py-3 text-text-primary font-medium">
                        <span className="block truncate" style={{ maxWidth: 185 }}>{c.name}</span>
                      </td>
                      <td className="px-3 py-3 text-text-secondary font-mono">{c.contractor_code ?? '—'}</td>
                      <td className="px-3 py-3 text-text-secondary">
                        <span className="block truncate" style={{ maxWidth: 130 }}>{c.contact_person ?? '—'}</span>
                      </td>
                      <td className="px-3 py-3 text-text-secondary">{c.phone ?? '—'}</td>
                      <td className="px-3 py-3 text-text-secondary">
                        <span className="block truncate" style={{ maxWidth: 160 }}>{c.email ?? '—'}</span>
                      </td>
                      <td className="px-3 py-3 text-center text-text-secondary text-[13px]">
                        ★ {(c.rating ?? 0).toFixed(1)}
                      </td>
                      <td className="px-3 py-3 text-center"><StatusBadge {...banking} /></td>
                      <td className="px-3 py-3 text-center"><StatusBadge {...payment} /></td>
                      <td className="px-3 py-3 text-center"><StatusBadge {...compliance} /></td>
                      <td className="px-3 py-3 text-right"><StatusBadge {...status} /></td>
                      {xeroConnected && (
                        <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
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
        </div>
      </div>
    </div>
  )
}
