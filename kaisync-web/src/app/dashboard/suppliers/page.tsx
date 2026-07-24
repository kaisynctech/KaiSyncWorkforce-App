'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { isSupplierKind } from '@/lib/partner-kinds'
import type { Contractor } from '@/types/database'

export default function SuppliersPage() {
  const router = useRouter()
  const [suppliers, setSuppliers] = useState<Contractor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [xeroLinked,    setXeroLinked]    = useState<Set<string>>(new Set())
  const [xeroConnected, setXeroConnected] = useState(false)
  const [xeroPushing,   setXeroPushing]   = useState<string | null>(null)
  const [companyId,     setCompanyId]     = useState<string | null>(null)
  const [sessionToken,  setSessionToken]  = useState<string | null>(null)
  const [xeroImporting, setXeroImporting] = useState(false)
  const [xeroMsg,       setXeroMsg]       = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    const cId = member.companyId
    setCompanyId(cId)
    const { data } = await supabase
      .from('contractors')
      .select('*')
      .eq('company_id', cId)
      .order('name')
    // MAUI: IsSupplierKind (partner_kind = supplier | both); keep legacy is_supplier
    const rows = ((data ?? []) as (Contractor & { partner_kind?: string | null })[]).filter(c =>
      isSupplierKind(c.partner_kind) || c.is_supplier === true,
    )
    setSuppliers(rows as Contractor[])
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

  async function pushToXero(e: React.MouseEvent, supplierId: string) {
    e.stopPropagation()
    if (!companyId || !sessionToken || xeroPushing) return
    setXeroPushing(supplierId)
    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, record_id: supplierId, record_type: 'contractor' }),
      })
      const data = await resp.json()
      if (data.ok) setXeroLinked(prev => new Set([...prev, supplierId]))
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

  async function importFromXero() {
    if (!companyId || !sessionToken) return
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
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[20px] font-semibold text-text-primary">Suppliers</h1>
        <div className="flex items-center gap-2">
          {xeroConnected && (
            <button
              onClick={syncAllToXero}
              disabled={!!xeroPushing}
              className="h-9 px-3 text-[13px] rounded-lg border border-[#13B5EA] text-[#13B5EA] hover:bg-[#13B5EA]/10 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {xeroPushing === '__all__' ? 'Syncing…' : 'Sync All to Xero'}
            </button>
          )}
          {xeroConnected && (
            <button
              onClick={importFromXero}
              disabled={xeroImporting}
              className="h-9 px-3 text-[13px] rounded-lg border border-[#13B5EA] text-[#13B5EA] font-medium hover:bg-[#13B5EA]/10 disabled:opacity-50 transition-colors"
            >
              {xeroImporting ? 'Importing…' : '↓ Import from Xero'}
            </button>
          )}
          <button className="btn-primary h-9 px-3 text-[13px]"
            onClick={() => router.push('/dashboard/contractors/new?type=supplier')}>
            + Add
          </button>
        </div>
      </div>

      {/* Sub-header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-divider shrink-0">
        <p className="text-xs text-text-secondary">
          {suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}
        </p>
        <button onClick={load} className="text-[13px] text-primary hover:opacity-70 transition-opacity">
          Refresh
        </button>
      </div>

      {xeroMsg && (
        <p className={`mx-4 mb-2 text-[12px] px-3 py-2 rounded ${
          xeroMsg.includes('Imported') ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'
        }`}>
          {xeroMsg}
          <button onClick={() => setXeroMsg(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </p>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
        ) : (
          <table className="w-full" style={{ minWidth: 900 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left" style={{ width: 200 }}>Supplier</th>
                <th className="data-th text-left" style={{ width: 140 }}>Contact</th>
                <th className="data-th text-left">Phone</th>
                <th className="data-th text-left" style={{ width: 160 }}>Email</th>
                <th className="data-th text-left" style={{ width: 140 }}>Address</th>
                <th className="data-th text-right" style={{ width: 120 }}>Status</th>
                {xeroConnected && (
                  <th className="data-th text-center" style={{ width: 80 }}>Xero</th>
                )}
              </tr>
            </thead>
            <tbody>
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan={xeroConnected ? 7 : 6} className="data-td text-center text-text-secondary py-10">
                    No suppliers yet. Add suppliers here or from an inventory item.
                  </td>
                </tr>
              ) : suppliers.map(s => (
                <tr key={s.id}
                  className="bg-surface-card cursor-pointer hover:bg-background transition-colors border-b border-divider last:border-0"
                  onClick={() => router.push(`/dashboard/contractors/${s.id}`)}>
                  <td className="data-td text-sm font-medium text-primary">{s.name}</td>
                  <td className="data-td text-sm text-text-secondary">{s.contact_person ?? '—'}</td>
                  <td className="data-td text-sm text-text-secondary">
                    {[s.phone, s.email].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="data-td text-sm text-text-secondary">{s.email ?? '—'}</td>
                  <td className="data-td text-sm text-text-secondary truncate" style={{ maxWidth: 140 }}>
                    {s.address ?? '—'}
                  </td>
                  <td className="data-td text-sm text-text-secondary text-right">
                    {s.is_active ? 'Active' : 'Inactive'}
                  </td>
                  {xeroConnected && (
                    <td className="data-td text-center" onClick={e => e.stopPropagation()}>
                      {xeroLinked.has(s.id) ? (
                        <span className="text-green-400 text-[18px]" title="Synced to Xero">✓</span>
                      ) : (
                        <button
                          onClick={e => pushToXero(e, s.id)}
                          disabled={xeroPushing === s.id}
                          className="text-[11px] px-2 py-1 rounded border border-[#13B5EA] text-[#13B5EA] hover:bg-[#13B5EA]/10 disabled:opacity-40 transition-colors whitespace-nowrap"
                        >
                          {xeroPushing === s.id ? '…' : '+ Xero'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
