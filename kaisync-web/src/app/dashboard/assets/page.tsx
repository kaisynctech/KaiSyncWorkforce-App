'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { Asset } from '@/types/database'

const fmtDate = (d: string | null) => {
  if (!d) return null
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
}

const statusBg = (s: string) => {
  if (s === 'active') return '#DCFCE7'
  if (s === 'retired') return '#F3F4F6'
  return '#FEF3C7'
}

const blankAsset = (): Partial<Asset> => ({
  display_name: '', asset_type: '', serial_number: '', manufacturer: '',
  warranty_expires: '', status_raw: 'active',
})

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Partial<Asset> | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Asset | null>(null)

  const warrantyExpiringSoon = assets.filter(a => {
    if (!a.warranty_expires) return false
    const diff = new Date(a.warranty_expires).getTime() - Date.now()
    return diff > 0 && diff <= 30 * 24 * 60 * 60 * 1000
  }).length

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    const { data } = await supabase
      .from('assets').select('*').eq('company_id', member.companyId).order('display_name')
    setAssets((data ?? []) as Asset[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function save() {
    if (!editing?.display_name?.trim()) return
    setBusy(true)
    const supabase = createClient()
    const payload = {
      ...editing,
      company_id: companyId,
      display_name: editing.display_name?.trim(),
      warranty_expires: editing.warranty_expires || null,
    }
    if (isNew) {
      const { data } = await supabase.from('assets').insert(payload).select().single()
      if (data) setAssets(prev => [...prev, data as Asset].sort((a, b) => a.display_name.localeCompare(b.display_name)))
    } else {
      await supabase.from('assets').update(payload).eq('id', editing.id!)
      setAssets(prev => prev.map(a => a.id === editing.id ? { ...a, ...payload } as Asset : a))
    }
    setEditing(null)
    setBusy(false)
  }

  async function deleteAsset(asset: Asset) {
    const supabase = createClient()
    await supabase.from('assets').delete().eq('id', asset.id)
    setAssets(prev => prev.filter(a => a.id !== asset.id))
    setConfirmDelete(null)
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
        <h1 className="text-[20px] font-semibold text-text-primary">Assets</h1>
        <button className="btn-primary h-9 px-3 text-[13px]"
          onClick={() => { setEditing(blankAsset()); setIsNew(true) }}>
          + Asset
        </button>
      </div>

      {/* KPI banner */}
      {warrantyExpiringSoon > 0 && (
        <div className="card mx-4 mt-3 py-3 px-4 shrink-0">
          <p className="text-sm" style={{ color: 'var(--color-accent)' }}>
            {warrantyExpiringSoon} warrant{warrantyExpiringSoon !== 1 ? 'ies' : 'y'} expiring in 30 days
          </p>
        </div>
      )}

      {/* Asset cards */}
      <div className="flex-1 overflow-y-auto px-4 mt-3 pb-4 space-y-2">
        {loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
        ) : assets.length === 0 ? (
          <p className="text-text-secondary text-[13px] text-center py-8">No assets yet.</p>
        ) : assets.map(asset => (
          <div key={asset.id} className="card p-4 cursor-pointer hover:bg-background transition-colors"
            onClick={() => { setEditing({ ...asset }); setIsNew(false) }}>
            <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1">
              <p className="font-semibold text-[14px] text-text-primary">{asset.display_name}</p>
              <span className="text-xs px-2 py-0.5 rounded-lg shrink-0"
                style={{ backgroundColor: statusBg(asset.status_raw), color: '#374151' }}>
                {asset.status_raw}
              </span>
              <p className="text-xs text-text-secondary">{asset.asset_type ?? '—'}</p>
              {asset.serial_number && (
                <p className="text-xs text-text-secondary text-right">S/N: {asset.serial_number}</p>
              )}
              {asset.manufacturer && (
                <p className="text-xs text-text-secondary">{asset.manufacturer}</p>
              )}
              {asset.warranty_expires && (
                <p className="text-xs text-text-secondary text-right">
                  Warranty: {fmtDate(asset.warranty_expires)}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Edit / Create modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">{isNew ? 'New Asset' : 'Edit Asset'}</h3>
            {[
              ['display_name', 'Asset name *', 'text'],
              ['asset_type', 'Asset type', 'text'],
              ['serial_number', 'Serial number', 'text'],
              ['manufacturer', 'Manufacturer', 'text'],
              ['warranty_expires', 'Warranty expires', 'date'],
            ].map(([field, label, type]) => (
              <div key={field} className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">{label}</label>
                <input
                  type={type}
                  value={(editing as Record<string, unknown>)[field] as string ?? ''}
                  onChange={e => setEditing(prev => ({ ...prev, [field]: e.target.value }))}
                  className="dark-entry w-full"
                />
              </div>
            ))}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Status</label>
              <select value={editing.status_raw ?? 'active'}
                onChange={e => setEditing(prev => ({ ...prev, status_raw: e.target.value }))}
                className="dark-entry w-full appearance-none">
                <option value="active">Active</option>
                <option value="retired">Retired</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
            <div className="flex gap-2 justify-between pt-1">
              {!isNew && (
                <button onClick={() => { setEditing(null); setConfirmDelete(editing as Asset) }}
                  className="text-[12px] text-error hover:opacity-70 transition-opacity">
                  Delete
                </button>
              )}
              <div className="flex gap-2 ml-auto">
                <button onClick={() => setEditing(null)} className="btn-outlined h-9 px-4 text-[13px]">
                  Cancel
                </button>
                <button onClick={save} disabled={!editing.display_name?.trim() || busy}
                  className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-xs p-5 space-y-3">
            <p className="font-semibold text-text-primary">Delete Asset?</p>
            <p className="text-sm text-text-secondary">
              &ldquo;{confirmDelete.display_name}&rdquo; will be permanently deleted.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="btn-outlined h-9 px-4 text-[13px]">
                Cancel
              </button>
              <button onClick={() => deleteAsset(confirmDelete)}
                className="h-9 px-4 text-[13px] rounded-lg bg-error text-white font-medium">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
