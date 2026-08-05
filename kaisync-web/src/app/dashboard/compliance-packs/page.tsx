'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { CONTRACTOR_DOC_TYPES } from '@/lib/contractor-portal/types'
import { KpiTile } from '@/components/ui/KpiTile'
import {
  archiveCompliancePack,
  setDefaultCompliancePack,
  upsertCompliancePack,
} from '@/lib/compliance-packs'

interface PackItem {
  document_type: string
  requirement: 'required' | 'recommended' | 'none'
}

interface CompliancePack {
  id: string
  company_id: string
  name: string
  pack_code?: string | null
  description: string | null
  is_default: boolean
  is_archived?: boolean | null
  items: PackItem[]
}

export default function CompliancePacksPage() {
  const [packs, setPacks] = useState<CompliancePack[]>([])
  const [assignedCount, setAssignedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editingPackId, setEditingPackId] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editItems, setEditItems] = useState<Record<string, 'required' | 'recommended' | 'none'>>({})

  const canEdit = can(perms, PERM.contractorsEdit)
  const docTypes = CONTRACTOR_DOC_TYPES.map(t => t.value)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const supabase = createClient()

    try {
      const member = await resolveCurrentMember(supabase)
      if (!member) { setError('not_linked'); setLoading(false); return }
      setCompanyId(member.companyId)

      const { data: me } = await supabase
        .from('employees')
        .select('access_level')
        .eq('id', member.employeeId)
        .maybeSingle()
      setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

      let query = supabase
        .from('contractor_compliance_packs')
        .select('id, company_id, name, pack_code, description, is_default, is_archived, items:contractor_compliance_pack_items(document_type, requirement)')
        .eq('company_id', member.companyId)
        .order('name')

      if (!showArchived) query = query.or('is_archived.eq.false,is_archived.is.null')

      const [packRes, assignedRes] = await Promise.all([
        query,
        supabase
          .from('contractors')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', member.companyId)
          .not('compliance_pack_id', 'is', null)
          .or('partner_kind.eq.contractor,partner_kind.eq.both,partner_kind.is.null'),
      ])

      if (packRes.error) {
        setLoadError(packRes.error.message)
        setPacks([])
      } else {
        setPacks((packRes.data ?? []) as CompliancePack[])
      }
      setAssignedCount(assignedRes.count ?? 0)
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load packs')
    }
    setLoading(false)
  }, [showArchived])

  useEffect(() => { void load() }, [load])

  function buildInitialItems(existingItems: PackItem[]) {
    const map: Record<string, 'required' | 'recommended' | 'none'> = {}
    for (const dt of docTypes) map[dt] = 'none'
    for (const item of existingItems) {
      if (item.document_type) map[item.document_type] = item.requirement
    }
    return map
  }

  function openCreate() {
    if (!canEdit) return
    setEditingPackId(null)
    setEditName('')
    setEditDescription('')
    setEditItems(buildInitialItems([]))
    setIsEditing(true)
    setError(null)
  }

  function openEdit(pack: CompliancePack) {
    if (!canEdit) return
    setEditingPackId(pack.id)
    setEditName(pack.name)
    setEditDescription(pack.description ?? '')
    setEditItems(buildInitialItems(pack.items ?? []))
    setIsEditing(true)
    setError(null)
  }

  function cancelEdit() { setIsEditing(false); setError(null) }

  function toggleItem(dt: string, val: 'required' | 'recommended' | 'none') {
    setEditItems(prev => ({ ...prev, [dt]: val }))
  }

  async function savePack() {
    if (!canEdit || !editName.trim() || !companyId) return
    setIsBusy(true)
    setError(null)
    const supabase = createClient()

    const itemsPayload = Object.entries(editItems)
      .filter(([, req]) => req !== 'none')
      .map(([document_type, requirement]) => ({
        document_type,
        requirement: requirement as 'required' | 'recommended',
      }))

    const res = await upsertCompliancePack(supabase, {
      companyId,
      packId: editingPackId,
      name: editName,
      description: editDescription,
      items: itemsPayload,
    })

    setIsBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setIsEditing(false)
    void load()
  }

  async function setDefault(packId: string) {
    if (!canEdit || !companyId) return
    setError(null)
    const supabase = createClient()
    const res = await setDefaultCompliancePack(supabase, { companyId, packId })
    if (!res.ok) { setError(res.message); return }
    void load()
  }

  async function archivePack(packId: string, archived: boolean) {
    if (!canEdit || !companyId) return
    const label = archived ? 'Archive' : 'Restore'
    if (!window.confirm(`${label} this compliance pack?`)) return
    setError(null)
    const supabase = createClient()
    const res = await archiveCompliancePack(supabase, { companyId, packId, archived })
    if (!res.ok) { setError(res.message); return }
    void load()
  }

  const requiredCount = (pack: CompliancePack) =>
    (pack.items ?? []).filter(i => i.requirement === 'required').length
  const recommendedCount = (pack: CompliancePack) =>
    (pack.items ?? []).filter(i => i.requirement === 'recommended').length

  const activePacks = packs.filter(p => !p.is_archived)
  const defaultPack = packs.find(p => p.is_default && !p.is_archived)

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
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 pt-4 pb-2 shrink-0 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-[18px] font-semibold text-text-primary">Compliance Packs</h1>
            <p className="text-[12px] text-text-secondary">Contractor document requirement templates</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
              Show archived
            </label>
            {canEdit && (
              <button onClick={openCreate} className="btn-primary h-9 px-3 text-[13px]">+ Create Pack</button>
            )}
          </div>
        </div>

        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <KpiTile value={activePacks.length} label="Active packs" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
            <KpiTile value={defaultPack ? 1 : 0} label="Default set" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
            <KpiTile value={assignedCount} label="Assigned" bg="#292012" valueFg="#FCD34D" labelFg="#FCD34D" />
            <KpiTile value={packs.filter(p => p.is_archived).length} label="Archived" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
          </div>
        )}

        {(error || loadError) && error !== 'not_linked' && (
          <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[13px] text-error">
            {error || loadError}
            {loadError && (
              <button onClick={() => void load()} className="ml-2 underline">Retry</button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-0 flex-1 overflow-hidden border-t border-divider">
        <div className="flex flex-col border-r border-divider overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
            {loading && <p className="text-text-secondary text-[13px] text-center py-6">Loading…</p>}
            {!loading && packs.length === 0 && !loadError && (
              <p className="text-text-secondary text-[13px] text-center py-6">No compliance packs yet. Create one above.</p>
            )}
            {packs.map(pack => (
              <div key={pack.id} className="card p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-text-primary truncate">{pack.name}</p>
                  <div className="flex items-center gap-1 shrink-0">
                    {pack.is_archived && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-surface-elevated text-text-secondary">Archived</span>
                    )}
                    {pack.is_default && !pack.is_archived && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#14532D', color: '#22C55E' }}>
                        Default
                      </span>
                    )}
                  </div>
                </div>
                {pack.pack_code && (
                  <p className="text-[11px] text-text-secondary font-mono">{pack.pack_code}</p>
                )}
                <div className="flex gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: '#7F1D1D', color: '#FCA5A5' }}>
                    {requiredCount(pack)} Required
                  </span>
                  {recommendedCount(pack) > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: '#292012', color: '#FCD34D' }}>
                      {recommendedCount(pack)} Recommended
                    </span>
                  )}
                </div>
                {canEdit && (
                  <div className="flex gap-1.5 flex-wrap">
                    {!pack.is_default && !pack.is_archived && (
                      <button onClick={() => void setDefault(pack.id)}
                        className="h-[28px] px-2 rounded-md text-[10px]"
                        style={{ backgroundColor: '#1E293B', color: '#94A3B8' }}>
                        Set Default
                      </button>
                    )}
                    {!pack.is_archived && (
                      <button onClick={() => openEdit(pack)}
                        className="h-[28px] px-2 rounded-md text-[10px] text-white"
                        style={{ backgroundColor: '#3B82F6' }}>
                        Edit
                      </button>
                    )}
                    <button onClick={() => void archivePack(pack.id, !pack.is_archived)}
                      className="h-[28px] px-2 rounded-md text-[10px] text-error bg-transparent">
                      {pack.is_archived ? 'Restore' : 'Archive'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden flex flex-col">
          {!isEditing ? (
            <div className="flex flex-col items-center justify-center h-full text-text-secondary gap-2">
              <span className="material-icons text-[48px]">inbox</span>
              <p className="text-[15px] font-medium">Select a pack to edit</p>
              <p className="text-[12px]">or create a new pack using the button above.</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <h2 className="text-[18px] font-semibold text-text-primary">
                {editingPackId ? 'Edit Compliance Pack' : 'Create Compliance Pack'}
              </h2>

              <div className="space-y-1">
                <label className="section-label">Pack Name *</label>
                <input value={editName} onChange={e => setEditName(e.target.value)}
                  placeholder="e.g. Security Contractor" className="dark-entry w-full mt-1" />
              </div>

              <div className="space-y-1">
                <label className="section-label">Description</label>
                <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)}
                  placeholder="Short description..."
                  rows={2} className="dark-entry w-full mt-1 py-2 resize-none min-h-[60px]" />
              </div>

              <hr className="border-divider" />

              <div className="space-y-2">
                <p className="section-label">DOCUMENT REQUIREMENTS</p>
                <p className="text-xs text-text-secondary">
                  Only contractor document types supported by uploads are listed.
                </p>

                <div className="flex gap-2 mt-1">
                  <span className="text-[10px] px-2 py-0.5 rounded" style={{ backgroundColor: '#7F1D1D', color: '#FCA5A5' }}>Required</span>
                  <span className="text-[10px] px-2 py-0.5 rounded" style={{ backgroundColor: '#78350F', color: '#FCD34D' }}>Recommended</span>
                  <span className="text-[10px] px-2 py-0.5 rounded" style={{ backgroundColor: '#1E293B', color: '#475569' }}>Exclude</span>
                </div>

                {CONTRACTOR_DOC_TYPES.map(({ value, label }) => {
                  const current = editItems[value] ?? 'none'
                  return (
                    <div key={value} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-1 py-1.5 border-b border-divider last:border-0">
                      <span className="text-sm text-text-primary">{label}</span>
                      <button
                        onClick={() => toggleItem(value, 'required')}
                        className="h-[28px] px-2.5 text-[10px] rounded-md"
                        style={{
                          backgroundColor: current === 'required' ? '#7F1D1D' : '#1E293B',
                          color: current === 'required' ? '#FCA5A5' : '#475569',
                        }}
                      >Required</button>
                      <button
                        onClick={() => toggleItem(value, 'recommended')}
                        className="h-[28px] px-2.5 text-[10px] rounded-md"
                        style={{
                          backgroundColor: current === 'recommended' ? '#78350F' : '#1E293B',
                          color: current === 'recommended' ? '#FCD34D' : '#475569',
                        }}
                      >Recommend</button>
                      <button
                        onClick={() => toggleItem(value, 'none')}
                        className="h-[28px] px-2.5 text-[10px] rounded-md"
                        style={{
                          backgroundColor: '#1E293B',
                          color: current === 'none' ? '#CBD5E1' : '#475569',
                        }}
                      >Exclude</button>
                    </div>
                  )
                })}
              </div>

              <hr className="border-divider" />

              <div className="flex justify-end gap-2.5 pb-4">
                <button onClick={cancelEdit} className="btn-outlined h-[42px] px-5 text-[13px]">Cancel</button>
                <button onClick={() => void savePack()} disabled={isBusy || !editName.trim()} className="btn-primary h-[42px] px-5 text-[13px] font-semibold">
                  {isBusy ? 'Saving...' : 'Save Pack'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
