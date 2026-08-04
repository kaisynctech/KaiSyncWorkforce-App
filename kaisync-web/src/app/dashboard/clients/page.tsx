'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { CLIENT_TYPE_LABELS } from '@/lib/client-create-payload'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  escapeIlike,
  pageRange,
  totalPages,
} from '@/lib/list-pagination'
import { KpiTile } from '@/components/ui/KpiTile'
import type { Client, ClientActionItem } from '@/types/database'

type ClientKpis = {
  total: number
  portalEnabled: number
  openJobs: number
}

const ACTION_TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  invoice_overdue:     { bg: '#FEE2E2', fg: '#991B1B' },
  invoice_outstanding: { bg: '#FEF3C7', fg: '#92400E' },
  deal_attention:      { bg: '#DBEAFE', fg: '#1E40AF' },
  portal_message:      { bg: '#E0E7FF', fg: '#3730A3' },
}

function getDefaultColor() { return { bg: '#E5E7EB', fg: '#374151' } }

export default function ClientsPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [actionItems, setActionItems] = useState<ClientActionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [total, setTotal] = useState(0)
  const [kpis, setKpis] = useState<ClientKpis>({ total: 0, portalEnabled: 0, openJobs: 0 })
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [xeroLinked,    setXeroLinked]    = useState<Set<string>>(new Set())
  const [xeroConnected, setXeroConnected] = useState(false)
  const [xeroPushing,   setXeroPushing]   = useState<string | null>(null)
  const [companyId,     setCompanyId]     = useState<string | null>(null)
  const [sessionToken,  setSessionToken]  = useState<string | null>(null)
  const [xeroImporting, setXeroImporting] = useState(false)
  const [xeroMsg,       setXeroMsg]       = useState<string | null>(null)

  const canEdit = can(perms, PERM.clientsEdit)

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(1) }, [searchDebounced, pageSize])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    const cId = member.companyId
    setCompanyId(cId)

    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

    const today = new Date().toISOString().slice(0, 10)
    const { from, to } = pageRange(page, pageSize)

    let query = supabase
      .from('clients')
      .select('*', { count: 'exact' })
      .eq('company_id', cId)
      .order('name')

    if (searchDebounced) {
      const q = escapeIlike(searchDebounced)
      query = query.or(
        `name.ilike.%${q}%,email.ilike.%${q}%,client_code.ilike.%${q}%,phone.ilike.%${q}%,contact_person.ilike.%${q}%`,
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [listRes, aRes, snapRes] = await Promise.all([
      query.range(from, to),
      (supabase.rpc as any)('hr_get_client_action_items', { p_company_id: cId }),
      (supabase.rpc as any)('hr_get_clients_snapshot', {
        p_company_id: cId,
        p_from: today,
        p_to: today,
      }),
    ])

    if (listRes.error) {
      setError(listRes.error.message)
      setClients([])
      setTotal(0)
    } else {
      setClients((listRes.data ?? []) as Client[])
      setTotal(listRes.count ?? 0)
    }

    const actionRaw = aRes.data
    const actionList = Array.isArray(actionRaw)
      ? actionRaw
      : typeof actionRaw === 'string'
        ? JSON.parse(actionRaw)
        : []
    setActionItems((actionList ?? []) as ClientActionItem[])

    const snap = (snapRes.data ?? {}) as {
      total?: number
      portal_enabled?: number
      open_jobs?: number
    }
    setKpis({
      total: Number(snap.total ?? listRes.count ?? 0),
      portalEnabled: Number(snap.portal_enabled ?? 0),
      openJobs: Number(snap.open_jobs ?? 0),
    })

    const { data: xStatus } = await (supabase.rpc as any)('get_xero_connection_status', { p_company_id: cId })
    setXeroConnected(xStatus?.connected ?? false)
    if (xStatus?.connected) {
      const { data: linkedIds } = await (supabase.rpc as any)('get_xero_linked_records', { p_company_id: cId, p_record_type: 'client' })
      setXeroLinked(new Set((linkedIds ?? []) as string[]))
    }
    const { data: { session } } = await supabase.auth.getSession()
    setSessionToken(session?.access_token ?? null)
    setLoading(false)
  }, [page, pageSize, searchDebounced])

  useEffect(() => { void load() }, [load])

  const pages = totalPages(total, pageSize)

  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

  function openActionItem(item: ClientActionItem) {
    if (item.action_type.startsWith('invoice_')) {
      router.push(`/dashboard/finance/invoices/${item.ref_id}`)
      return
    }
    if (item.action_type === 'deal_attention') {
      router.push(`/dashboard/projects/${item.ref_id}`)
      return
    }
    if (item.action_type === 'portal_message') {
      router.push(`/dashboard/clients/${item.client_id}?tab=info`)
      return
    }
    router.push(`/dashboard/clients/${item.client_id}`)
  }

  async function pushToXero(e: React.MouseEvent, clientId: string) {
    e.stopPropagation()
    if (!canEdit || !companyId || !sessionToken || xeroPushing) return
    setXeroPushing(clientId)
    setXeroMsg(null)
    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, record_id: clientId, record_type: 'client' }),
      })
      const data = await resp.json().catch(() => ({} as { ok?: boolean; error?: string }))
      if (data.ok) setXeroLinked(prev => new Set([...prev, clientId]))
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
      const data = await resp.json().catch(() => ({} as { ok?: boolean; error?: string; created?: number; matched?: number }))
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
      <div className="px-4 pt-4 pb-0">
        <input type="search" placeholder="Search by name, code, email, phone…"
          className="w-full bg-surface border border-border text-text-primary placeholder:text-text-disabled rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {!loading && (
        <div className="grid grid-cols-3 gap-2 mx-4 mt-3">
          <KpiTile value={kpis.total} label="Total clients" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
          <KpiTile value={kpis.portalEnabled} label="Portal enabled" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
          <KpiTile value={kpis.openJobs} label="Open jobs" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
        </div>
      )}

      <div className="flex items-center gap-2 mx-4 my-2 flex-wrap">
        <p className="text-text-secondary text-[12px] flex-1">
          {total === 0 ? '0 clients' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
        </p>
        <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="dark-entry h-8 text-[12px] py-0 w-auto">
          {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}/page</option>)}
        </select>
        <button onClick={() => void load()} className="text-primary text-[13px] px-2 hover:opacity-70 transition-opacity">Refresh</button>
        {canEdit && xeroConnected && (
          <button
            onClick={syncAllToXero}
            disabled={!!xeroPushing}
            className="h-[42px] px-3 text-[13px] rounded-lg border border-[#13B5EA] text-[#13B5EA] hover:bg-[#13B5EA]/10 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            {xeroPushing === '__all__' ? 'Syncing…' : 'Sync All to Xero'}
          </button>
        )}
        {canEdit && xeroConnected && (
          <button
            onClick={importFromXero}
            disabled={xeroImporting}
            className="h-[42px] px-3 text-[13px] rounded-lg border border-[#13B5EA] text-[#13B5EA] font-medium hover:bg-[#13B5EA]/10 disabled:opacity-50 transition-colors"
          >
            {xeroImporting ? 'Importing…' : '↓ Import from Xero'}
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => router.push('/dashboard/clients/import')}
            className="h-[42px] px-3 text-[13px] rounded-lg border border-border text-text-primary font-medium hover:bg-surface-elevated transition-colors"
          >
            Import
          </button>
        )}
        {canEdit && (
          <button onClick={() => router.push('/dashboard/clients/new')}
            className="btn-primary h-[42px] px-3 text-[13px] whitespace-nowrap">
            + Add Client
          </button>
        )}
      </div>

      {error && error !== 'not_linked' && <p className="mx-4 text-[12px] text-error">{error}</p>}
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
            const overdue = actionItems.filter(i => i.action_type === 'invoice_overdue').length
            const outstanding = actionItems.filter(i => i.action_type === 'invoice_outstanding').length
            const deals = actionItems.filter(i => i.action_type === 'deal_attention').length
            const msgs = actionItems.filter(i => i.action_type === 'portal_message').length
            return (
              <div className="flex items-center gap-1 ml-1">
                {overdue > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEE2E2] text-[#991B1B]">{overdue}O</span>}
                {outstanding > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF3C7] text-[#92400E]">{outstanding}A</span>}
                {deals > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#DBEAFE] text-[#1E40AF]">{deals}P</span>}
                {msgs > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#E0E7FF] text-[#3730A3]">{msgs}M</span>}
              </div>
            )
          })()}
          <button onClick={() => void load()} className="ml-auto text-text-secondary text-[11px] h-8 px-2 hover:text-text-primary transition-colors">
            ↻ Refresh
          </button>
        </div>
        <div className="max-h-[140px] overflow-y-auto">
          {actionItems.length === 0 ? (
            <p className="text-text-secondary text-[12px] px-3 py-2">✓  No pending client actions</p>
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
                    <p className="text-text-primary text-[12px] font-medium truncate">{item.client_name ?? '—'}</p>
                    <p className="text-text-secondary text-[11px] truncate">{item.summary}</p>
                  </div>
                  <p className="text-text-secondary text-[11px] text-right">{fmtDate(item.created_at)}</p>
                  <button
                    type="button"
                    onClick={() => openActionItem(item)}
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

      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto mx-4 mb-4 bg-surface rounded-lg border border-divider">
          <table style={{ minWidth: 760 }} className="w-full">
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th style={{ width: 180 }} className="data-th">Client</th>
                <th style={{ width:  90 }} className="data-th">Code</th>
                <th style={{ width: 100 }} className="data-th">Type</th>
                <th style={{ width: 130 }} className="data-th">Contact</th>
                <th style={{ width: 150 }} className="data-th">Email</th>
                <th style={{ width: 110 }} className="data-th">Phone</th>
                {xeroConnected && (
                  <th style={{ width: 80 }} className="data-th text-center">Xero</th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={xeroConnected ? 7 : 6} className="py-12 text-center text-[13px] text-text-disabled">Loading…</td></tr>
              ) : clients.length === 0 ? (
                <tr><td colSpan={xeroConnected ? 7 : 6} className="py-8 text-center text-[13px] text-text-secondary">
                  {total === 0 && !searchDebounced ? 'No clients yet. Click + Add Client to create one.' : 'No clients match your search.'}
                </td></tr>
              ) : (
                clients.map(c => (
                  <tr key={c.id}
                    onClick={() => router.push(`/dashboard/clients/${c.id}`)}
                    className="bg-surface hover:bg-background cursor-pointer border-b border-divider last:border-0 transition-colors">
                    <td className="data-td text-text-primary font-medium">
                      <span className="block truncate" style={{ maxWidth: 180 }}>{c.name}</span>
                    </td>
                    <td className="data-td text-text-primary font-medium text-[12px]">{c.client_code ?? '—'}</td>
                    <td className="data-td text-text-secondary text-[12px]">
                      {CLIENT_TYPE_LABELS[c.type ?? ''] ?? c.type ?? '—'}
                    </td>
                    <td className="data-td text-text-secondary text-[12px]">
                      <span className="block truncate" style={{ maxWidth: 130 }}>{c.contact_person ?? '—'}</span>
                    </td>
                    <td className="data-td text-text-secondary text-[12px]">
                      <span className="block truncate" style={{ maxWidth: 150 }}>{c.email ?? '—'}</span>
                    </td>
                    <td className="data-td text-text-secondary text-[12px]">{c.phone ?? '—'}</td>
                    {xeroConnected && (
                      <td className="data-td text-center" onClick={e => e.stopPropagation()}>
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-t border-divider shrink-0">
        <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40">Previous</button>
        <span className="text-[12px] text-text-secondary">Page {page} of {pages}</span>
        <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40">Next</button>
      </div>
    </div>
  )
}
