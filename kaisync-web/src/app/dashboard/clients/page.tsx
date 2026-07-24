'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { Client } from '@/types/database'

const CLIENT_TYPE_LABELS: Record<string, string> = {
  individual: 'Individual',
  company:    'Company',
  government: 'Government',
  ngo:        'NGO',
}

export default function ClientsPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [xeroLinked,    setXeroLinked]    = useState<Set<string>>(new Set())
  const [xeroConnected, setXeroConnected] = useState(false)
  const [xeroPushing,   setXeroPushing]   = useState<string | null>(null)
  const [companyId,     setCompanyId]     = useState<string | null>(null)
  const [sessionToken,  setSessionToken]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    const cId = member.companyId
    setCompanyId(cId)
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
    if (!companyId || !sessionToken || xeroPushing) return
    setXeroPushing(clientId)
    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, record_id: clientId, record_type: 'client' }),
      })
      const data = await resp.json()
      if (data.ok) setXeroLinked(prev => new Set([...prev, clientId]))
    } finally {
      setXeroPushing(null)
    }
  }

  async function syncAllToXero() {
    if (!companyId || !sessionToken) return
    setXeroPushing('__all__')
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      })
      await load()
    } finally {
      setXeroPushing(null)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Search + add */}
      <div className="flex items-center gap-2 mx-4 mt-4 mb-0">
        <input type="search" placeholder="Search by name, code, email, phone…"
          className="flex-1 bg-surface border border-border text-text-primary placeholder:text-text-disabled rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
          value={searchText} onChange={e => setSearchText(e.target.value)} />
        {xeroConnected && (
          <button
            onClick={syncAllToXero}
            disabled={!!xeroPushing}
            className="h-[42px] px-3 text-[13px] rounded-lg border border-[#13B5EA] text-[#13B5EA] hover:bg-[#13B5EA]/10 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            {xeroPushing === '__all__' ? 'Syncing…' : 'Sync All to Xero'}
          </button>
        )}
        <button onClick={() => router.push('/dashboard/clients/new')}
          className="btn-primary h-[42px] px-3 text-[13px] whitespace-nowrap">
          + Add Client
        </button>
      </div>

      {/* Count + refresh */}
      <div className="flex items-center justify-between mx-4 my-2">
        <p className="text-text-secondary text-[12px]">{filtered.length} client{filtered.length !== 1 ? 's' : ''}</p>
        <button onClick={load} className="text-primary text-[13px] px-2 hover:opacity-70 transition-opacity">Refresh</button>
      </div>

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
                        ) : (
                          <button
                            onClick={e => pushToXero(e, c.id)}
                            disabled={xeroPushing === c.id}
                            className="text-[11px] px-2 py-1 rounded border border-[#13B5EA] text-[#13B5EA] hover:bg-[#13B5EA]/10 disabled:opacity-40 transition-colors whitespace-nowrap"
                          >
                            {xeroPushing === c.id ? '…' : '+ Xero'}
                          </button>
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
