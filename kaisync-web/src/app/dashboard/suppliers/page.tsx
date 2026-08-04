'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  escapeIlike,
  pageRange,
  totalPages,
} from '@/lib/list-pagination'
import type { Contractor } from '@/types/database'

export default function SuppliersPage() {
  const router = useRouter()
  const [suppliers, setSuppliers] = useState<Contractor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [total, setTotal] = useState(0)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [xeroLinked, setXeroLinked] = useState<Set<string>>(new Set())
  const [xeroConnected, setXeroConnected] = useState(false)
  const [xeroPushing, setXeroPushing] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [xeroImporting, setXeroImporting] = useState(false)
  const [xeroMsg, setXeroMsg] = useState<string | null>(null)

  const canEdit = can(perms, PERM.suppliersEdit)

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
    setPerms(await loadPermissions(supabase, cId, me?.access_level))

    const { from, to } = pageRange(page, pageSize)
    let query = supabase
      .from('contractors')
      .select('*', { count: 'exact' })
      .eq('company_id', cId)
      .or('partner_kind.eq.supplier,partner_kind.eq.both')
      .order('name')

    if (searchDebounced) {
      const q = escapeIlike(searchDebounced)
      query = query.or(`name.ilike.%${q}%,contact_person.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
    }

    const { data, error: qErr, count } = await query.range(from, to)
    if (qErr) {
      setError(qErr.message)
      setSuppliers([])
      setTotal(0)
    } else {
      setSuppliers((data ?? []) as Contractor[])
      setTotal(count ?? 0)
    }

    const { data: xStatus } = await (supabase.rpc as any)('get_xero_connection_status', { p_company_id: cId })
    setXeroConnected(xStatus?.connected ?? false)
    if (xStatus?.connected) {
      const { data: linkedIds } = await (supabase.rpc as any)('get_xero_linked_records', { p_company_id: cId, p_record_type: 'contractor' })
      setXeroLinked(new Set((linkedIds ?? []) as string[]))
    }
    const { data: { session } } = await supabase.auth.getSession()
    setSessionToken(session?.access_token ?? null)
    setLoading(false)
  }, [page, pageSize, searchDebounced])

  useEffect(() => { void load() }, [load])

  async function pushToXero(e: React.MouseEvent, supplierId: string) {
    e.stopPropagation()
    if (!canEdit || !companyId || !sessionToken || xeroPushing) return
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
    if (!canEdit || !companyId || !sessionToken) return
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
        },
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

  const pages = totalPages(total, pageSize)

  if (error === 'not_linked') return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
      </div>
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-sm bg-surface border border-border rounded-lg px-2">
          <span className="material-icons text-text-secondary text-[16px]">search</span>
          <input
            placeholder="Search suppliers…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-text-primary text-[13px] h-[38px] outline-none placeholder:text-text-disabled"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canEdit && xeroConnected && (
            <button
              onClick={() => void syncAllToXero()}
              disabled={!!xeroPushing}
              className="h-9 px-3 text-[13px] rounded-lg border border-[#13B5EA] text-[#13B5EA] hover:bg-[#13B5EA]/10 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {xeroPushing === '__all__' ? 'Syncing…' : 'Sync All to Xero'}
            </button>
          )}
          {canEdit && xeroConnected && (
            <button
              onClick={() => void importFromXero()}
              disabled={xeroImporting}
              className="h-9 px-3 text-[13px] rounded-lg border border-[#13B5EA] text-[#13B5EA] font-medium hover:bg-[#13B5EA]/10 disabled:opacity-50 transition-colors"
            >
              {xeroImporting ? 'Importing…' : '↓ Import from Xero'}
            </button>
          )}
          {canEdit && (
            <button className="btn-primary h-9 px-3 text-[13px]"
              onClick={() => router.push('/dashboard/suppliers/new')}>
              + Add supplier
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-b border-divider shrink-0 gap-3 flex-wrap">
        <p className="text-xs text-text-secondary">
          {total === 0 ? '0 suppliers' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
          <span className="text-text-disabled"> · Separate from contractors</span>
        </p>
        <div className="flex items-center gap-2">
          <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="dark-entry h-8 text-[12px] py-0">
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}/page</option>)}
          </select>
          <button onClick={() => void load()} className="text-[13px] text-primary hover:opacity-70">Refresh</button>
        </div>
      </div>

      {error && error !== 'not_linked' && <p className="mx-4 text-[12px] text-error">{error}</p>}
      {xeroMsg && (
        <p className={`mx-4 mb-2 text-[12px] px-3 py-2 rounded ${
          xeroMsg.includes('Imported') ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'
        }`}>
          {xeroMsg}
          <button onClick={() => setXeroMsg(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </p>
      )}

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
                {xeroConnected && <th className="data-th text-center" style={{ width: 80 }}>Xero</th>}
              </tr>
            </thead>
            <tbody>
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan={xeroConnected ? 7 : 6} className="data-td text-center text-text-secondary py-10">
                    No suppliers found.
                  </td>
                </tr>
              ) : suppliers.map(s => (
                <tr key={s.id}
                  className="bg-surface-card cursor-pointer hover:bg-background transition-colors border-b border-divider last:border-0"
                  onClick={() => router.push(`/dashboard/suppliers/${s.id}`)}>
                  <td className="data-td text-sm font-medium text-primary">{s.name}</td>
                  <td className="data-td text-sm text-text-secondary">{s.contact_person ?? '—'}</td>
                  <td className="data-td text-sm text-text-secondary">{s.phone ?? '—'}</td>
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
                      ) : canEdit ? (
                        <button
                          onClick={e => void pushToXero(e, s.id)}
                          disabled={xeroPushing === s.id}
                          className="text-[11px] px-2 py-1 rounded border border-[#13B5EA] text-[#13B5EA] hover:bg-[#13B5EA]/10 disabled:opacity-40"
                        >
                          {xeroPushing === s.id ? '…' : '+ Xero'}
                        </button>
                      ) : null}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-t border-divider shrink-0">
        <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40">Previous</button>
        <span className="text-[12px] text-text-secondary">Page {page} of {pages}</span>
        <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40">Next</button>
      </div>
    </div>
  )
}
