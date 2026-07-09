'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Contractor } from '@/types/database'

export default function SuppliersPage() {
  const router = useRouter()
  const [suppliers, setSuppliers] = useState<Contractor[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data: me } = await supabase.from('employees').select('company_id').eq('user_id', user.id).maybeSingle()
    if (!me) { setLoading(false); return }
    const { data } = await supabase
      .from('contractors')
      .select('*')
      .eq('company_id', me.company_id)
      .eq('is_supplier', true)
      .order('name')
    setSuppliers((data ?? []) as Contractor[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

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
