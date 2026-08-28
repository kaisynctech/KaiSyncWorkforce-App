'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { KpiTile } from '@/components/ui/KpiTile'
import type { Farm } from '@/types/farms'

export default function FarmsListPage() {
  const router = useRouter()
  const [farms, setFarms] = useState<Farm[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [address, setAddress] = useState('')

  const canEdit = can(perms, PERM.farmsEdit)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) {
      setError('not_linked')
      setLoading(false)
      return
    }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)
    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    const p = await loadPermissions(supabase, member.companyId, me?.access_level)
    setPerms(p)

    const { data, error: e } = await supabase
      .from('farms')
      .select('*')
      .eq('company_id', member.companyId)
      .order('name')

    if (e) setError(e.message)
    setFarms((data ?? []) as Farm[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function createFarm() {
    if (!companyId || !name.trim() || !canEdit) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { data, error: e } = await supabase
      .from('farms')
      .insert({
        company_id: companyId,
        name: name.trim(),
        farm_code: code.trim() || null,
        address: address.trim() || null,
        created_by: employeeId,
        is_active: true,
      })
      .select()
      .single()
    setBusy(false)
    if (e || !data) {
      setError(e?.message ?? 'Failed to create farm')
      return
    }
    setName('')
    setCode('')
    setAddress('')
    setShowCreate(false)
    router.push(`/dashboard/farms/${data.id}`)
  }

  const activeCount = farms.filter(f => f.is_active).length

  if (error === 'not_linked') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[13px] text-text-secondary">Account not linked to an employee.</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary">Farms</h1>
          <p className="text-[12px] text-text-secondary mt-0.5">Land units and livestock registers</p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="btn-primary h-9 px-3 text-[13px] flex items-center gap-1"
          >
            <span className="material-icons text-[16px]">add</span>Farm
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 py-3 border-b border-divider bg-surface shrink-0">
        <KpiTile value={farms.length} label="Total farms" bg="#1E293B" valueFg="#F8FAFC" labelFg="#64748B" />
        <KpiTile value={activeCount} label="Active" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
      </div>

      {error && error !== 'not_linked' && (
        <p className="px-4 py-2 text-[13px] text-error">{error}</p>
      )}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
        ) : farms.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <span className="material-icons text-[40px] text-text-disabled">agriculture</span>
            <p className="text-[14px] text-text-secondary">No farms yet</p>
            {canEdit && (
              <button type="button" onClick={() => setShowCreate(true)} className="text-[13px] text-primary hover:underline">
                Create your first farm
              </button>
            )}
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 640 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider sticky top-0">
                <th className="data-th text-left">Name</th>
                <th className="data-th text-left">Code</th>
                <th className="data-th text-left">Address</th>
                <th className="data-th text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {farms.map(f => (
                <tr
                  key={f.id}
                  className="border-b border-divider hover:bg-surface-elevated cursor-pointer"
                  onClick={() => router.push(`/dashboard/farms/${f.id}`)}
                >
                  <td className="data-td text-[13px] font-medium text-primary">{f.name}</td>
                  <td className="data-td text-[13px] text-text-secondary">{f.farm_code ?? '—'}</td>
                  <td className="data-td text-[13px] text-text-secondary">{f.address ?? '—'}</td>
                  <td className="data-td text-[12px]">
                    <span className={f.is_active ? 'text-success' : 'text-text-disabled'}>
                      {f.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
            <h2 className="text-[16px] font-semibold text-text-primary">New farm</h2>
            <label className="block text-[12px] text-text-secondary">Name
              <input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Code (optional)
              <input value={code} onChange={e => setCode(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Address (optional)
              <input value={address} onChange={e => setAddress(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
              <button type="button" disabled={busy || !name.trim()} onClick={() => void createFarm()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">
                {busy ? '…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
