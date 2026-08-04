'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { CLIENT_TYPE_LABELS } from '@/lib/client-create-payload'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { KpiTile } from '@/components/ui/KpiTile'
import type { Client } from '@/types/database'

export default function ClientsPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [xeroLinked,    setXeroLinked]    = useState<Set<string>>(new Set())
  const [xeroConnected, setXeroConnected] = useState(false)
  const [xeroPushing,   setXeroPushing]   = useState<string | null>(null)
  const [companyId,     setCompanyId]     = useState<string | null>(null)
  const [sessionToken,  setSessionToken]  = useState<string | null>(null)
  const [xeroImporting, setXeroImporting] = useState(false)
  const [xeroMsg,       setXeroMsg]       = useState<string | null>(null)

  const canEdit = can(perms, PERM.clientsEdit)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    const cId = member.companyId
    setCompanyId(cId)

    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('company_id', cId)
      .order('name')
    setClients((data ?? []) as Client[])
    const { data: xStatus } = await (supabase.rpc as any)('get_xero_connection_status', { p_company_id: cId })
    setXeroConnected(xStatus?.connected ?? false)
    if (xStatus?.connected) {
      const { data: linkedIds } = await (supabase.rpc as any)('get_xero_linked_records', { p_company_id: cId, p_record_type: 'client' })
      setXeroLinked(new Set((linkedIds ?? []) as string[]))
    }
    const { data: { session } } = await supabase.auth.getSession()
    setSessionToken(session?.access_token ?? null)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const kpis = useMemo(() => ({
    total: clients.length,
    portalEnabled: clients.filter(c => c.portal_enabled).length,
    withCode: clients.filter(c => !!c.client_code).length,
  }), [clients])

  const filtered = clients.filter(c => {
    if (!searchText) return true
    const q = searchText.toLowerCase()
    return (
      (c.name ?? '').toLowerCase().includes(q) ||
      (c.client_code ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.phone ?? '').toLowerCase().includes(q) ||
      (c.contact_person ?? '').toLowerCase().includes(q)
    )
  })

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

  return (
    <div className="h-full flex flex-col">
      {/* Search */}
      <div className="px-4 pt-4 pb-0">
        <input type="search" placeholder="Search by name, code, email, phone…"
          className="w-full bg-surface border border-border text-text-primary placeholder:text-text-disabled rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
          value={searchText} onChange={e => setSearchText(e.target.value)} />
      </div>

      {!loading && (
        <div className="grid grid-cols-3 gap-2 mx-4 mt-3">
          <KpiTile value={kpis.total} label="Total clients" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
          <KpiTile value={kpis.portalEnabled} label="Portal enabled" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
          <KpiTile value={kpis.withCode} label="With code" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 mx-4 my-2 flex-wrap">
        <p className="text-text-secondary text-[12px] flex-1">{filtered.length} client{filtered.length !== 1 ? 's' : ''}</p>
        <button onClick={load} className="text-primary text-[13px] px-2 hover:opacity-70 transition-opacity">Refresh</button>
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

      {/* Table */}
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
              ) : filtered.length === 0 ? (
                <tr><td colSpan={xeroConnected ? 7 : 6} className="py-8 text-center text-[13px] text-text-secondary">
                  {clients.length === 0 ? 'No clients yet. Click + Add Client to create one.' : 'No clients match your search.'}
                </td></tr>
              ) : (
                filtered.map(c => (
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
    </div>
  )
}
