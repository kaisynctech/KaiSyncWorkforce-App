'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { ASSET_STATUSES, assetStatusLabel, type AssetStatus } from '@/lib/supply-assets'
import type { Asset } from '@/types/database'

const fmtDate = (d: string | null) => {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
}

const statusStyle = (s: string): { bg: string; fg: string } => {
  switch ((s ?? '').toLowerCase()) {
    case 'active': return { bg: '#DCFCE7', fg: '#166534' }
    case 'out_of_service': return { bg: '#FEF3C7', fg: '#92400E' }
    case 'retired': return { bg: '#F3F4F6', fg: '#4B5563' }
    default: return { bg: '#E5E7EB', fg: '#374151' }
  }
}

type AssetDraft = {
  id?: string
  label: string
  asset_type: string
  serial_number: string
  manufacturer: string
  model_number: string
  warranty_expires: string
  status: AssetStatus
  notes: string
}

const blankAsset = (): AssetDraft => ({
  label: '',
  asset_type: '',
  serial_number: '',
  manufacturer: '',
  model_number: '',
  warranty_expires: '',
  status: 'active',
  notes: '',
})

function toDraft(asset: Asset): AssetDraft {
  return {
    id: asset.id,
    label: asset.label ?? '',
    asset_type: asset.asset_type ?? '',
    serial_number: asset.serial_number ?? '',
    manufacturer: asset.manufacturer ?? '',
    model_number: asset.model_number ?? '',
    warranty_expires: asset.warranty_expires ? asset.warranty_expires.slice(0, 10) : '',
    status: (ASSET_STATUSES.includes(asset.status as AssetStatus) ? asset.status : 'active') as AssetStatus,
    notes: asset.notes ?? '',
  }
}

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<AssetDraft | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmRetire, setConfirmRetire] = useState<Asset | null>(null)

  const warrantyExpiringSoon = useMemo(() => assets.filter(a => {
    if (!a.warranty_expires || a.status === 'retired') return false
    const diff = new Date(a.warranty_expires).getTime() - Date.now()
    return diff > 0 && diff <= 30 * 24 * 60 * 60 * 1000
  }).length, [assets])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return assets
    return assets.filter(a =>
      [a.label, a.asset_type, a.serial_number, a.manufacturer, a.model_number, a.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [assets, search])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    const { data, error: qErr } = await supabase
      .from('assets')
      .select('*')
      .eq('company_id', member.companyId)
      .order('label')
    if (qErr) {
      setError(qErr.message)
      setAssets([])
    } else {
      setAssets((data ?? []) as Asset[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function save() {
    if (!editing?.label?.trim()) { setError('Asset label is required.'); return }
    if (!companyId) { setError('Company context missing.'); return }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const payload = {
      company_id: companyId,
      label: editing.label.trim(),
      asset_type: editing.asset_type.trim() || null,
      serial_number: editing.serial_number.trim() || null,
      manufacturer: editing.manufacturer.trim() || null,
      model_number: editing.model_number.trim() || null,
      warranty_expires: editing.warranty_expires || null,
      status: editing.status,
      notes: editing.notes.trim() || null,
    }
    if (isNew) {
      const { data, error: e } = await supabase.from('assets').insert(payload).select().single()
      if (e) { setError(e.message); setBusy(false); return }
      setAssets(prev => [...prev, data as Asset].sort((a, b) => a.label.localeCompare(b.label)))
    } else if (editing.id) {
      const { error: e } = await supabase.from('assets').update(payload).eq('id', editing.id)
      if (e) { setError(e.message); setBusy(false); return }
      setAssets(prev => prev.map(a => a.id === editing.id ? { ...a, ...payload } as Asset : a))
    }
    setEditing(null)
    setBusy(false)
  }

  async function retireAsset(asset: Asset) {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: e } = await supabase
      .from('assets')
      .update({ status: 'retired' })
      .eq('id', asset.id)
    if (e) {
      setError(e.message)
      setBusy(false)
      return
    }
    setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, status: 'retired' } : a))
    setConfirmRetire(null)
    setEditing(null)
    setBusy(false)
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-sm bg-surface border border-border rounded-lg px-2">
          <span className="material-icons text-text-secondary text-[16px]">search</span>
          <input
            placeholder="Search assets…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-text-primary text-[13px] h-[38px] outline-none placeholder:text-text-disabled"
          />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="bg-surface-dark rounded-md h-9 w-9 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons text-[18px]">refresh</span>
          </button>
          <button className="btn-primary h-9 px-3 text-[13px]"
            onClick={() => { setEditing(blankAsset()); setIsNew(true); setError(null) }}>
            + Asset
          </button>
        </div>
      </div>

      {warrantyExpiringSoon > 0 && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg border border-[#F59E0B] bg-[#FFFBEB] flex items-center gap-2 shrink-0">
          <span className="material-icons text-[16px]" style={{ color: '#D97706' }}>warning</span>
          <p className="text-[12px] font-medium" style={{ color: '#92400E' }}>
            {warrantyExpiringSoon} warrant{warrantyExpiringSoon !== 1 ? 'ies' : 'y'} expiring in 30 days
          </p>
        </div>
      )}

      {error && error !== 'not_linked' && (
        <p className="mx-4 mt-2 text-[12px] text-error">{error}</p>
      )}

      <div className="flex-1 overflow-auto mt-2">
        <table className="w-full" style={{ minWidth: 900 }}>
          <thead>
            <tr className="bg-surface-elevated border-b border-divider">
              <th className="data-th text-left" style={{ width: 200 }}>Asset</th>
              <th className="data-th text-left" style={{ width: 120 }}>Type</th>
              <th className="data-th text-left" style={{ width: 140 }}>Serial</th>
              <th className="data-th text-left" style={{ width: 140 }}>Manufacturer</th>
              <th className="data-th text-left" style={{ width: 120 }}>Warranty</th>
              <th className="data-th text-left" style={{ width: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="data-td text-center text-text-secondary py-10">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="data-td text-center text-text-secondary py-10">No assets found.</td></tr>
            ) : filtered.map(asset => {
              const st = statusStyle(asset.status)
              return (
                <tr
                  key={asset.id}
                  className="bg-surface-card cursor-pointer hover:bg-background transition-colors border-b border-divider last:border-0"
                  onClick={() => { setEditing(toDraft(asset)); setIsNew(false); setError(null) }}
                >
                  <td className="data-td text-sm font-medium text-text-primary">{asset.label}</td>
                  <td className="data-td text-sm text-text-secondary">{asset.asset_type ?? '—'}</td>
                  <td className="data-td text-sm text-text-secondary">{asset.serial_number ?? '—'}</td>
                  <td className="data-td text-sm text-text-secondary">{asset.manufacturer ?? '—'}</td>
                  <td className="data-td text-sm text-text-secondary">{fmtDate(asset.warranty_expires)}</td>
                  <td className="data-td">
                    <span className="text-xs px-2 py-0.5 rounded-lg" style={{ backgroundColor: st.bg, color: st.fg }}>
                      {assetStatusLabel(asset.status)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-text-primary">{isNew ? 'New Asset' : 'Edit Asset'}</h3>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Label *</label>
              <input value={editing.label} onChange={e => setEditing(prev => prev ? { ...prev, label: e.target.value } : prev)} className="dark-entry w-full" autoFocus />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Asset type</label>
              <input value={editing.asset_type} onChange={e => setEditing(prev => prev ? { ...prev, asset_type: e.target.value } : prev)} className="dark-entry w-full" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Serial number</label>
              <input value={editing.serial_number} onChange={e => setEditing(prev => prev ? { ...prev, serial_number: e.target.value } : prev)} className="dark-entry w-full" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Manufacturer</label>
              <input value={editing.manufacturer} onChange={e => setEditing(prev => prev ? { ...prev, manufacturer: e.target.value } : prev)} className="dark-entry w-full" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Model</label>
              <input value={editing.model_number} onChange={e => setEditing(prev => prev ? { ...prev, model_number: e.target.value } : prev)} className="dark-entry w-full" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Warranty expires</label>
              <input type="date" value={editing.warranty_expires} onChange={e => setEditing(prev => prev ? { ...prev, warranty_expires: e.target.value } : prev)} className="dark-entry w-full" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Status</label>
              <select
                value={editing.status}
                onChange={e => setEditing(prev => prev ? { ...prev, status: e.target.value as AssetStatus } : prev)}
                className="dark-entry w-full appearance-none"
              >
                {ASSET_STATUSES.map(s => (
                  <option key={s} value={s}>{assetStatusLabel(s)}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Notes</label>
              <textarea value={editing.notes} onChange={e => setEditing(prev => prev ? { ...prev, notes: e.target.value } : prev)} rows={2} className="dark-entry w-full min-h-[56px] py-2 resize-none" />
            </div>
            <div className="flex gap-2 justify-between pt-1">
              {!isNew && editing.status !== 'retired' && (
                <button
                  onClick={() => {
                    const asset = assets.find(a => a.id === editing.id)
                    if (asset) { setConfirmRetire(asset); setEditing(null) }
                  }}
                  className="text-[12px] text-error hover:opacity-70 transition-opacity"
                >
                  Retire
                </button>
              )}
              <div className="flex gap-2 ml-auto">
                <button onClick={() => setEditing(null)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
                <button onClick={() => void save()} disabled={!editing.label.trim() || busy}
                  className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmRetire && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-xs p-5 space-y-3">
            <p className="font-semibold text-text-primary">Retire Asset?</p>
            <p className="text-sm text-text-secondary">
              &ldquo;{confirmRetire.label}&rdquo; will be marked retired. It stays in history and is not hard-deleted.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmRetire(null)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
              <button onClick={() => void retireAsset(confirmRetire)} disabled={busy}
                className="h-9 px-4 text-[13px] rounded-lg bg-error text-white font-medium disabled:opacity-50">
                {busy ? '…' : 'Retire'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
