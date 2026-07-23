'use client'

import { useCallback, useEffect, useState } from 'react'
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

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    const { data } = await supabase
      .from('contractors')
      .select('*')
      .eq('company_id', member.companyId)
      .order('name')
    // MAUI: IsSupplierKind (partner_kind = supplier | both); keep legacy is_supplier
    const rows = ((data ?? []) as (Contractor & { partner_kind?: string | null })[]).filter(c =>
      isSupplierKind(c.partner_kind) || c.is_supplier === true,
    )
    setSuppliers(rows as Contractor[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

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
        <button className="btn-primary h-9 px-3 text-[13px]"
          onClick={() => router.push('/dashboard/contractors/new?type=supplier')}>
          + Add
        </button>
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
              </tr>
            </thead>
            <tbody>
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="data-td text-center text-text-secondary py-10">
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
